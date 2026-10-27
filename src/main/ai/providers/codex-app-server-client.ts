/**
 * Cliente JSON-RPC 2.0 mínimo para hablar con el binario OFICIAL `codex
 * app-server` (Codex CLI de OpenAI) por stdio (T29). Esto NO reimplementa
 * OAuth ni habla con `chatgpt.com/backend-api`: spawnea el binario `codex`
 * que el usuario ya instaló y autenticó con `codex login` (misma decisión de
 * arquitectura que `../providers/claude-code-service.ts`, T28, con el Agent
 * SDK oficial de Claude) — este módulo solo sabe framear/correlacionar
 * mensajes JSON-RPC con el proceso hijo, nunca toca credenciales.
 *
 * FRAMING (IMPORTANTE, léelo antes de tocar `handleLine`/`writeMessage`):
 * un checkout de `packages/effect-codex-app-server` de t3code (la referencia
 * de wire que pidió el orquestador) NO estaba disponible en este sandbox al
 * implementar esto — no hay forma de verificar el framing exacto byte a
 * byte. Se optó por **line-delimited JSON** (un objeto JSON por línea,
 * terminada en '\n', SIN headers `Content-Length` estilo LSP/MCP) porque:
 * (a) es el formato que usa `codex proto`/`codex exec --json` (el protocolo
 * de eventos de la CLI, documentado como JSONL) y (b) es más simple de
 * parsear a mano sin una librería de framing. SI el `codex app-server` real
 * usa headers `Content-Length` en su lugar, el único lugar que hay que
 * tocar es `onStdoutChunk`/`writeMessage` de abajo — el resto del cliente
 * (correlación de ids, notificaciones, timeouts) es agnóstico del framing.
 * Marcar esto como PENDIENTE DE VERIFICAR contra un binario `codex` real
 * (acción humana: Edilson instala y loguea `codex`, ver TASKS.md § T29).
 *
 * SECUENCIA DE MÉTODOS (dictada por el orquestador en el prompt de esta
 * tarea, igualmente sin poder verificarla contra t3code en este sandbox):
 * `initialize` (request) → `initialized` (notification, sin id) →
 * `account/read` (request, valida sesión) → `thread/start` (request, abre
 * un hilo/conversación) → `turn/start` (request, dispara una generación) →
 * notificaciones `item/*` con los deltas de texto del asistente mientras el
 * turno corre. Quien arma esa secuencia es `./codex-service.ts`; este
 * módulo solo expone `request`/`notify`/`onNotification`.
 *
 * RESOLUCIÓN DEL BINARIO (T31): el paquete `codex` NO se bundlea (Minerva usa
 * la instalación del sistema, ver `.agents/TASKS.md` § F7). Antes de
 * spawnear, `./resolve-cli.ts` busca el binario en `PATH` y en ubicaciones
 * comunes que un proceso GUI (lanzado desde un `.desktop`/AppImage) podría no
 * heredar de una terminal interactiva. Si no aparece en ningún lado, se
 * lanza `CodexSpawnError` ANTES de intentar el `spawn` (evita depender del
 * `PATH` que Node resolvería internamente, que es el mismo problema).
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { app } from 'electron'
import { mt } from '../../i18n'
import { resolveCliPath } from './resolve-cli'
import { buildSanitizedSpawnEnv } from './spawn-env'

/** Timeout por defecto de una request JSON-RPC individual (distinto de los timeouts de análisis de `../analysis-timeouts.ts`, que cubren el pipeline completo). */
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000

/** Se lanza cuando el binario no se pudo spawnear (ausente en PATH u otro fallo de `child_process.spawn`). */
export class CodexSpawnError extends Error {}

/** Se lanza cuando el proceso `codex` terminó (o nunca arrancó) mientras había requests pendientes. */
export class CodexProcessExitError extends Error {}

/** Se lanza cuando el servidor responde con un objeto `error` JSON-RPC (método desconocido, error de dominio, etc.). */
export class JsonRpcRemoteError extends Error {
  constructor(
    message: string,
    readonly code: number,
    readonly data?: unknown,
  ) {
    super(message)
  }
}

export interface JsonRpcNotification {
  method: string
  params?: unknown
}

interface JsonRpcMessage {
  jsonrpc?: string
  id?: number | string
  method?: string
  params?: unknown
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timeoutId: ReturnType<typeof setTimeout>
}

