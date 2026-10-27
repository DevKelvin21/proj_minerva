/**
 * Implementación real de `AiService` con el binario OFICIAL `codex app-server`
 * (Codex CLI de OpenAI, T29), hablado por JSON-RPC 2.0 sobre stdio
 * (`./codex-app-server-client.ts`) — usa la sesión de suscripción ChatGPT
 * Plus/Pro que el usuario ya autenticó en su máquina con `codex login`. NO
 * hay OAuth propio, reescritura de URLs a `chatgpt.com/backend-api`, ni
 * headers de suplantación acá (ver `.agents/TASKS.md` § F7, "Decisión de
 * arquitectura clave"): el proceso hijo se autentica solo, leyendo la misma
 * sesión que usa el CLI.
 *
 * Pipeline de `analyzePullRequest` (mismo contrato que el resto de los
 * proveedores de IA — `ClaudeCodeAiService`, `OpenCodeAiService` — ver
 * `../service.ts`):
 * 1. Pide el detalle y los archivos del PR al `PrContextSource` (registro SCM)
 *    (inyectado por constructor).
 * 2. AGÉNTICO (F11/T58): `this.context.ensureSnapshot(req.repo, detail.headSha)`
 *    (`../../scm/snapshot-store.ts`, T54) materializa una copia local del
 *    repo AL COMMIT del PR; ese directorio va como `cwd` de `thread/start`
 *    (nombre del parámetro VERIFICADO contra el esquema real generado con
 *    `codex app-server generate-json-schema` en esta tarea —
 *    `ThreadStartParams.cwd: string | null`, T29-lección: no adivinar). El
 *    mensaje de usuario (`buildAgenticUserMessage`, en vez de
 *    `buildUserMessage`) le pide explícitamente que lo explore.
 * 3. Spawnea un `codex app-server` EFÍMERO (una instancia de
 *    `CodexAppServerClient` por análisis, muerta en el `finally`) y hace el
 *    handshake, con la forma de mensajes VERIFICADA contra el protocolo real
 *    de `codex app-server` 0.144.x (esquema generado con
 *    `codex app-server generate-json-schema` + un turno real de humo):
 *      - `initialize` (request) con `clientInfo` + `capabilities`
 *        (`experimentalApi: true` — los métodos v2 `thread/start`/`turn/start`/
 *        `account/read`/`model/list` viven bajo esa capability).
 *      - `initialized` (notification, sin params).
 *      - `account/read` (request `{ refreshToken: false }`) → valida sesión:
 *        `{ account: Account | null, requiresOpenaiAuth }`. OJO:
 *        `requiresOpenaiAuth` es `true` incluso con sesión válida (declara que
 *        el server EXIGE auth de OpenAI, no que falte) — la señal real de "hay
 *        sesión" es `account != null`. Sin cuenta → mensaje accionable.
 *      - `thread/start` (request) con `model`, `baseInstructions` (= nuestro
 *        `buildAnalyzeSystemPrompt(language)`; es el análogo de Codex al `systemPrompt`
 *        custom del Agent SDK), `cwd: snapshotDir` (arriba) y `sandbox:
 *        'read-only'` + `approvalPolicy: 'never'` SIN CAMBIOS (T29): Codex es
 *        un agente de código; sin acotarlo intentaría ejecutar comandos y
 *        pedir aprobaciones. `sandbox: 'read-only'` restringe ESCRITURA, no
 *        LECTURA — el esquema (`SandboxMode` = `'read-only' |
 *        'workspace-write' | 'danger-full-access'`, y el `--help` del propio
 *        binario documenta `sandbox_permissions=["disk-full-read-access"]`
 *        como algo aparte de escritura) confirma que un thread read-only
 *        puede LEER el `cwd` apuntado al snapshot sin problema; nunca podrá
 *        escribir en él ni en ningún otro lado. El id del hilo sale de
 *        `result.thread.id`.
 *      - `turn/start` (request) con `input` = `Array<UserInput>` (un solo
 *        bloque `{ type: 'text', text, text_elements: [] }`) y, desde T36,
 *        `effort` (string `'low'|'medium'|'high'|'xhigh'`, y desde 0.2.4
 *        también `'max'|'ultra'` en la familia GPT-5.6) SOLO si
 *        `getEffectiveAiSelection().options.effort` resolvió a algo — el
 *        modelo activo sin descriptor de effort (T34) deja `options` vacío y
 *        el campo se omite, comportamiento idéntico a antes de T36. CLAVE:
 *        `turn/start` RESUELVE DE INMEDIATO con un ack (`turn.status:
 *        'inProgress'`), NO espera a que el turno termine — el fin llega por
 *        la notificación `turn/completed`. (El bug original de esta clase era
 *        matar el proceso apenas resolvía `turn/start`, antes de recibir un
 *        solo delta.)
 * 4. Durante el turno, el servidor emite notificaciones de items agénticos
 *    (lectura/grep/etc. del snapshot) además de las de texto; los deltas de
 *    texto del asistente llegan SOLO como `item/agentMessage/delta` con
 *    `params.delta` (string) y se empujan al `StreamSectionParser`
 *    (`../stream-parser.ts`), con `onProgress` throttleado — CUALQUIER
 *    notificación (delta de texto o item de tool-use) resetea el timer de
 *    inactividad, no solo las de texto (ver el listener de abajo: el reset
 *    está al tope, antes de distinguir el método). Desde F13 los
 *    `item/started`/`item/completed` (y el hecho — nunca el texto — de
 *    `item/reasoning/textDelta`) alimentan además el mini-log de actividad
 *    (`../activity-tracker.ts`). El fin del turno es
 *    `turn/completed`; una notificación `error` o un `turn.status: 'failed'`
 *    lo aborta.
 * 5. Timeouts AGÉNTICOS compartidos (`../analysis-timeouts.ts`, T56: total
 *    300s / inactividad 60s — más altos que la generación directa porque
 *    explorar el snapshot toma varias notificaciones de tool-use antes del
 *    primer delta de texto) sobre el mismo `AbortController`; al abortar se
 *    mata el cliente.
 * 6. El proceso hijo se mata SIEMPRE en el `finally` — nunca queda huérfano.
 */
