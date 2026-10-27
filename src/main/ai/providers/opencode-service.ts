/**
 * Implementación real de `AiService` con el server local `opencode serve`
 * (`./opencode-runtime.ts`, T55) hablado por el SDK oficial `@opencode-ai/sdk`
 * (T56, patrón `OpenCodeAdapter.ts` de t3code — repo `pingdotgg/t3code`,
 * adaptado a nuestra vuelta única sin Effect-TS). Quinto proveedor real de
 * `AiService`, tercer AGÉNTICO (F11, junto a Claude Code y Codex, T58): igual
 * que ellos, explora el snapshot local del PR (`ensureSnapshot`, T54) con
 * herramientas de solo lectura antes de responder.
 *
 * DECISIÓN SDK v2 vs v1 (root), verificada empíricamente contra `opencode`
 * 1.17.18 (script suelto, ver bitácora de T56 en TASKS.md): `@opencode-ai/sdk`
 * (root, `.`) exporta un `Event` SIN `message.part.delta` ni `session.idle`
 * (protocolo más viejo, sin streaming incremental de texto) — es el que usan
 * `./cli-probe.ts`/`./opencode-model-catalog.ts` (T57) porque a ellos les
 * alcanza una llamada REST de una vez (`provider.list()`), sin streaming.
 * `@opencode-ai/sdk/v2` SÍ trae `EventMessagePartDelta`/`EventSessionIdle`
 * (comparación directa de las dos uniones `Event` en
 * `node_modules/@opencode-ai/sdk/dist/{,v2/}gen/types.gen.d.ts`) — es el ÚNICO
 * de los dos que puede streamear texto incremental, así que es el que usa este
 * archivo. Ambos subpaths conviven sin conflicto (T57 sigue en v1 para lo
 * suyo).
 *
 * GOTCHA CRÍTICO DE WIRE (verificado con un script suelto contra el binario
 * real, NO adivinado — lección T29): la firma TS de MUCHOS métodos en
 * `dist/v2/gen/sdk.gen.d.ts` sugiere parámetros ANIDADOS al estilo
 * `{ path: { sessionID }, body: { model, parts, ... } }` (esa es la forma de
 * la clase genérica `Session`/`Event`, que NINGÚN objeto real del cliente usa)
 * — pero las clases que `createOpencodeClient()` realmente instancia
 * (`client.session` → `Session2`, `client.event` → `Event` "correcta", ambas
 * en la sección de abajo del mismo archivo) tienen una firma FLAT:
 * `client.session.promptAsync({ sessionID, model, system, parts, ... })`,
 * `client.session.create({ title })`, `client.event.subscribe(undefined,
 * { signal })`. Confirmado dos veces: (a) `buildClientParams` en
 * `dist/v2/gen/core/params.gen.js` itera las keys de UN SOLO objeto plano —
 * pasarle `{ path: {...}, body: {...} }` hace que ninguna key matchee y el
 * server recibe la URL con el placeholder `{sessionID}` sin reemplazar (500,
 * "Expected a string starting with \"ses\", got \"%7BsessionID%7D\""); (b) un
 * `tsc --strict` real contra `Session2`/`Event` (las clases que
 * `OpencodeClient` expone) type-checkea la forma FLAT y rechaza la anidada.
 *
 * FORMA EXACTA DE EVENTOS observada end-to-end (server real + modelo gratis
 * `opencode/big-pickle`, snapshot artesanal de 3 archivos, ver bitácora T56):
 * - `message.updated`: `{ properties: { sessionID, info: { id, role,... } } }`
 *   — `info.role` es `'user'` (el propio prompt) o `'assistant'`.
 * - `message.part.updated`: `{ properties: { sessionID, part: { id, type,
 *   messageID, text?, ... } } }` — SE OBSERVÓ que llega ANTES que los
 *   `message.part.delta` del mismo `partID` y con el `type` correcto
 *   (`'reasoning'` para el razonamiento interno del modelo, `'text'` para la
 *   respuesta final, `'tool'` para llamadas a herramientas — estas últimas
 *   NUNCA emitieron `message.part.delta`, solo `message.part.updated` con su
 *   `state`). Este archivo SOLO lee `part.type`/`part.id`/`part.messageID` de
 *   este evento, NUNCA `part.text`: el bug conocido (issues opencode
 *   anomalyco/opencode #27966 y #26697) es sobre reconstruir el texto final a
 *   partir de los snapshots de `part.text` de este evento (pueden faltar
 *   actualizaciones intermedias) — el texto SIEMPRE sale de los deltas.
 * - `message.part.delta`: `{ properties: { sessionID, messageID, partID,
 *   field, delta } }` — `field` fue `'text'` para partes `text` Y
 *   `reasoning` (ambas tienen un campo `text`); nunca se vio otro valor de
 *   `field`. Sin `type` propio: el tipo de la parte se resuelve por
 *   `partID` contra lo aprendido en `message.part.updated`.
 * - `session.error`: `{ properties: { sessionID?, error?: { name, data:
 *   {message,...} } } }` — `sessionID` es OPCIONAL (un error de proveedor
 *   puede no estar atado a una sesión puntual).
 * - `session.idle`: `{ properties: { sessionID } }` — fin del turno; llegó
 *   DESPUÉS del `message.part.updated` final de la parte `text` en la corrida
 *   de humo.
 * - Housekeeping del server sin relación con nuestro análisis (`plugin.added`,
 *   `catalog.updated`, `reference.updated`, `integration.updated`,
 *   `session.diff`, `session.status`, `session.updated`, `message.removed`):
 *   se ignoran (rama `else` implícita del filtrado de abajo).
 *
 * Pipeline de `analyzePullRequest` (mismo contrato que el resto de
 * proveedores, ver `../service.ts`):
 * 1. `getEffectiveAiSelection()` (`../env`) da el slug `<providerID>/<modelID>`
 *    del modelo activo; se parte por el PRIMER `/` (`parseOpencodeModelSlug`)
 *    porque el `modelID` de OpenCode puede traer más barras (p. ej. ids de
 *    gateway anidados).
 * 2. `getPullRequestDetail`/`getPullRequestFiles` del `PrContextSource` (registro SCM) +
 *    `ensureSnapshot` (T54) materializan la copia local del repo al commit del
 *    PR; `getOpencodeServer()` (T55) da la URL del server compartido
 *    (ya lanzado con el config read-only, ver `./opencode-runtime.ts`).
 * 3. `createOpencodeClient({ baseUrl, directory: snapshotDir, throwOnError:
 *    true })`: el cliente queda atado a ESE directorio para toda la sesión
 *    (headers `x-opencode-directory` en cada request, incluida la
 *    suscripción de eventos).
 * 4. Se suscribe a eventos (`client.event.subscribe`) ANTES de crear la
 *    sesión y de mandar el prompt (no perder deltas tempranos) — mismo orden
 *    que `t3code`. `session.create` da el `sessionID`; `session.promptAsync`
 *    (no bloqueante: "returns immediately" según su propio docstring del SDK)
 *    dispara el turno mientras el stream de eventos ya se está consumiendo en
 *    paralelo.
 * 5. Se acumulan SOLO los `message.part.delta` cuyo `field==='text'`,
 *    `messageID` pertenece a un mensaje `role==='assistant'`
 *    (`message.updated`) y `partID` es de tipo `'text'`
 *    (`message.part.updated`, ver el gotcha de arriba) — así se excluye el
 *    razonamiento interno del modelo (`type:'reasoning'`) y cualquier eco del
 *    propio prompt (mensajes `role:'user'`). Desde F13, las partes `tool`
 *    (con su `callID`/`tool`/`state`) y `reasoning` de NUESTRA sesión
 *    alimentan además el mini-log de actividad (`../activity-tracker.ts`) —
 *    nunca el parser, y del razonamiento solo el HECHO de que existe
 *    ("Pensando…"), jamás su texto. Cada delta resetea el timer de
 *    inactividad (igual que cualquier otro evento de la sesión: el agente
 *    sigue vivo explorando aunque no emita texto, mismo criterio que
 *    Claude Code/Codex en T58).
 * 6. Fin normal: `session.idle` de nuestro `sessionID` → `parser.finalize()`.
 *    Fin por error: `session.error` de nuestro `sessionID` (o sin `sessionID`,
 *    ver arriba) → throw con el detalle. Timeouts AGÉNTICOS compartidos
 *    (`../analysis-timeouts.ts`, T56: total 300s / inactividad 60s) sobre un
 *    único `AbortController` pasado como `signal` a `subscribe`/`create`/
 *    `promptAsync`; al salir (éxito, error o timeout) se llama
 *    `session.abort` best-effort (catch vacío: la sesión puede ya estar
 *    muerta) y se aborta el controller para cerrar la conexión SSE.
 * 7. Errores accionables en español: `ProviderAuthError` (sin upstream
 *    conectado, tanto si llega como excepción HTTP -`session.create`/
 *    `promptAsync`- como evento `session.error`) → sugiere `opencode auth
 *    login` + elegir otro modelo en Settings; servidor que no arranca → el
 *    mensaje de `getOpencodeServer()` (ya accionable) se propaga tal cual;
 *    cero deltas de texto al terminar → error explícito (mismo patrón
 *    `sawAnyDelta` que Claude Code/Codex).
 *
 * Nunca se loguea contenido del PR ni de la respuesta del modelo — solo tipos
 * de evento y metadatos (ids, nombres de campo) si algo falla.
 */
