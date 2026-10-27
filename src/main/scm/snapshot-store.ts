/**
 * Copia local del repo AL COMMIT (`headSha`) de un PR (T54): los proveedores
 * de IA agénticos (Claude Code / Codex / OpenCode, ver `.agents/PLAN.md`)
 * necesitan un directorio real que explorar con herramientas read-only, no
 * solo el diff. La fuente de la copia es `ScmProvider.writeSnapshot`
 * (tarball real vía Octokit en GitHub, árbol fixture en el mock) — este módulo solo se
 * encarga del PATH en disco: dedupe, atomicidad y limpieza periódica.
 *
 * `app.getPath('userData')` se resuelve SIEMPRE dentro de una función (nunca
 * a nivel de módulo), mismo motivo que `../settings/store.ts`: `app` puede no
 * estar `ready` todavía cuando este módulo se importa.
 *
 * El contenido de un snapshot es NO CONFIABLE (viene de un PR externo):
 * ninguna parte de este módulo lo ejecuta ni lo interpreta, solo lo copia y
 * lo borra como bytes.
 */
import { existsSync, type Dirent } from 'node:fs'
import { mkdir, readdir, rename, rm, stat, utimes } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { app } from 'electron'
import { repoKey, type RepoRef } from '../../shared/scm'
import type { ScmProvider } from './provider'

/** What `ensureSnapshot` needs from a provider. */
export type SnapshotWriter = Pick<ScmProvider, 'writeSnapshot'>

/** Tope de snapshots retenidos en disco (LRU por mtime); ver `createSnapshotCleaner`. */
export const MAX_SNAPSHOTS = 10

/** Tope de bytes totales del directorio `snapshots/` (LRU por mtime); ver `createSnapshotCleaner`. */
export const MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024

/** Cada cuánto corre el barrido periódico (además del barrido inmediato en `start()`). */
const SWEEP_INTERVAL_MS = 30 * 60 * 1000

/** Prefijo de los directorios temporales usados durante la escritura atómica (`ensureSnapshot`) y detectados como huérfanos por `sweep()`. */
const TMP_DIR_PREFIX = '.tmp-'

const SAFE_SEGMENT_RE = /[^A-Za-z0-9._-]/g

/**
 * Sanitiza un segmento de path a la whitelist `[A-Za-z0-9._-]` (T54):
 * cualquier otro carácter, incluido `/`, se reemplaza por `-`. Esto colapsa
 * inputs maliciosos como `../../evil` a un ÚNICO segmento sin separadores
 * (`..-..-evil`) — no puede escapar `snapshots/` porque nunca vuelve a
 * contener `/`. Un resultado vacío (owner/name/sha vacíos) cae a `'x'` para
 * no producir segmentos vacíos o compuestos solo por guiones.
 */
function sanitizeSegment(input: string): string {
  const sanitized = input.replace(SAFE_SEGMENT_RE, '-')
  return sanitized.length > 0 ? sanitized : 'x'
}

/**
 * `<provider>-<name>-<hash10>-<sha7>`: readable, filesystem-safe for every
 * `RepoRef` shape, and collision-free — the short hash of `repoKey` tells
 * apart repos whose sanitized names collapse to the same string
 * (`a-b/c` vs `a/b-c`, or the same repo name in two Azure projects).
 */
function snapshotDirName(repo: RepoRef, headSha: string): string {
  const name = sanitizeSegment(repo.name)
  const repoHash = createHash('sha256').update(repoKey(repo)).digest('hex').slice(0, 10)
  const sha7 = sanitizeSegment(headSha.slice(0, 7))
  return repo.provider + '-' + name + '-' + repoHash + '-' + sha7
}

function snapshotsRootDir(): string {
  return join(app.getPath('userData'), 'snapshots')
}

async function touchDir(dirPath: string): Promise<void> {
  const now = new Date()
  await utimes(dirPath, now, now)
}

