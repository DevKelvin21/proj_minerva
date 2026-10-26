/**
 * Persistencia a disco de análisis didácticos (T40), mismo patrón que
 * `../settings/store.ts` (leerlo ahí de referencia): un `analyses.json` plano
 * en `app.getPath('userData')`, carga perezosa con cache en memoria, y
 * escritura atómica (tmp + rename) para no dejar el archivo a medio escribir
 * si el proceso muere a mitad de la escritura.
 *
 * Quien usa este módulo es `./analysis-cache.ts` (T40): la `AnalysisCache`
 * (Map en memoria, LRU, cap 20) se hidrata de acá en el primer acceso y hace
 * write-through en cada `set`/`invalidate`. Este módulo NO sabe nada de LRU
 * ni de claves por PR — solo persiste/lee la lista de entries en el orden que
 * le pasen (la recencia la decide `AnalysisCache`).
 *
 * Forma en disco: `{ version: 2, entries: [{ key, analysis }] }` — `key` es
 * `prKey(repo, number)` (`shared/scm.ts`, provider-neutral since version 2).
 * Version 1 files used `owner/name#number` keys; they are dropped on load
 * (cache only: the worst case is re-paying one analysis per PR),
 * `analysis` es un `DidacticAnalysis` completo (con `headSha`+`generatedWith`
 * sellados por el handler, T39/T40). El orden del array es recencia LRU:
 * menos reciente primero, más reciente último.
 *
 * `load()` es tolerante a corrupción: archivo ausente -> vacío sin log (caso
 * normal, todavía no se persistió nada); JSON inválido o con forma
 * incorrecta -> vacío + `console.warn` (algo raro pasó, pero no debe
 * crashear la app). Cada entry se valida individualmente (`key` string no
 * vacío + `analysis` con la forma completa de `DidacticAnalysis`, incluidos
 * `headSha` string y `generatedWith` con `provider`/`model`/`options`) —
 * entries que no validan se DESCARTAN sin tumbar las demás (defensivo ante,
 * p. ej., una versión vieja de la app que persistió una forma distinta).
 */
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { isAiProviderId } from '../../shared/ai-providers'
import type { AnalysisGenerationInfo, DidacticAnalysis, DidacticSection } from '../../shared/types'

const ANALYSES_FILE_NAME = 'analyses.json'

/** Bumped when the key format changes; older files are dropped, never migrated. */
const ANALYSES_STORE_VERSION = 2

/** Cap de entries persistidas, igual al `MAX_ENTRIES` de `AnalysisCache` (T14/T40). */
const MAX_ENTRIES = 20

/** Una entrada persistida: clave `prKey(repo, number)` + el análisis completo. */
export interface AnalysisStoreEntry {
  key: string
  analysis: DidacticAnalysis
}

/** Forma completa del archivo en disco. */
interface PersistedAnalyses {
  version: typeof ANALYSES_STORE_VERSION
  entries: AnalysisStoreEntry[]
}

/**
 * API mínima que necesita `./analysis-cache.ts` (T40): una interfaz, no la
 * clase concreta, para que un fake en memoria (tests de `AnalysisCache`) sea
 * asignable sin tener que heredar de `AnalysisStore` ni replicar sus campos
 * privados (`loaded`/`cache`, que TypeScript trata nominalmente).
 */
export interface AnalysisStoreLike {
  loadEntries(): AnalysisStoreEntry[]
  saveEntries(entries: AnalysisStoreEntry[]): void
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  return Object.values(value as Record<string, unknown>).every((entry) => typeof entry === 'string')
}

function isAnalysisGenerationInfo(value: unknown): value is AnalysisGenerationInfo {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return isAiProviderId(v.provider) && isNonEmptyString(v.model) && isStringRecord(v.options)
}

/** Validación superficial de una sección (basta con el discriminante + el markdown común a todas). */
function isDidacticSection(value: unknown): value is DidacticSection {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return typeof v.kind === 'string' && typeof v.markdown === 'string'
}

