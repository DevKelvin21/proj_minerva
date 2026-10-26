/**
 * Persistencia de PRs "vistos" (T50/T51, F10): `pr-seen.json` en
 * `app.getPath('userData')`, MISMO patrón que `../settings/store.ts` (lazy
 * `app.getPath` — nunca en el constructor/import, la app puede no estar
 * `ready` todavía —, cache en memoria, lectura tolerante a corrupción,
 * escritura atómica tmp+rename).
 *
 * Un PR se marca visto al abrirlo en el detalle (decisión de producto, ver
 * `.agents/PLAN.md` § "Iteración actual"): se sella el `updatedAt`/
 * `commentCount` del summary EN ESE MOMENTO. `computeUnread` compara el
 * summary actual contra esa entrada sellada para decidir si hay que mostrar
 * un indicador de no-leído — si no hay entrada, el PR nunca se vio
 * (`isNew`); primer arranque de la app: sin entradas, todo aparece como no
 * visto (honesto, decisión de diseño explícita en el PLAN).
 *
 * Cap de 1000 entradas: al escribir, si se excede, se podan las de `seenAt`
 * más viejo (LRU aproximado por fecha de sellado, no por uso de lectura).
 *
 * Keys are `prKey(repo, number)` (provider-neutral) since version 2. Version 1
 * files (keyed by GitHub node ids) can't be mapped to the new keys and are
 * dropped on load: every PR shows as unseen once after upgrading.
 */
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { prKey } from '../../shared/scm'
import type { PrUnread, PullRequestSummary } from '../../shared/types'

const SEEN_FILE_NAME = 'pr-seen.json'
const MAX_ENTRIES = 1000

const SEEN_STORE_VERSION = 2

interface SeenEntry {
  updatedAt: string
  /** `null` when the provider didn't report a comment count. */
  commentCount: number | null
  seenAt: string
}

interface PersistedSeenState {
  version: typeof SEEN_STORE_VERSION
  entries: Record<string, SeenEntry>
}

function emptyState(): PersistedSeenState {
  return { version: SEEN_STORE_VERSION, entries: {} }
}

function isSeenEntry(value: unknown): value is SeenEntry {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.updatedAt === 'string' &&
    (v.commentCount === null ||
      (typeof v.commentCount === 'number' && Number.isFinite(v.commentCount))) &&
    typeof v.seenAt === 'string'
  )
}

function isEntriesMap(value: unknown): value is Record<string, SeenEntry> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  return Object.values(value as Record<string, unknown>).every(isSeenEntry)
}

function isValidPersistedSeenState(value: unknown): value is PersistedSeenState {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return v.version === SEEN_STORE_VERSION && isEntriesMap(v.entries)
}

function isOlderVersion(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  const version = (value as Record<string, unknown>).version
  return typeof version === 'number' && version < SEEN_STORE_VERSION
}

export class SeenStore {
  /** `false` mientras no se haya intentado leer todavía; ver `load()`. */
  private loaded = false
  private cache: PersistedSeenState | null = null

  private filePath(): string {
    return join(app.getPath('userData'), SEEN_FILE_NAME)
  }

  /**
   * Lee `pr-seen.json` la primera vez que hace falta y cachea el resultado en
   * memoria. Si el archivo no existe, no se puede parsear, o no tiene la
   * forma esperada, cae en un estado vacío sin lanzar — igual criterio que
   * `SettingsStore.load()`.
   */
  private load(): PersistedSeenState {
    if (this.loaded) return this.cache ?? emptyState()

    this.loaded = true
    let raw: string
    try {
      raw = readFileSync(this.filePath(), 'utf-8')
    } catch {
      this.cache = emptyState()
      return this.cache
    }

    try {
      const parsed: unknown = JSON.parse(raw)
      if (isValidPersistedSeenState(parsed)) {
        this.cache = parsed
      } else if (isOlderVersion(parsed)) {
        // Pre-SCM-layer file: its keys can't be mapped to `prKey`. Start fresh.
        this.cache = emptyState()
      } else {
        this.cache = emptyState()
        console.warn('[seen-store] pr-seen.json tiene una forma inválida, se ignora:', raw)
      }
    } catch (error) {
      console.warn('[seen-store] pr-seen.json no se pudo parsear, se ignora:', error)
      this.cache = emptyState()
    }

    return this.cache
  }

  /**
   * Sella el estado "visto" de `prId` con el `updatedAt`/`commentCount`
   * ACTUALES del summary (no valores futuros): si el PR cambia después, la
   * próxima `computeUnread` vuelve a marcarlo no visto.
   */
  markSeen(key: string, snapshot: { updatedAt: string; commentCount: number | null }): void {
    const current = this.load()
    const nextEntries: Record<string, SeenEntry> = {
      ...current.entries,
      [key]: {
        updatedAt: snapshot.updatedAt,
        commentCount: snapshot.commentCount,
        seenAt: new Date().toISOString(),
      },
    }
    this.persist({ version: SEEN_STORE_VERSION, entries: pruneOldest(nextEntries, MAX_ENTRIES) })
  }

  /**
   * `isNew`: sin entrada sellada todavía. `hasUpdates`: el `updatedAt` del
   * summary avanzó desde que se selló (comparación de strings ISO 8601 es
   * válida: mismo orden lexicográfico que cronológico). `hasNewComments`: el
   * `commentCount` actual superó al sellado.
   */
  computeUnread(summary: PullRequestSummary): PrUnread {
    const entry = this.load().entries[prKey(summary.repo, summary.number)]
    if (!entry) {
      return { isNew: true, hasUpdates: false, hasNewComments: false }
    }
    return {
      isNew: false,
      hasUpdates: summary.updatedAt !== entry.updatedAt && summary.updatedAt > entry.updatedAt,
      hasNewComments:
        summary.commentCount !== null &&
        entry.commentCount !== null &&
        summary.commentCount > entry.commentCount,
    }
  }

  /** Escribe atómico y refleja `next` de inmediato en la cache en memoria. */
  private persist(next: PersistedSeenState): void {
    this.writeAtomic(next)
    this.cache = next
    this.loaded = true
  }

  private writeAtomic(data: PersistedSeenState): void {
    const finalPath = this.filePath()
    const tmpPath = finalPath + '.tmp'
    writeFileSync(tmpPath, JSON.stringify(data, null, 2) + '\n', 'utf-8')
    renameSync(tmpPath, finalPath)
  }
}

/** Si `entries` excede `max`, poda las de `seenAt` más viejo hasta quedar en `max`. */
function pruneOldest(entries: Record<string, SeenEntry>, max: number): Record<string, SeenEntry> {
  const keys = Object.keys(entries)
  if (keys.length <= max) return entries

  const sortedByOldest = keys.sort((a, b) => entries[a].seenAt.localeCompare(entries[b].seenAt))
  const toDrop = new Set(sortedByOldest.slice(0, keys.length - max))
  const pruned: Record<string, SeenEntry> = {}
  for (const key of keys) {
    if (!toDrop.has(key)) pruned[key] = entries[key]
  }
  return pruned
}

/** Instancia única del proceso `main`; `../ipc/handlers.ts` la comparte. */
export const seenStore = new SeenStore()