/**
 * Descargas en vuelo, módulo-local (patrón `inFlightAnalyses` de
 * `../ipc/handlers.ts`, T22): dos análisis concurrentes del MISMO PR al
 * MISMO commit comparten la misma descarga en vez de pagarla dos veces. La
 * clave incluye el repo completo (no solo el sha) porque dos repos distintos
 * podrían compartir un prefijo de sha por casualidad.
 */
const inFlightSnapshots = new Map<string, Promise<string>>()

/** Contador módulo-local para que dos descargas concurrentes del MISMO proceso con el MISMO sha7 (repos distintos) nunca compartan directorio temporal. */
let tmpDirSeq = 0

function inFlightKey(repo: RepoRef, headSha: string): string {
  return repoKey(repo) + '@' + headSha
}

async function ensureSnapshotUncached(
  writer: SnapshotWriter,
  repo: RepoRef,
  headSha: string,
): Promise<string> {
  const root = snapshotsRootDir()
  await mkdir(root, { recursive: true })

  const finalDir = join(root, snapshotDirName(repo, headSha))

  if (existsSync(finalDir)) {
    await touchDir(finalDir)
    return finalDir
  }

  tmpDirSeq += 1
  const sha7 = sanitizeSegment(headSha.slice(0, 7))
  const tmpDir = join(root, TMP_DIR_PREFIX + sha7 + '-' + process.pid + '-' + tmpDirSeq)

  await mkdir(tmpDir, { recursive: true })
  try {
    await writer.writeSnapshot({ repo, headSha }, tmpDir)
  } catch (error) {
    // Escritura atómica: un `writeSnapshot` que falla a mitad de camino NUNCA
    // deja un directorio final a medias — el temporal se borra y el error
    // sube tal cual.
    await rm(tmpDir, { recursive: true, force: true })
    throw error
  }

  try {
    await rename(tmpDir, finalDir)
  } catch {
    // Carrera: otra llamada (mismo proceso u otro) ya completó este MISMO
    // snapshot primero. El temporal propio se descarta y se reutiliza el
    // que ganó la carrera; si ni eso existe, el error original de la carrera
    // es lo único que tiene sentido reportar.
    await rm(tmpDir, { recursive: true, force: true })
    if (existsSync(finalDir)) {
      await touchDir(finalDir)
      return finalDir
    }
    throw new Error(
      'Could not finalize the snapshot of ' + repo.fullName + '@' + sha7 + ' (rename failed).',
    )
  }

  return finalDir
}

/**
 * Devuelve el path a la copia local del repo `repo` al commit `headSha`,
 * descargándola/escribiéndola si hace falta (`ScmProvider.writeSnapshot`).
 * Reusa un snapshot existente (tocando su mtime) y dedupea llamadas
 * concurrentes para el mismo repo+sha.
 */
export function ensureSnapshot(
  writer: SnapshotWriter,
  repo: RepoRef,
  headSha: string,
): Promise<string> {
  const key = inFlightKey(repo, headSha)
  const existing = inFlightSnapshots.get(key)
  if (existing) return existing

  const promise = ensureSnapshotUncached(writer, repo, headSha).finally(() => {
    inFlightSnapshots.delete(key)
  })
  inFlightSnapshots.set(key, promise)
  return promise
}

async function dirSizeBytes(dirPath: string): Promise<number> {
  let total = 0
  const entries = await readdir(dirPath, { withFileTypes: true })
  for (const entry of entries) {
    const entryPath = join(dirPath, entry.name)
    if (entry.isDirectory()) {
      total += await dirSizeBytes(entryPath)
    } else if (entry.isFile()) {
      const stats = await stat(entryPath)
      total += stats.size
    }
  }
  return total
}

interface SnapshotCandidate {
  path: string
  mtimeMs: number
  bytes: number
}