/** Forma COMPLETA de `DidacticAnalysis` (T39): incluye `headSha` y `generatedWith`, no solo `GeneratedAnalysis`. */
function isDidacticAnalysis(value: unknown): value is DidacticAnalysis {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.prId === 'string' &&
    Array.isArray(v.sections) &&
    v.sections.every(isDidacticSection) &&
    typeof v.generatedAt === 'string' &&
    typeof v.headSha === 'string' &&
    isAnalysisGenerationInfo(v.generatedWith)
  )
}

function isValidEntry(value: unknown): value is AnalysisStoreEntry {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return isNonEmptyString(v.key) && isDidacticAnalysis(v.analysis)
}

/** Forma superficial del archivo (antes de validar cada entry individualmente). */
function isPersistedShape(value: unknown): value is { version: unknown; entries: unknown[] } {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return v.version === ANALYSES_STORE_VERSION && Array.isArray(v.entries)
}

/** A well-formed file from an older schema (different key format). */
function isOlderVersion(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  const version = (value as Record<string, unknown>).version
  return typeof version === 'number' && version < ANALYSES_STORE_VERSION
}

export class AnalysisStore implements AnalysisStoreLike {
  /** `false` mientras no se haya intentado leer todavía; ver `load()`. */
  private loaded = false
  private cache: AnalysisStoreEntry[] = []

  private filePath(): string {
    return join(app.getPath('userData'), ANALYSES_FILE_NAME)
  }

  /**
   * Lee `analyses.json` la primera vez que hace falta y cachea el resultado
   * en memoria para el resto de la vida del proceso. Tolerante a corrupción:
   * ver el JSDoc del módulo para el detalle de cada caso.
   */
  private load(): AnalysisStoreEntry[] {
    if (this.loaded) return this.cache

    this.loaded = true
    let raw: string
    try {
      raw = readFileSync(this.filePath(), 'utf-8')
    } catch {
      this.cache = []
      return this.cache
    }

    try {
      const parsed: unknown = JSON.parse(raw)
      if (isOlderVersion(parsed)) {
        // Old key format: start empty; the next save overwrites the file.
        this.cache = []
        return this.cache
      }
      if (!isPersistedShape(parsed)) {
        console.warn('[analysis-store] analyses.json tiene una forma inválida, se ignora:', raw)
        this.cache = []
        return this.cache
      }

      const valid = parsed.entries.filter(isValidEntry)
      // Defensivo: si el archivo trajera más de MAX_ENTRIES (no debería, ver
      // `saveEntries`), nos quedamos con las más recientes (el final del
      // array, mismo orden LRU que el resto del módulo).
      this.cache = valid.length > MAX_ENTRIES ? valid.slice(valid.length - MAX_ENTRIES) : valid
    } catch (error) {
      console.warn('[analysis-store] analyses.json no se pudo parsear, se ignora:', error)
      this.cache = []
    }

    return this.cache
  }

  /** Entries persistidas, en orden de recencia (menos reciente primero). Vacío si no hay nada válido persistido. */
  loadEntries(): AnalysisStoreEntry[] {
    return this.load()
  }

  /** Persiste `entries` tal cual (recorta a `MAX_ENTRIES`, quedándose con las últimas) y refleja el resultado en la cache en memoria. */
  saveEntries(entries: AnalysisStoreEntry[]): void {
    const capped = entries.length > MAX_ENTRIES ? entries.slice(entries.length - MAX_ENTRIES) : entries
    this.writeAtomic(capped)
    this.cache = capped
    this.loaded = true
  }

  private writeAtomic(entries: AnalysisStoreEntry[]): void {
    const data: PersistedAnalyses = { version: ANALYSES_STORE_VERSION, entries }
    const finalPath = this.filePath()
    const tmpPath = finalPath + '.tmp'
    writeFileSync(tmpPath, JSON.stringify(data, null, 2) + '\n', 'utf-8')
    renameSync(tmpPath, finalPath)
  }
}

/** Instancia única del proceso `main`; `./analysis-cache.ts` la usa como default de inyección. */
export const analysisStore = new AnalysisStore()