import type { AiService, AnalyzePullRequestOptions, AnalyzeResult } from '../service'
import type { PrContextSource } from '../pr-context'
import type { IpcRequest } from '../../../shared/ipc'
import { getEffectiveAiSelection } from '../env'
import { agenticPrompts } from '../task-prompts'
import { getMainLocale, mt } from '../../i18n'
import { prId } from '../analysis-prompt'
import { StreamSectionParser } from '../stream-parser'
import { createThrottle } from '../throttle'
import { createActivityTracker } from '../activity-tracker'
import type { AnalysisActivityKind } from '../../../shared/events'
import {
  AGENTIC_INACTIVITY_TIMEOUT_MS,
  AGENTIC_REQUEST_TIMEOUT_MS,
  createAnalysisTimeouts,
  PROGRESS_THROTTLE_MS,
} from '../analysis-timeouts'
import {
  CodexAppServerClient,
  CodexSpawnError,
  JsonRpcRemoteError,
  type JsonRpcNotification,
} from './codex-app-server-client'

/** Mensaje accionable único para "no hay sesión de Codex". */
function codexLoginHint(): string {
  return mt('ai.codex.loginHint')
}

/** Info de cliente que se envía en `initialize` (aparece en el `userAgent` que arma el server). */
const CLIENT_INFO = { name: 'minerva', title: 'Minerva', version: '0.1.0' }

interface AccountReadResult {
  account: { type?: string; email?: string | null; planType?: string } | null
  requiresOpenaiAuth?: boolean
}

interface ThreadStartResult {
  thread?: { id?: string }
}

/** El texto del asistente llega SOLO por `item/agentMessage/delta` con `params.delta` (string). */
function extractAgentDelta(notification: JsonRpcNotification): string | null {
  if (notification.method !== 'item/agentMessage/delta') return null
  const params = notification.params
  if (!params || typeof params !== 'object') return null
  const delta = (params as Record<string, unknown>).delta
  return typeof delta === 'string' && delta.length > 0 ? delta : null
}

/** `true` si `account/read` no reporta una cuenta (sesión ausente). `requiresOpenaiAuth` se ignora a propósito: es `true` aun con sesión válida. */
function isUnauthenticated(result: unknown): boolean {
  if (!result || typeof result !== 'object') return true
  return (result as AccountReadResult).account == null
}