// Proceso(s) hijo vivos, para poder matarlos si Electron cierra a mitad de un
// análisis (gotcha de TASKS.md § T29: "proceso hijo de larga vida gestionado
// desde main (matar en app.quit)" — acá cada análisis spawnea su propio
// proceso EFÍMERO (ver `./codex-service.ts`, se mata en su `finally`), pero
// este registro es la red de seguridad para el caso en que la app se cierre
// A MITAD de un análisis, antes de que ese `finally` corra.
const liveChildren = new Set<ChildProcessWithoutNullStreams>()
let quitHookRegistered = false

function ensureQuitHookRegistered(): void {
  if (quitHookRegistered) return
  quitHookRegistered = true
  app.on('before-quit', () => {
    for (const child of liveChildren) {
      try {
        child.kill('SIGKILL')
      } catch {
        // Ya murió o nunca llegó a spawnear del todo: no hay nada que limpiar.
      }
    }
    liveChildren.clear()
  })
}

function describeSpawnError(binary: string, error: unknown): string {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  if (code === 'ENOENT') {
    return mt('ai.codex.binaryNotInPath', { binary })
  }
  const message = error instanceof Error ? error.message : String(error)
  return mt('ai.errors.spawnFailed', { binary, detail: message })
}

/** Mensaje accionable cuando `resolveCliPath` no encuentra el binario en ninguna ubicación conocida (ni siquiera se intenta el `spawn`). */
function describeUnresolvedBinary(binary: string): string {
  return mt('ai.codex.binaryNotInstalled', { binary })
}

export interface CodexAppServerClientOptions {
  /** Binario a spawnear; por defecto "codex" (resuelto por PATH). */
  binary?: string
  /** Argumentos del subcomando; por defecto ["app-server"]. */
  args?: string[]
}

/**
 * Envuelve UN proceso `codex app-server` y el framing JSON-RPC 2.0 sobre su
 * stdio. Vida corta: una instancia por análisis (`./codex-service.ts`), se
 * descarta con `kill()` al terminar (éxito, error o timeout).
 */
export class CodexAppServerClient {
  private readonly child: ChildProcessWithoutNullStreams
  private nextId = 1
  private readonly pending = new Map<number, PendingRequest>()
  private readonly notificationHandlers = new Set<(n: JsonRpcNotification) => void>()
  private lineBuffer = ''
  private closed = false
  private closeError: Error | null = null