import { createOpencodeClient } from '@opencode-ai/sdk/v2'
import type { Event } from '@opencode-ai/sdk/v2'
import type { AiService, AnalyzePullRequestOptions, AnalyzeResult } from '../service'
import type { PrContextSource } from '../pr-context'
import type { IpcRequest } from '../../../shared/ipc'
import { getEffectiveAiSelection } from '../env'
import { buildAnalyzeSystemPrompt } from '../prompts/analyze-pr'
import { getMainLocale, mt } from '../../i18n'
import { buildAgenticUserMessage, prId } from '../analysis-prompt'
import { StreamSectionParser } from '../stream-parser'
import { createThrottle } from '../throttle'
import { createActivityTracker } from '../activity-tracker'
import type { AnalysisActivityKind } from '../../../shared/events'
import { getOpencodeServer } from './opencode-runtime'
import {
  AGENTIC_INACTIVITY_TIMEOUT_MS,
  AGENTIC_REQUEST_TIMEOUT_MS,
  createAnalysisTimeouts,
  PROGRESS_THROTTLE_MS,
} from '../analysis-timeouts'

export interface ParsedOpencodeModelSlug {
  providerID: string
  modelID: string
}

/**
 * Parsea un slug `<providerID>/<modelID>` por el PRIMER `/` (el `modelID`
 * puede traer más barras, p. ej. un id de gateway anidado) — mismo criterio
 * que `parseOpenCodeModelSlug` de t3code. `null` si no hay separador, o si
 * cualquiera de las dos mitades queda vacía.
 */
