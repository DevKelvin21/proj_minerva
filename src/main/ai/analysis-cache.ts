/**
 * Cache de análisis didácticos (T14, disk-backed desde T40), para que abrir
 * la ventana desacoplada (o simplemente volver a un PR ya analizado) no
 * vuelva a pagar una llamada al LLM — y, desde T40, para que el análisis
 * sobreviva un reinicio de la app. `ai:analyzePullRequest` (`../ipc/handlers.ts`)
 * consulta `get()` antes de invocar al `AiService`: un hit devuelve el
 * análisis tal cual, SIN llamar al servicio y SIN emitir ningún evento de
 * streaming (no hay nada que streamear, ya está completo). Al terminar un
 * análisis con éxito, el handler lo guarda con `set()`.
 *
 * LRU simple acotado a `MAX_ENTRIES`: un `Map` preserva orden de inserción,
 * así que basta con borrar y reinsertar una clave para "refrescarla" como la
 * más reciente (tanto en `get` como en `set`), y borrar la primera clave
 * (`.keys().next().value`, la menos recientemente usada) cuando el tamaño se
 * pasa del límite tras un `set`.
 *
 * `invalidate()` la usa el botón "Re-analizar": borra la entrada de ESE PR
 * (si había) sin tocar el resto del cache ni relanzar nada por su cuenta —
 * quien la llama es responsable de invocar `ai:analyzePullRequest` después.
 *
 * Persistencia (T40): el `Map` en memoria es la fuente de verdad en runtime;
 * `./analysis-store.ts` es solo el respaldo en disco. Se hidrata
 * PEREZOSAMENTE en el primer acceso (`get`/`set`/`invalidate`/`size`), nunca
 * en el constructor (mismo motivo que `app.getPath('userData')` en
 * `analysis-store.ts`: la app puede no estar ready al construir el
 * singleton de módulo). `set`/`invalidate` hacen write-through: tras mutar
 * el `Map`, se serializan TODAS sus entries (en su orden actual, que ya es
 * el orden LRU) y se persisten de una — así el evict de la más antigua
 * también se refleja en disco. El store se inyecta por constructor (default
 * al singleton real) para poder testear con un fake en memoria sin tocar
 * disco.
 */
import { prKey, type RepoRef } from '../../shared/scm'
import type { DidacticAnalysis } from '../../shared/types'
import { analysisStore, type AnalysisStoreLike } from './analysis-store'

const MAX_ENTRIES = 20

export class AnalysisCache {
  private readonly entries = new Map<string, DidacticAnalysis>()
  private hydrated = false

  constructor(private readonly store: AnalysisStoreLike = analysisStore) {}

  /** Puebla el `Map` desde disco en orden LRU, una sola vez por instancia. */
  private hydrate(): void {
    if (this.hydrated) return
    this.hydrated = true
    for (const { key, analysis } of this.store.loadEntries()) {
      this.entries.set(key, analysis)
    }
  }

  /** Serializa el `Map` actual (ya en orden LRU) y lo persiste de una. */
  private persist(): void {
    const serialized = [...this.entries.entries()].map(([key, analysis]) => ({ key, analysis }))
    this.store.saveEntries(serialized)
  }

  /** `null` si no hay entrada para ese PR. Un hit refresca su recencia (LRU). */
  get(repo: RepoRef, number: number): DidacticAnalysis | null {
    this.hydrate()
    const key = prKey(repo, number)
    const value = this.entries.get(key)
    if (value === undefined) return null

    this.entries.delete(key)
    this.entries.set(key, value)
    return value
  }

  /** Guarda/reemplaza la entrada de ese PR como la más reciente; evict de la más antigua si se pasa de `MAX_ENTRIES`. Write-through a disco. */
  set(repo: RepoRef, number: number, analysis: DidacticAnalysis): void {
    this.hydrate()
    const key = prKey(repo, number)
    this.entries.delete(key)
    this.entries.set(key, analysis)

    if (this.entries.size > MAX_ENTRIES) {
      const oldestKey = this.entries.keys().next().value
      if (oldestKey !== undefined) {
        this.entries.delete(oldestKey)
      }
    }

    this.persist()
  }

  /** Borra la entrada de ese PR si había una; no-op si no. Write-through a disco. */
  invalidate(repo: RepoRef, number: number): void {
    this.hydrate()
    this.entries.delete(prKey(repo, number))
    this.persist()
  }

  /** Solo para tests: cuántas entradas hay guardadas ahora mismo. */
  get size(): number {
    this.hydrate()
    return this.entries.size
  }
}

/** Instancia única compartida por todos los handlers IPC (`../ipc/handlers.ts`). */
export const analysisCache = new AnalysisCache()
