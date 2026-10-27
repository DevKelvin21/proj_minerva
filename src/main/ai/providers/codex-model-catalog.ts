/**
 * Refresco dinámico del catálogo de modelos de Codex vía la RPC REAL de
 * `codex app-server` (T35, F8 — reemplaza el protocolo ADIVINADO de T29, que
 * asumía `{models}` en la respuesta de `model/list` y un `initialize({})`
 * vacío que en la práctica NO expone los métodos v2). Verificado en vivo
 * contra `codex` 0.142.x (misma sesión que validó `./codex-service.ts`, T29):
 *
 * - Handshake: `initialize` (request) con
 *   `{ clientInfo: {name, title, version}, capabilities: {experimentalApi:
 *   true, requestAttestation: false} }`, seguido de `initialized`
 *   (notification, params `undefined`) — SIN `experimentalApi: true` el
 *   server no expone los métodos v2 (`model/list` entre ellos).
 * - `model/list` (request), paginado: `{}` para la primera página, `{cursor}`
 *   para las siguientes. Respuesta `{ data: Model[], nextCursor: string |
 *   null }` — es `data`, NO `models` (el nombre que asumía la versión
 *   anterior de este archivo). Se pagina mientras `nextCursor` no sea `null`,
 *   con un techo de páginas de seguridad (`MAX_PAGES`).
 * - Cada `Model` trae `supportedReasoningEfforts: {reasoningEffort,
 *   description}[]` y `defaultReasoningEffort`: de ahí sale el descriptor de
 *   opción `effort` (T34, `../../../shared/ai-providers.ts`) del
 *   `AiModelOption` resultante. Un modelo sin `supportedReasoningEfforts` (o
 *   con el array vacío) queda sin `options`.
 *
 * NO se filtra por `hidden` ni por plan (lección de la investigación de
 * t3code que motivó esta tarea: exponer lo que da la RPC tal cual, no
 * adivinar qué "debería" ver el usuario).
 *
 * Ante CUALQUIER fallo (binario ausente, sin sesión, timeout, forma de
 * respuesta inesperada) se devuelve el catálogo curado
 * (`AI_PROVIDER_CATALOG.codex.models`, T26/T34) sin lanzar — pensado para
 * llamarse desde un contexto best-effort (`./provider-models.ts`, T35), que
 * nunca debe tumbar la pantalla de Settings.
 *
 * Para regenerar/re-verificar el esquema contra otra versión del CLI:
 * `codex app-server generate-ts --out <dir>` y mirar `v2/Model.ts`,
 * `v2/ModelListResponse.ts` (fuente de verdad por versión, ver
 * `.agents/TASKS.md` § "Log F7").
 */
import type { AiModelOption, ModelOptionChoice, ModelOptionDescriptor } from '../../../shared/ai-providers'
import { AI_PROVIDER_CATALOG } from '../../../shared/ai-providers'
import { CodexAppServerClient } from './codex-app-server-client'

/** Techo de páginas a pedir, por si un servidor real/fake nunca deja `nextCursor` en `null` (bug de protocolo, no debería pasar). */
const MAX_PAGES = 20

/** Un nivel de esfuerzo de razonamiento soportado por un modelo concreto (forma real de `model/list`, campo `supportedReasoningEfforts`). */
interface CodexReasoningEffort {
  reasoningEffort: string
  description: string
}

/**
 * Forma real (parcial) de un elemento de `model/list` (`v2/Model.ts`
 * generado por `codex app-server generate-ts`). Solo se listan los campos
 * que este módulo usa; el server manda más metadata (p. ej. `model`,
 * `description`, `isDefault`) que no hace falta acá.
 */
interface CodexModel {
  id: string
  displayName?: string
  hidden?: boolean
  supportedReasoningEfforts?: CodexReasoningEffort[]
  defaultReasoningEffort?: string
}

/** Forma real de la respuesta de `model/list` (`v2/ModelListResponse.ts`): `data`, NO `models`. */
interface ModelListResponse {
  data: CodexModel[]
  nextCursor: string | null
}