export function parseOpencodeModelSlug(slug: string): ParsedOpencodeModelSlug | null {
  const trimmed = slug.trim()
  const separator = trimmed.indexOf('/')
  if (separator <= 0 || separator === trimmed.length - 1) return null
  return { providerID: trimmed.slice(0, separator), modelID: trimmed.slice(separator + 1) }
}

/** Payload de un evento `session.error` (unión con `name`/`data.message` casi siempre presente). */
type SessionErrorPayload = Extract<Event, { type: 'session.error' }>['properties']['error']

/** La `Part` que viaja en `message.part.updated`, derivada del union `Event` para no depender de que el SDK exporte `Part` directo. */
type OpencodeUpdatedPart = Extract<Event, { type: 'message.part.updated' }>['properties']['part']
type OpencodeToolPart = Extract<OpencodeUpdatedPart, { type: 'tool' }>

/**
 * Verbo canónico del mini-log (F13) por nombre de tool de OpenCode (los
 * nombres reales del server: minúsculas). Tools fuera de la tabla caen al
 * genérico `tool` con el nombre como detalle.
 */
const OPENCODE_TOOL_KIND: Record<string, AnalysisActivityKind> = {
  read: 'read',
  grep: 'search',
  glob: 'list',
  list: 'list',
  ls: 'list',
}

/**
 * Detalle "humano" de una parte `tool` (F13): primero el input real
 * (`filePath`/`path`/`pattern`, defensivo — el SDK lo tipa como record
 * abierto), después el `title` legible que OpenCode pone en
 * `ToolStateRunning`/`Completed`.
 */