/** Extrae el id de thread de la respuesta a `thread/start` (`result.thread.id`). */
function extractThreadId(result: unknown): string {
  const id = (result as ThreadStartResult | null)?.thread?.id
  if (typeof id === 'string' && id.length > 0) return id
  throw new Error(mt('ai.codex.noThreadId'))
}

/**
 * Verbo canónico del mini-log (F13) por `item.type` de las notificaciones
 * `item/started`/`item/completed`. Solo `fileRead` está VERIFICADO contra un
 * turno real (fixtures de T58/T60); el resto es mapeo defensivo — un tipo
 * fuera de la tabla cae al genérico `tool` ("Explorando el repositorio…"),
 * que es exactamente el fallback aceptable mientras no se inspeccione el
 * wire real de cada tipo.
 */
const CODEX_ITEM_KIND: Record<string, AnalysisActivityKind> = {
  fileRead: 'read',
  fileSearch: 'search',
  webSearch: 'search',
  fileList: 'list',
  commandExecution: 'tool',
}

/** Tipos de item que NO son actividad de herramientas: el texto de respuesta y el plan interno tienen su propio camino (o se ignoran). */
const CODEX_ITEM_SKIP = new Set(['agentMessage', 'plan'])

/**
 * Item agéntico de `item/started`/`item/completed` (F13). Forma mínima
 * VERIFICADA en fixtures: `params.item: { id, type }`; los campos de detalle
 * (ruta/comando/patrón) NO están verificados en el wire real, así que se
 * sondean defensivamente — si no aparecen, el label queda genérico
 * ("Leyó un archivo"), el fallback aceptado.
 */
function extractCodexItem(
  notification: JsonRpcNotification,
): { id: string; type: string; detail?: string } | null {
  if (notification.method !== 'item/started' && notification.method !== 'item/completed') {
    return null
  }
  const params = notification.params
  if (!params || typeof params !== 'object') return null
  const item = (params as Record<string, unknown>).item
  if (!item || typeof item !== 'object') return null
  const v = item as Record<string, unknown>
  if (typeof v.id !== 'string' || typeof v.type !== 'string') return null
  let detail: string | undefined
  for (const key of ['path', 'filePath', 'command', 'query', 'pattern']) {
    const candidate = v[key]
    if (typeof candidate === 'string' && candidate.length > 0) {
      detail = candidate
      break
    }
  }
  return { id: v.id, type: v.type, detail }
}

/** Mensaje de error de una notificación `error` del servidor, o de un `turn/completed` con `turn.status: 'failed'`. */
function turnFailureMessage(notification: JsonRpcNotification): string | null {
  const params = notification.params as Record<string, unknown> | undefined
  if (notification.method === 'error') {
    const message = params?.message
    return typeof message === 'string' ? message : mt('ai.codex.turnError')
  }
  if (notification.method === 'turn/completed') {
    const turn = params?.turn as { status?: string; error?: unknown } | undefined
    if (turn?.status === 'failed') {
      const err = turn.error
      if (err && typeof err === 'object') {
        const m = (err as Record<string, unknown>).message
        if (typeof m === 'string') return m
      }
      return mt('ai.codex.turnFailed')
    }
  }
  return null
}

export class CodexAiService implements AiService {
  constructor(private readonly context: PrContextSource) {}