export interface SnapshotCleaner {
  /** Barrido inmediato + arranca el timer periódico (30 min, `.unref()`d — no mantiene vivo el proceso). Idempotente: llamar dos veces no duplica el timer. */
  start(): void
  /** Detiene el timer periódico. Sin efecto si no estaba arrancado. Cablear en `app.on('before-quit')`. */
  stop(): void
  /** Un barrido: borra `.tmp-*` huérfanos y aplica LRU por count (`MAX_SNAPSHOTS`) y por bytes (`MAX_TOTAL_BYTES`). Tolerante a errores por-entrada. */
  sweep(): Promise<void>
}

/**
 * Fábrica del barrido periódico de `snapshots/` (T54). `maxSnapshots`/
 * `maxTotalBytes`/`intervalMs` son overrides opcionales sobre las constantes
 * exportadas — pensados para tests (escribir 2 GB reales en cada corrida de
 * `vitest` sería absurdo); en producción `createSnapshotCleaner()` se llama
 * sin argumentos y usa los defaults reales.
 */
export function createSnapshotCleaner(options?: {
  maxSnapshots?: number
  maxTotalBytes?: number
  intervalMs?: number
}): SnapshotCleaner {
  const maxSnapshots = options?.maxSnapshots ?? MAX_SNAPSHOTS
  const maxTotalBytes = options?.maxTotalBytes ?? MAX_TOTAL_BYTES
  const intervalMs = options?.intervalMs ?? SWEEP_INTERVAL_MS

  let timer: ReturnType<typeof setInterval> | null = null

  async function sweep(): Promise<void> {
    const root = snapshotsRootDir()
    let entries: Dirent[]
    try {
      entries = await readdir(root, { withFileTypes: true })
    } catch {
      // Sin directorio `snapshots/` todavía (app recién instalada, o mock
      // que nunca generó uno): nada que barrer.
      return
    }

    const candidates: SnapshotCandidate[] = []

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const entryPath = join(root, entry.name)

      if (entry.name.startsWith(TMP_DIR_PREFIX)) {
        // Temporal huérfano: una escritura anterior murió a mitad de camino
        // (crash del proceso) y nunca llegó al `rename` final. Se borra
        // siempre, sin contar para los topes de LRU.
        await rm(entryPath, { recursive: true, force: true }).catch(() => {})
        continue
      }

      try {
        const stats = await stat(entryPath)
        const bytes = await dirSizeBytes(entryPath)
        candidates.push({ path: entryPath, mtimeMs: stats.mtimeMs, bytes })
      } catch {
        // Entrada no legible (borrada por otro proceso a mitad del barrido,
        // permisos, etc.): se ignora, no debe tumbar el resto del sweep.
      }
    }

    // LRU ascendente: el snapshot menos recientemente usado (mtime más
    // viejo) primero, así se borra antes que nada.
    candidates.sort((a, b) => a.mtimeMs - b.mtimeMs)

    let count = candidates.length
    let totalBytes = candidates.reduce((sum, c) => sum + c.bytes, 0)

    for (const candidate of candidates) {
      if (count <= maxSnapshots && totalBytes <= maxTotalBytes) break
      try {
        await rm(candidate.path, { recursive: true, force: true })
        count -= 1
        totalBytes -= candidate.bytes
      } catch {
        // Un directorio que no se pudo borrar no debe tumbar el resto del
        // barrido: se sigue con el siguiente candidato.
      }
    }
  }

  const cleaner: SnapshotCleaner = {
    start() {
      // Referencia a `cleaner.sweep` (no a la función local `sweep`) para
      // que un mock de `sweep` puesto DESPUÉS de crear el cleaner (p. ej.
      // `vi.spyOn(cleaner, 'sweep')` en tests) también aplique acá.
      void cleaner.sweep()
      if (timer) return
      timer = setInterval(() => {
        void cleaner.sweep()
      }, intervalMs)
      timer.unref()
    },
    stop() {
      if (timer) {
        clearInterval(timer)
        timer = null
      }
    },
    sweep,
  }

  return cleaner
}