  constructor(options: CodexAppServerClientOptions = {}) {
    const requestedBinary = options.binary ?? 'codex'
    const args = options.args ?? ['app-server']

    // Resolver ANTES de spawnear (T31): `codex` no se bundlea, así que este
    // paso reemplaza confiar en el `PATH` que `child_process.spawn`
    // resolvería internamente (que en un proceso GUI puede venir recortado,
    // ver el comentario grande del módulo). Solo se resuelve el binario por
    // defecto: si el caller pasó un `options.binary` explícito (tests, o un
    // futuro override) se respeta tal cual.
    const binary = options.binary === undefined ? resolveCliPath('codex') : requestedBinary
    if (binary === null) {
      throw new CodexSpawnError(describeUnresolvedBinary(requestedBinary))
    }

    let child: ChildProcessWithoutNullStreams
    try {
      child = spawn(binary, args, {
        env: buildSanitizedSpawnEnv(),
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch (error) {
      throw new CodexSpawnError(describeSpawnError(binary, error))
    }
    this.child = child

    liveChildren.add(this.child)
    ensureQuitHookRegistered()

    // `spawn` no lanza sincrónicamente por ENOENT: el proceso "fantasma" emite
    // 'error' de forma asíncrona. Como el caller llama a `request('initialize', ...)`
    // inmediatamente después de construir el cliente (mismo tick, antes de
    // cualquier `await`), esa request YA está en `this.pending` para cuando este
    // handler dispara, así que se puede rechazar de inmediato en vez de esperar
    // el timeout de la request.
    this.child.on('error', (error) => {
      this.failFatally(new CodexSpawnError(describeSpawnError(binary, error)))
    })

    this.child.stdout.on('data', (chunk: Buffer) => this.onStdoutChunk(chunk))

    // El stderr de `codex` puede traer diagnóstico útil para depurar en dev,
    // pero nunca contenido a mostrarle al usuario final ni tokens de sesión:
    // solo se loguea en consola de main, igual que los `console.warn` del
    // resto del pipeline de IA.
    this.child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8').trim()
      if (text.length > 0) console.warn('[codex app-server stderr]', text)
    })

    this.child.on('exit', (code, signal) => {
      liveChildren.delete(this.child)
      if (this.closed) return
      this.failFatally(
        new CodexProcessExitError(
          mt('ai.codex.processExited', { code: String(code), signal: String(signal) }),
        ),
      )
    })
  }

  /** Rechaza todas las requests pendientes y marca el cliente como cerrado: cualquier request futura rechaza de inmediato con el mismo error. */
  private failFatally(error: Error): void {
    if (this.closed) return
    this.closed = true
    this.closeError = error
    for (const { reject, timeoutId } of this.pending.values()) {
      clearTimeout(timeoutId)
      reject(error)
    }
    this.pending.clear()
  }

  private onStdoutChunk(chunk: Buffer): void {
    this.lineBuffer += chunk.toString('utf-8')
    const lines = this.lineBuffer.split('\n')
    this.lineBuffer = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed.length === 0) continue
      this.handleLine(trimmed)
    }
  }

  private handleLine(line: string): void {
    let message: JsonRpcMessage
    try {
      message = JSON.parse(line) as JsonRpcMessage
    } catch {
      // Línea no-JSON (log suelto del binario mezclado en stdout, por ejemplo):
      // se ignora en vez de tumbar todo el framing por una línea rara.
      return
    }

    const hasId = typeof message.id !== 'undefined'
    const isResponse = hasId && ('result' in message || 'error' in message)
    if (isResponse) {
      this.handleResponse(message)
      return
    }

    if (typeof message.method === 'string') {
      if (hasId) {
        // Request del servidor hacia nosotros (p. ej. un prompt de
        // aprobación de herramienta). Este análisis es de una sola vuelta
        // sin tools (mismo espíritu que `ClaudeCodeAiService`, T28), así que
        // no hay nada que aprobar: se responde con un error JSON-RPC
        // explícito para no dejar al servidor esperando indefinidamente una
        // respuesta que nunca llegaría.
        this.writeMessage({
          jsonrpc: '2.0',
          id: message.id,
          error: { code: -32601, message: 'Minerva no soporta requests del servidor (' + message.method + ').' },
        })
        return
      }
      // Notificación (sin id): la más relevante para nosotros son los
      // eventos `item/*` con deltas de texto (ver `extractTextDelta` en
      // `./codex-service.ts`).
      for (const handler of this.notificationHandlers) {
        handler({ method: message.method, params: message.params })
      }
    }
  }

  private handleResponse(message: JsonRpcMessage): void {
    const id = typeof message.id === 'number' ? message.id : Number(message.id)
    const pending = this.pending.get(id)
    if (!pending) return // respuesta a un id que ya expiró/fue descartado
    this.pending.delete(id)
    clearTimeout(pending.timeoutId)
    if (message.error) {
      pending.reject(new JsonRpcRemoteError(message.error.message, message.error.code, message.error.data))
      return
    }
    pending.resolve(message.result)
  }

  private writeMessage(message: unknown): void {
    if (this.closed) return
    this.child.stdin.write(JSON.stringify(message) + '\n')
  }

  /** Manda una request JSON-RPC y devuelve una promesa que resuelve con `result` (o rechaza con `JsonRpcRemoteError`/error fatal del proceso). */
  request<T = unknown>(method: string, params?: unknown, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS): Promise<T> {
    if (this.closed) {
      return Promise.reject(this.closeError ?? new Error(mt('ai.codex.clientClosed')))
    }

    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(mt('ai.codex.requestTimeout', { method, ms: timeoutMs })))
      }, timeoutMs)

      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timeoutId })
      this.writeMessage({ jsonrpc: '2.0', id, method, params })
    })
  }

  /** Manda una notificación JSON-RPC (sin id, sin respuesta esperada). */
  notify(method: string, params?: unknown): void {
    this.writeMessage({ jsonrpc: '2.0', method, params })
  }

  /** Suscribe un handler a TODAS las notificaciones entrantes; devuelve una función para desuscribirse. */
  onNotification(handler: (notification: JsonRpcNotification) => void): () => void {
    this.notificationHandlers.add(handler)
    return () => this.notificationHandlers.delete(handler)
  }

  /** Mata el proceso hijo y rechaza cualquier request pendiente. Idempotente: llamar SIEMPRE en el `finally` del pipeline (éxito, error o timeout). */
  kill(): void {
    if (this.closed) {
      // Puede que ya se haya cerrado por un 'exit'/'error' async, pero el
      // proceso en sí podría seguir vivo si el cierre vino de otra causa
      // (p. ej. `failFatally` disparado por un error de escritura). Se
      // intenta matarlo igual, sin lanzar si ya no existe.
      try {
        this.child.kill('SIGKILL')
      } catch {
        // noop
      }
      return
    }
    this.failFatally(new Error(mt('ai.codex.cancelled')))
    liveChildren.delete(this.child)
    try {
      this.child.kill('SIGTERM')
    } catch {
      // noop
    }
  }
}