/**
 * Etiquetas humanas para los niveles de esfuerzo más comunes — mismo texto
 * que usan los descriptores `effort` curados de Claude Code
 * (`../../../shared/ai-providers.ts`, T34), para que la UI (T37) no muestre
 * una palabra distinta para el mismo nivel según el proveedor. Un nivel que
 * la cuenta exponga y no esté en este mapa (p. ej. uno nuevo del lado de
 * OpenAI) cae a una versión capitalizada del valor crudo en vez de romper.
 */
const KNOWN_EFFORT_LABELS: Record<string, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Very high',
  max: 'Max',
  ultra: 'Ultra',
}

function capitalize(value: string): string {
  return value.length === 0 ? value : value[0].toUpperCase() + value.slice(1)
}

function effortLabel(reasoningEffort: string): string {
  return KNOWN_EFFORT_LABELS[reasoningEffort] ?? capitalize(reasoningEffort)
}

/**
 * Arma el descriptor `effort` (T34) de un modelo a partir de sus
 * `supportedReasoningEfforts`/`defaultReasoningEffort` REALES (RPC, no
 * curados a mano); `undefined` si el modelo no declara ninguno (queda sin
 * `options`, igual que un modelo del catálogo curado sin descriptor).
 */
function buildEffortDescriptor(model: CodexModel): ModelOptionDescriptor | undefined {
  const supported = model.supportedReasoningEfforts
  if (!supported || supported.length === 0) return undefined

  const choices: ModelOptionChoice[] = supported.map(({ reasoningEffort, description }) => ({
    value: reasoningEffort,
    label: effortLabel(reasoningEffort),
    description,
    isDefault: reasoningEffort === model.defaultReasoningEffort,
  }))

  return { id: 'effort', label: 'Reasoning', choices }
}

function toModelOption(model: CodexModel): AiModelOption | null {
  if (typeof model.id !== 'string' || model.id.length === 0) return null

  const label =
    typeof model.displayName === 'string' && model.displayName.length > 0 ? model.displayName : model.id
  const effort = buildEffortDescriptor(model)

  return effort === undefined
    ? { id: model.id, label, vendor: 'OpenAI' }
    : { id: model.id, label, vendor: 'OpenAI', options: [effort] }
}

/** `clientInfo`/`capabilities` reales que espera `initialize`: sin `experimentalApi: true` el server no expone `model/list` (mismos params que `./codex-service.ts`, T29). */
const INITIALIZE_PARAMS = {
  clientInfo: { name: 'minerva', title: 'Minerva', version: '0.1.0' },
  capabilities: { experimentalApi: true, requestAttestation: false },
}

/**
 * Intenta refrescar el catálogo de modelos de Codex spawneando un
 * `codex app-server` efímero: handshake real (`initialize` + `initialized`)
 * y paginación de `model/list` leyendo `result.data`/`result.nextCursor`.
 * Ante CUALQUIER fallo (binario ausente, sin sesión, timeout, forma de
 * respuesta inesperada) devuelve el catálogo curado
 * (`AI_PROVIDER_CATALOG.codex.models`) sin lanzar. El cliente se mata SIEMPRE
 * en el `finally`, éxito o error.
 */
export async function fetchCodexModelCatalog(
  createClient: () => CodexAppServerClient = () => new CodexAppServerClient(),
): Promise<readonly AiModelOption[]> {
  let client: CodexAppServerClient | null = null
  try {
    client = createClient()
    await client.request('initialize', INITIALIZE_PARAMS)
    client.notify('initialized')

    const models: AiModelOption[] = []
    let cursor: string | undefined
    for (let page = 0; page < MAX_PAGES; page++) {
      const result = await client.request<ModelListResponse>('model/list', cursor ? { cursor } : {})
      for (const raw of result.data ?? []) {
        const option = toModelOption(raw)
        if (option) models.push(option)
      }
      if (!result.nextCursor) break
      cursor = result.nextCursor
    }

    return models.length > 0 ? models : AI_PROVIDER_CATALOG.codex.models
  } catch {
    return AI_PROVIDER_CATALOG.codex.models
  } finally {
    client?.kill()
  }
}