function extractOpencodeToolDetail(part: OpencodeToolPart): string | undefined {
  // Defensivo aunque el tipo diga que `state` siempre viene: la forma real
  // del wire manda (lección T29/T56) y un part incompleto no debe tumbar el
  // stream entero por un TypeError del mini-log.
  const state: OpencodeToolPart['state'] | undefined = part.state
  if (!state || typeof state !== 'object') return undefined
  const input: unknown = 'input' in state ? state.input : undefined
  if (input && typeof input === 'object') {
    const v = input as Record<string, unknown>
    for (const key of ['filePath', 'path', 'pattern']) {
      const candidate = v[key]
      if (typeof candidate === 'string' && candidate.length > 0) return candidate
    }
  }
  if ('title' in state && typeof state.title === 'string' && state.title.length > 0) {
    return state.title
  }
  return undefined
}

/** Forma parcial del `.cause.body` que arma `wrapClientError` (`@opencode-ai/sdk/dist/error-interceptor.js`) cuando el cliente lanza por `throwOnError: true`. */
interface OpencodeErrorBody {
  name?: unknown
  data?: { message?: unknown; providerID?: unknown }
}

function extractErrorBody(error: unknown): OpencodeErrorBody | null {
  if (!(error instanceof Error)) return null
  const cause = (error as { cause?: unknown }).cause
  if (!cause || typeof cause !== 'object') return null
  const body = (cause as { body?: unknown }).body
  if (!body || typeof body !== 'object') return null
  return body as OpencodeErrorBody
}

/** Mensaje accionable para "sin upstream conectado", reutilizado tanto para excepciones HTTP como para eventos `session.error`. */
function providerAuthErrorMessage(providerID: unknown): string {
  return typeof providerID === 'string' && providerID.length > 0
    ? mt('ai.opencode.noProviderConnectedNamed', { provider: providerID })
    : mt('ai.opencode.noProviderConnected')
}

/** Mapea una excepción lanzada por el cliente (`throwOnError: true`) a un mensaje accionable (idioma de la UI). */
function mapOpencodeError(error: unknown): Error {
  const body = extractErrorBody(error)
  if (body?.name === 'ProviderAuthError') {
    return new Error(providerAuthErrorMessage(body.data?.providerID), { cause: error })
  }
  if (error instanceof Error) {
    return new Error(mt('ai.errors.providerError', { provider: 'OpenCode', detail: error.message }), {
      cause: error,
    })
  }
  return new Error(mt('ai.opencode.unknownError'), { cause: error })
}

/** Mensaje accionable a partir del payload de un evento `session.error` (forma cruda del protocolo, no una excepción). */
function describeSessionErrorPayload(error: SessionErrorPayload): string {
  if (!error) return mt('ai.opencode.sessionErrorNoDetail')
  if (error.name === 'ProviderAuthError') {
    return providerAuthErrorMessage(error.data.providerID)
  }
  const data = error.data as Record<string, unknown>
  const message = data.message
  return typeof message === 'string' && message.length > 0 ? message : mt('ai.opencode.unknownSessionError')
}

export class OpenCodeAiService implements AiService {
  constructor(private readonly context: PrContextSource) {}