  async analyzePullRequest(
    req: IpcRequest<'ai:analyzePullRequest'>,
    options?: AnalyzePullRequestOptions,
  ): Promise<AnalyzeResult> {
    const { model, options: modelOptions } = getEffectiveAiSelection()
    const language = options?.language ?? getMainLocale()

    const [detail, files] = await Promise.all([
      this.context.getDetail(req.repo, req.number),
      this.context.getFiles(req.repo, req.number),
    ])

    // AGÉNTICO (F11/T58): copia local del repo al commit del PR — el `cwd`
    // que se le pasa a `thread/start` (ver el comentario del módulo).
    // Dedupeado/cacheado en disco por `ensureSnapshot` (T54).
    const snapshotDir = await this.context.ensureSnapshot(req.repo, detail.headSha)

    // The full analysis, or a reviewer's question about some lines (`ai:askAboutLines`).
    const prompts = agenticPrompts(detail, files, language, options?.question)
    const userMessage = prompts.userMessage

    const controller = new AbortController()
    const timeouts = createAnalysisTimeouts(controller, {
      totalMs: AGENTIC_REQUEST_TIMEOUT_MS,
      inactivityMs: AGENTIC_INACTIVITY_TIMEOUT_MS,
    })

    const parser = new StreamSectionParser()
    const throttle = createThrottle(PROGRESS_THROTTLE_MS)
    const onProgress = options?.onProgress
    let sawAnyDelta = false
    // Fase del streaming (F11/T60, ver `AnalyzeProgressMeta` en `../service.ts`):
    // arranca "exploring" (el thread todavía no emitió ningún delta de
    // texto, solo pudo haber items de tool-use) y pasa a "writing" en el
    // PRIMER `item/agentMessage/delta` aceptado, sin volver atrás.
    let phase: 'exploring' | 'writing' = 'exploring'
    // Mini-log de actividad del harness (F13, `../activity-tracker.ts`):
    // mismo criterio que Claude Code/OpenCode — las transiciones emiten
    // onProgress SIN throttle.
    const activity = createActivityTracker({
      basePath: snapshotDir,
      language,
      onEdge: () => {
        if (onProgress) {
          onProgress(parser.snapshot(), { done: false, phase, activity: activity.buffer() })
        }
      },
    })

    let client: CodexAppServerClient | null = null
    controller.signal.addEventListener('abort', () => client?.kill())

    const abortErrorMessage = (): string | null => {
      const reason = timeouts.getAbortReason()
      if (reason === 'inactivity-timeout') {
        return mt('ai.errors.inactivityTimeout', {
          provider: 'Codex',
          seconds: AGENTIC_INACTIVITY_TIMEOUT_MS / 1000,
        })
      }
      if (reason === 'total-timeout') {
        return mt('ai.errors.totalTimeout', {
          provider: 'Codex',
          seconds: AGENTIC_REQUEST_TIMEOUT_MS / 1000,
        })
      }
      return null
    }

    timeouts.resetInactivityTimer()

    try {
      client = new CodexAppServerClient()

      await client.request('initialize', {
        clientInfo: CLIENT_INFO,
        capabilities: { experimentalApi: true, requestAttestation: false },
      })
      client.notify('initialized', undefined)

      let account: unknown
      try {
        account = await client.request('account/read', { refreshToken: false })
      } catch (error) {
        throw new Error(codexLoginHint(), { cause: error })
      }
      if (isUnauthenticated(account)) {
        throw new Error(codexLoginHint())
      }

      const threadResult = await client.request('thread/start', {
        model,
        baseInstructions: prompts.systemPrompt,
        // AGÉNTICO (F11/T58): apunta el thread al snapshot local del PR.
        // Nombre de param VERIFICADO contra `ThreadStartParams` del esquema
        // real (`codex app-server generate-json-schema`, T58): `cwd: string
        // | null`. `sandbox: 'read-only'` restringe ESCRITURA, no lectura
        // (ver comentario del módulo) — el thread puede leer libremente
        // dentro (y fuera) de este `cwd`.
        cwd: snapshotDir,
        sandbox: 'read-only',
        approvalPolicy: 'never',
      })
      const threadId = extractThreadId(threadResult)

      // El fin del turno es una NOTIFICACIÓN (`turn/completed`), no la
      // resolución de `turn/start` (que es un ack inmediato). Esta promesa se
      // resuelve/rechaza desde el listener de notificaciones de abajo.
      let resolveTurn!: () => void
      let rejectTurn!: (error: Error) => void
      const turnDone = new Promise<void>((resolve, reject) => {
        resolveTurn = resolve
        rejectTurn = reject
      })

      const unsubscribe = client.onNotification((notification) => {
        // AGÉNTICO (F11/T58): se resetea con CUALQUIER notificación del
        // thread (items de tool-use explorando el snapshot incluidos), no
        // solo con deltas de texto — el agente sigue vivo aunque una vuelta
        // entera sea puro `item/*` de lectura/grep sin texto nuevo.
        timeouts.resetInactivityTimer()

        const delta = extractAgentDelta(notification)
        if (delta !== null) {
          if (phase === 'exploring') phase = 'writing'
          if (!sawAnyDelta) activity.settleThinking()
          sawAnyDelta = true
          parser.push(delta)
          if (onProgress && throttle.shouldRun()) {
            onProgress(parser.snapshot(), { done: false, phase, activity: activity.buffer() })
          }
          return
        }

        // Mini-log (F13): items agénticos begin/complete (lectura, grep,
        // comandos read-only sobre el snapshot). El item `reasoning` es una
        // fila "Pensando…" genérica; `agentMessage`/`plan` se saltan (el
        // texto de respuesta tiene su propio camino arriba, el plan interno
        // se ignora igual que su delta).
        const item = extractCodexItem(notification)
        if (item && !CODEX_ITEM_SKIP.has(item.type)) {
          if (item.type === 'reasoning') {
            if (notification.method === 'item/started') {
              activity.thinking(item.id)
            } else {
              activity.settleThinking()
            }
          } else {
            const kind = CODEX_ITEM_KIND[item.type] ?? 'tool'
            if (notification.method === 'item/started') {
              activity.begin(item.id, kind, item.detail)
            } else {
              activity.complete(item.id, item.detail)
            }
          }
        }

        // Razonamiento streameado (`item/reasoning/textDelta`): solo el
        // HECHO de que razona — `params.delta` se ignora a propósito
        // (prompt injection desde el snapshot; decisión F13, misma que en
        // el resto de proveedores).
        if (notification.method === 'item/reasoning/textDelta') {
          activity.thinking('reasoning')
        }

        // Notificaciones `item/*` que NO son delta de texto (T60: lectura,
        // grep, otros ítems agénticos explorando el snapshot): mientras
        // seguimos "exploring", es la señal de actividad que la UI pinta
        // como "Explorando el repositorio…" — throttleada, nunca cambia
        // `sections`.
        if (
          phase === 'exploring' &&
          notification.method.startsWith('item/') &&
          onProgress &&
          throttle.shouldRun()
        ) {
          onProgress(parser.snapshot(), { done: false, phase, activity: activity.buffer() })
        }

        const failure = turnFailureMessage(notification)
        if (failure !== null) {
          rejectTurn(new Error(mt('ai.errors.providerError', { provider: 'Codex', detail: failure })))
          return
        }
        if (notification.method === 'turn/completed') {
          resolveTurn()
        }
      })

      // `turn/start` resuelve con un ack (`inProgress`); se await-ea solo para
      // capturar un fallo temprano (id de thread inválido, etc.). El resultado
      // NO significa que el turno terminó.
      try {
        await client.request('turn/start', {
          threadId,
          input: [{ type: 'text', text: userMessage, text_elements: [] }],
          // `effort` (T36) SOLO se manda si `modelOptions.effort` resolvió a
          // algo (T34 ya lo valida contra las choices reales del modelo
          // activo, vía `model/list`/T35): si el modelo activo no tiene
          // descriptor de effort, `modelOptions.effort` es `undefined` y el
          // campo se omite ENTERO — mismo comportamiento de hoy (Codex decide
          // su default).
          ...(modelOptions.effort ? { effort: modelOptions.effort } : {}),
        })
        await turnDone
      } finally {
        unsubscribe()
      }
    } catch (error) {
      timeouts.clearAll()
      const abortMessage = abortErrorMessage()
      if (abortMessage) throw new Error(abortMessage, { cause: error })
      if (error instanceof CodexSpawnError) {
        throw new Error(mt('ai.codex.spawnFailed', { detail: error.message }), { cause: error })
      }
      if (error instanceof JsonRpcRemoteError) {
        throw new Error(mt('ai.errors.providerError', { provider: 'Codex', detail: error.message }), {
          cause: error,
        })
      }
      throw error
    } finally {
      client?.kill()
    }

    timeouts.clearAll()

    if (!sawAnyDelta) {
      throw new Error(mt('ai.codex.noStreamingContent'))
    }

    const sections = parser.finalize((m) => console.warn(m))

    if (onProgress) {
      onProgress(sections, { done: true })
    }

    return {
      prId: prId(req),
      headSha: detail.headSha,
      sections,
      generatedAt: new Date().toISOString(),
    }
  }
}
