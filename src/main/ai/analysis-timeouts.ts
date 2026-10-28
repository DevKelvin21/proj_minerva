/**
 * Lógica de doble timeout compartida entre los proveedores de IA que
 * streamean una respuesta larga desde un backend externo (`ClaudeCodeAiService`,
 * T28, vía el Agent SDK oficial; `CodexAiService`, T29, vía JSON-RPC;
 * `OpenCodeAiService`, T56, vía el server local): un timeout TOTAL desde que
 * arranca el análisis y un timeout de INACTIVIDAD que se reinicia con cada
 * delta recibido. Cualquiera de los dos aborta el `AbortController` que el
 * proveedor ya le pasa a su transporte (fetch con `signal`, o
 * `Options.abortController` del Agent SDK).
 *
 * `getAbortReason()` le dice a quien llama CUÁL de los dos disparó el abort
 * (o `null` si el controller nunca fue abortado por este helper — p. ej. lo
 * abortó el usuario cancelando desde la UI, si eso existiera hoy) para que
 * cada proveedor arme su propio mensaje final con su propio nombre ("timeout
 * total de Codex" vs. "timeout total de Claude Code").
 */
import { mt } from '../i18n'

/** Timeout total del análisis completo (desde que arranca hasta el último delta). */
export const REQUEST_TIMEOUT_MS = 120_000
/** Si pasan más de esto sin recibir NINGÚN delta nuevo, se aborta (conexión/proceso colgado). */
export const INACTIVITY_TIMEOUT_MS = 20_000
/** Cuánto, como mucho, se llama a `onProgress` mientras llegan deltas (ver `./throttle.ts`). */
export const PROGRESS_THROTTLE_MS = 150

/**
 * Timeouts AGÉNTICOS (F11): un análisis con herramientas explora el snapshot
 * (grep/read del repo) ANTES de emitir la primera sección — mucho más lento
 * que la generación directa de texto. El de inactividad también sube: entre
 * delta y delta puede haber vueltas enteras de tool-use sin texto nuevo.
 * Los usan los tres proveedores agentizados (OpenCode/Claude Code/Codex).
 */
export const AGENTIC_REQUEST_TIMEOUT_MS = 300_000
export const AGENTIC_INACTIVITY_TIMEOUT_MS = 60_000

export type AbortReason = 'total-timeout' | 'inactivity-timeout' | null

export interface AnalysisTimeouts {
  /** Reinicia el timer de inactividad: llamar cada vez que llega un delta/mensaje nuevo. */
  resetInactivityTimer(): void
  /** Cancela ambos timers. Llamar SIEMPRE en el `finally`/catch del pipeline, éxito o error. */
  clearAll(): void
  /** Cuál de los dos timeouts disparó el abort del `controller`, o `null` si ninguno (todavía). */
  getAbortReason(): AbortReason
}

export function createAnalysisTimeouts(
  controller: AbortController,
  options?: { totalMs?: number; inactivityMs?: number },
): AnalysisTimeouts {
  const totalMs = options?.totalMs ?? REQUEST_TIMEOUT_MS
  const inactivityMs = options?.inactivityMs ?? INACTIVITY_TIMEOUT_MS
  let abortReason: AbortReason = null

  const totalTimeoutId = setTimeout(() => {
    abortReason = 'total-timeout'
    controller.abort()
  }, totalMs)

  let inactivityTimeoutId: ReturnType<typeof setTimeout> | null = null

  function resetInactivityTimer(): void {
    if (inactivityTimeoutId !== null) clearTimeout(inactivityTimeoutId)
    inactivityTimeoutId = setTimeout(() => {
      abortReason = 'inactivity-timeout'
      controller.abort()
    }, inactivityMs)
  }

  function clearAll(): void {
    clearTimeout(totalTimeoutId)
    if (inactivityTimeoutId !== null) {
      clearTimeout(inactivityTimeoutId)
      inactivityTimeoutId = null
    }
  }

  return {
    resetInactivityTimer,
    clearAll,
    getAbortReason: () => abortReason,
  }
}

/**
 * Forwards an external abort (`AnalyzePullRequestOptions.signal`: the
 * reviewer cancelled a chat answer) to the provider's own controller, the one
 * its transport and timeouts already use. Returns the unlink, to call when
 * the run ends. Already aborted = aborts at once.
 */
export function forwardAbort(
  signal: AbortSignal | undefined,
  controller: AbortController,
): () => void {
  if (!signal) return () => {}
  if (signal.aborted) {
    controller.abort()
    return () => {}
  }
  const onAbort = (): void => controller.abort()
  signal.addEventListener('abort', onAbort, { once: true })
  return () => signal.removeEventListener('abort', onAbort)
}

/** Throws the "cancelled" error when the external signal already fired (checkpoint between awaits). */
export function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new Error(mt('ai.errors.cancelled'))
}