  async analyzePullRequest(
    req: IpcRequest<'ai:analyzePullRequest'>,
    options?: AnalyzePullRequestOptions,
  ): Promise<AnalyzeResult> {
    const { model } = getEffectiveAiSelection()
    const language = options?.language ?? getMainLocale()
    const parsedModel = parseOpencodeModelSlug(model)
    if (parsedModel === null) {
      throw new Error(mt('ai.opencode.badModelSlug', { model }))
    }

    const [detail, files] = await Promise.all([
      this.context.getDetail(req.repo, req.number),
      this.context.getFiles(req.repo, req.number),
    ])

    // AGÉNTICO (F11/T56): copia local del repo al commit del PR — el
    // `directory` del cliente (ver comentario del módulo).
    const snapshotDir = await this.context.ensureSnapshot(req.repo, detail.headSha)

    // Server compartido (T55): ya accionable si el binario falta o no arranca.
    const server = await getOpencodeServer()
    const client = createOpencodeClient({
      baseUrl: server.url,
      directory: snapshotDir,
      throwOnError: true,
    })

    const userMessage = buildAgenticUserMessage(detail, files)

    const controller = new AbortController()
    const timeouts = createAnalysisTimeouts(controller, {
      totalMs: AGENTIC_REQUEST_TIMEOUT_MS,
      inactivityMs: AGENTIC_INACTIVITY_TIMEOUT_MS,
    })

    const abortErrorMessage = (): string | null => {
      const reason = timeouts.getAbortReason()
      if (reason === 'inactivity-timeout') {
        return mt('ai.errors.inactivityTimeout', {
          provider: 'OpenCode',
          seconds: AGENTIC_INACTIVITY_TIMEOUT_MS / 1000,
        })
      }
      if (reason === 'total-timeout') {
        return mt('ai.errors.totalTimeout', {
          provider: 'OpenCode',
          seconds: AGENTIC_REQUEST_TIMEOUT_MS / 1000,
        })
      }
      return null
    }

    const parser = new StreamSectionParser()
    const throttle = createThrottle(PROGRESS_THROTTLE_MS)
    const onProgress = options?.onProgress
    let sawAnyDelta = false
    let sessionId: string | null = null
    // Fase del streaming (F11/T60, ver `AnalyzeProgressMeta` en `../service.ts`):
    // arranca "exploring" (la sesión todavía no emitió ningún delta de texto
    // del asistente, solo pudo haber actividad de bookkeeping/tool-use) y
    // pasa a "writing" en el PRIMER delta de texto ACEPTADO, sin volver atrás.
    let phase: 'exploring' | 'writing' = 'exploring'
    // Mini-log de actividad del harness (F13, `../activity-tracker.ts`):
    // mismo criterio que Claude Code — las transiciones emiten onProgress
    // SIN throttle, los refinamientos viajan con la próxima emisión.
    const activity = createActivityTracker({
      basePath: snapshotDir,
      language,
      onEdge: () => {
        if (onProgress) {
          onProgress(parser.snapshot(), { done: false, phase, activity: activity.buffer() })
        }
      },
    })

    timeouts.resetInactivityTimer()

    try {
      // Suscripción ANTES de crear la sesión / mandar el prompt (ver
      // comentario del módulo): no se pierde ningún delta temprano.
      const subscription = await client.event.subscribe(undefined, {
        signal: controller.signal,
        throwOnError: true,
      })

      const sessionResp = await client.session.create(
        { title: 'Minerva: PR analysis ' + prId(req) },
        { signal: controller.signal, throwOnError: true },
      )
      sessionId = sessionResp.data.id

      // Bookkeeping SOLO para clasificar partes (role del mensaje dueño, tipo
      // de la parte) — el TEXTO en sí sale exclusivamente de
      // `message.part.delta` (ver gotcha del módulo, nunca de `part.text`).
      const messageRoleById = new Map<string, string>()
      const partTypeById = new Map<string, string>()

      let resolveSession!: () => void
      let rejectSession!: (error: Error) => void
      const sessionDone = new Promise<void>((resolve, reject) => {
        resolveSession = resolve
        rejectSession = reject
      })
      // Red de seguridad: si `sessionDone` termina rechazada sin que nadie la
      // haya esperado todavía (p. ej. `promptAsync` falló antes de llegar al
      // `await sessionDone` de abajo), esto evita un unhandled rejection —
      // el `catch` de más abajo sigue viendo el error real igual.
      sessionDone.catch(() => {})

      const currentSessionId = sessionId
      /** Progreso de actividad SIN delta de texto aceptado (T60) mientras seguimos "exploring": throttleado, nunca cambia `sections`. */
      const pingExploring = (): void => {
        if (phase === 'exploring' && onProgress && throttle.shouldRun()) {
          onProgress(parser.snapshot(), { done: false, phase, activity: activity.buffer() })
        }
      }
      void (async () => {
        try {
          for await (const event of subscription.stream) {
            timeouts.resetInactivityTimer()

            if (event.type === 'message.updated') {
              messageRoleById.set(event.properties.info.id, event.properties.info.role)
              pingExploring()
              continue
            }

            if (event.type === 'message.part.updated') {
              const part = event.properties.part
              partTypeById.set(part.id, part.type)
              // Mini-log (F13): SOLO partes de NUESTRA sesión (esta rama no
              // filtraba por sesión — para `partTypeById` es inocuo, para el
              // log no: un análisis concurrente en el server compartido
              // contaminaría el feed con sus tool calls).
              if (event.properties.sessionID === currentSessionId) {
                // Guard defensivo sobre `callID`/`state` aunque el tipo los
                // declare obligatorios: la forma real del wire manda (lección
                // T29/T56) y un part incompleto se ignora en vez de reventar.
                if (
                  part.type === 'tool' &&
                  typeof part.callID === 'string' &&
                  part.state !== undefined
                ) {
                  const kind = OPENCODE_TOOL_KIND[part.tool] ?? 'tool'
                  const detail =
                    extractOpencodeToolDetail(part) ?? (kind === 'tool' ? part.tool : undefined)
                  const status = part.state.status
                  if (status === 'pending' || status === 'running') {
                    activity.begin(part.callID, kind, detail)
                  } else if (status === 'completed') {
                    activity.complete(part.callID, detail)
                  } else if (status === 'error') {
                    activity.fail(part.callID)
                  }
                } else if (part.type === 'reasoning') {
                  // Solo el HECHO de que razona ("Pensando…"), nunca
                  // `part.text` (prompt injection desde el snapshot).
                  activity.thinking(part.id)
                }
              }
              pingExploring()
              continue
            }

            if (event.type === 'message.part.delta') {
              const p = event.properties
              if (p.sessionID !== currentSessionId) continue
              const isAssistantTextDelta =
                p.field === 'text' &&
                messageRoleById.get(p.messageID) === 'assistant' &&
                partTypeById.get(p.partID) === 'text'
              if (!isAssistantTextDelta) {
                // Deltas de razonamiento/tool o de otra sesión (T60): mientras
                // seguimos "exploring" siguen siendo señal de actividad, sin
                // que nada de esto llegue al parser. Los de razonamiento
                // alimentan el "Pensando…" del mini-log (F13) — solo el hecho,
                // nunca `p.delta`.
                if (partTypeById.get(p.partID) === 'reasoning') {
                  activity.thinking(p.partID)
                }
                pingExploring()
                continue
              }
              if (phase === 'exploring') phase = 'writing'
              if (!sawAnyDelta) activity.settleThinking()
              sawAnyDelta = true
              parser.push(p.delta)
              if (onProgress && throttle.shouldRun()) {
                onProgress(parser.snapshot(), { done: false, phase, activity: activity.buffer() })
              }
              continue
            }

            if (event.type === 'session.error') {
              if (event.properties.sessionID !== undefined && event.properties.sessionID !== currentSessionId) {
                continue
              }
              rejectSession(
                new Error(
                  mt('ai.errors.providerError', {
                    provider: 'OpenCode',
                    detail: describeSessionErrorPayload(event.properties.error),
                  }),
                ),
              )
              return
            }

            if (event.type === 'session.idle') {
              if (event.properties.sessionID !== currentSessionId) continue
              resolveSession()
              return
            }

            // Cualquier otro evento (permisos, diffs, housekeeping del
            // server): mientras seguimos "exploring" (T60), igual es señal
            // de que el server sigue con actividad.
            pingExploring()
          }
          rejectSession(new Error(mt('ai.opencode.eventsClosed')))
        } catch (error) {
          rejectSession(error instanceof Error ? error : new Error(String(error)))
        }
      })()

      await client.session.promptAsync(
        {
          sessionID: sessionId,
          model: parsedModel,
          system: buildAnalyzeSystemPrompt(language),
          parts: [{ type: 'text', text: userMessage }],
        },
        { signal: controller.signal, throwOnError: true },
      )

      await sessionDone
    } catch (error) {
      const abortMessage = abortErrorMessage()
      if (abortMessage) throw new Error(abortMessage, { cause: error })
      throw mapOpencodeError(error)
    } finally {
      // Se ejecuta SIEMPRE (éxito, error o timeout): cierra la conexión SSE y
      // le avisa al server que la sesión terminó, best-effort (puede ya
      // estar muerta — de ahí el `catch` vacío).
      timeouts.clearAll()
      controller.abort()
      if (sessionId !== null) {
        await client.session.abort({ sessionID: sessionId }, { throwOnError: true }).catch(() => {})
      }
    }

    if (!sawAnyDelta) {
      throw new Error(mt('ai.opencode.noStreamingContent'))
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
