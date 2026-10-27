/**
 * Refresco dinámico del catálogo de modelos de OpenCode (T57, patrón EXACTO
 * de `./codex-model-catalog.ts`): server local (`./opencode-runtime.ts`, T55)
 * + `client.provider.list()` del SDK oficial (`@opencode-ai/sdk`), filtrando
 * SOLO los providers upstream en `connected` (criterio t3code — un provider
 * en `all` sin estar `connected` no tiene credenciales configuradas, sus
 * modelos no son usables).
 *
 * FORMA VERIFICADA EMPÍRICAMENTE (T57, misma sesión que validó
 * `./opencode-runtime.ts`) contra el binario real `opencode` 1.17.18: se
 * levantó `opencode serve` en un puerto libre y se curleó `GET /provider`
 * (mismo endpoint que usa `client.provider.list()` — confirmado inspeccionando
 * `@opencode-ai/sdk/dist/gen/sdk.gen.d.ts`, `url: "/provider"`). La respuesta
 * NO es la que exportan los tipos con nombre `Provider`/`Model` del propio
 * paquete (`dist/gen/types.gen.d.ts` líneas ~1278/~1335 — esos son de OTRO
 * endpoint/versión, les faltan `variants`/`release_date`/`providerID` que sí
 * trae `/provider`); es la forma inline de `ProviderListResponses[200]` (esa
 * sí matchea byte a byte lo observado), por eso este archivo define sus
 * propias interfaces LOCALES (parciales, solo los campos que usa) en vez de
 * confiar en los tipos exportados — mismo criterio que `CodexModel`/
 * `ModelListResponse` en `./codex-model-catalog.ts`.
 *
 * Con este cliente `curl http://127.0.0.1:<puerto>/provider` devuelve:
 *   {
 *     "all": [ { "id": "opencode", "name": "OpenCode", "models": {
 *       "big-pickle": { "id": "big-pickle", "name": "Big Pickle", ... },
 *       "hy3-free": { "id": "hy3-free", "name": "Hy3 Free",
 *         "variants": { "low": {...}, "medium": {...}, "high": {...} }, ... },
 *       ... } }, ... ],
 *     "default": { "<providerID>": "<modelID>", ... },
 *     "connected": ["openai", "github-copilot", "opencode"]
 *   }
 * (`client.provider.list()` envuelve esto en `{ data, request, response }` —
 * confirmado con un script ad-hoc contra el SDK real, mismo `RequestResult`
 * de HeyAPI que usa el resto del SDK.) `connected` en esta máquina de
 * desarrollo tenía otros CLIs ya logueados (`openai`, `github-copilot`) además
 * del gateway propio `opencode` — el criterio "≥1 upstream connected" no
 * depende de CUÁL, cualquiera cuenta.
 *
 * `variants` (cuando el modelo lo trae) es un objeto `{ <variante>: {...} }`
 * — solo se usan las CLAVES (los valores son detalle interno de OpenCode que
 * no hace falta acá) para armar el descriptor de opción `variant` (T34,
 * patrón `effort`): elegir la variante default sigue el criterio de t3code
 * `inferDefaultVariant` (`Layers/OpenCodeProvider.ts`): única variante ⇒ esa;
 * `anthropic`/`google*` ⇒ `high` si existe; `openai`/`opencode` ⇒ `medium` si
 * existe, si no `high`; cualquier otro provider ⇒ sin default explícito (cae
 * al primer choice de la lista, ver `resolveOptionValue`,
 * `shared/ai-providers.ts`).
 *
 * `label` es el nombre humano del modelo (`model.name`); se le agrega el
 * sub-proveedor (`provider.name`) SOLO cuando aporta — es decir, cuando hay
 * más de un modelo conectado con el mismo `name` (colisión entre upstreams,
 * p. ej. "GPT-5.4" servido tanto por `openai` como por `github-copilot`) y
 * sin eso quedarían dos filas idénticas en el picker (el `vendor` ya se
 * pinta aparte en `ModelPicker.tsx`, pero dentro de la lista de radios el
 * `label` es lo primero que se lee).
 *
 * Ante CUALQUIER fallo (binario ausente, server que no arranca, sin ningún
 * upstream conectado — trivialmente vacío, no es un error — timeout, forma de
 * respuesta inesperada) se devuelve el catálogo curado
 * (`AI_PROVIDER_CATALOG.opencode.models`, T57) sin lanzar — pensado para
 * llamarse desde un contexto best-effort (`./provider-models.ts`), que nunca
 * debe tumbar la pantalla de Settings. El server en sí NO se mata al salir de
 * esta función (a diferencia del cliente de `codex app-server`, que es
 * efímero por refresco): es el singleton lazy de `./opencode-runtime.ts`,
 * compartido con el probe (`./cli-probe.ts`) y con los análisis reales.
 */
import { createOpencodeClient } from '@opencode-ai/sdk'
import type { AiModelOption, ModelOptionChoice, ModelOptionDescriptor } from '../../../shared/ai-providers'
import { AI_PROVIDER_CATALOG } from '../../../shared/ai-providers'
import { getOpencodeServer } from './opencode-runtime'

/** Un modelo dentro de `all[].models` de `GET /provider` (forma real, ver comentario del módulo) — solo los campos que este archivo usa. */
interface OpencodeModel {
  id: string
  name: string
  variants?: Record<string, unknown>
}

/** Un provider upstream dentro de `all` de `GET /provider` (forma real) — solo los campos que este archivo usa. */
interface OpencodeProvider {
  id: string
  name: string
  models: Record<string, OpencodeModel>
}

/** Forma real (parcial) de la respuesta 200 de `GET /provider` / `client.provider.list().data`. */
interface OpencodeProviderListData {
  all: OpencodeProvider[]
  default: Record<string, string>
  connected: string[]
}

/**
 * Etiquetas humanas para las variantes más comunes observadas contra el
 * binario real (`low`/`medium`/`high`/`max`/`none`) — mismo texto que usan
 * los descriptores `effort` curados del resto del catálogo
 * (`../../../shared/ai-providers.ts`), para que la UI (T37) no muestre una
 * palabra distinta para el mismo nivel según el proveedor. Una variante que
 * el modelo declare y no esté en este mapa cae a una versión capitalizada del
 * valor crudo en vez de romper.
 */
const KNOWN_VARIANT_LABELS: Record<string, string> = {
  none: 'None',
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

function variantLabel(variant: string): string {
  return KNOWN_VARIANT_LABELS[variant] ?? capitalize(variant)
}

/**
 * Variante default por provider upstream (criterio t3code
 * `inferDefaultVariant`, `Layers/OpenCodeProvider.ts`): única variante ⇒ esa;
 * `anthropic`/`google*` ⇒ `high` si existe; `openai`/`opencode` ⇒ `medium` si
 * existe, si no `high`; cualquier otro provider ⇒ `undefined` (sin default
 * explícito — `resolveOptionValue` cae al primer choice de la lista).
 */
function inferDefaultVariant(providerId: string, variants: readonly string[]): string | undefined {
  if (variants.length === 1) return variants[0]
  if (providerId === 'anthropic' || providerId.startsWith('google')) {
    return variants.includes('high') ? 'high' : undefined
  }
  if (providerId === 'openai' || providerId === 'opencode') {
    if (variants.includes('medium')) return 'medium'
    return variants.includes('high') ? 'high' : undefined
  }
  return undefined
}

/** Arma el descriptor `variant` (T34) de un modelo a partir de las CLAVES de `model.variants`; `undefined` si el modelo no declara ninguna. */
function buildVariantDescriptor(providerId: string, model: OpencodeModel): ModelOptionDescriptor | undefined {
  const variants = Object.keys(model.variants ?? {})
  if (variants.length === 0) return undefined

  const defaultVariant = inferDefaultVariant(providerId, variants)
  const choices: ModelOptionChoice[] = variants.map((variant) => ({
    value: variant,
    label: variantLabel(variant),
    isDefault: variant === defaultVariant,
  }))

  return { id: 'variant', label: 'Variant', choices }
}

/** Cuenta cuántas veces aparece cada `name` de modelo entre TODOS los providers conectados, para saber cuándo el sub-proveedor "aporta" (desambigua un choque de nombres). */
function countModelNames(providers: readonly OpencodeProvider[], connected: ReadonlySet<string>): Map<string, number> {
  const counts = new Map<string, number>()
  for (const provider of providers) {
    if (!connected.has(provider.id)) continue
    for (const model of Object.values(provider.models)) {
      counts.set(model.name, (counts.get(model.name) ?? 0) + 1)
    }
  }
  return counts
}

function toModelOption(
  provider: OpencodeProvider,
  model: OpencodeModel,
  nameCounts: Map<string, number>,
): AiModelOption | null {
  if (typeof model.id !== 'string' || model.id.length === 0) return null
  if (typeof model.name !== 'string' || model.name.length === 0) return null

  const collides = (nameCounts.get(model.name) ?? 0) > 1
  const label = collides ? model.name + ' · ' + provider.name : model.name
  const variant = buildVariantDescriptor(provider.id, model)
  const slug = provider.id + '/' + model.id

  return variant === undefined
    ? { id: slug, label, vendor: provider.name }
    : { id: slug, label, vendor: provider.name, options: [variant] }
}

/**
 * Intenta refrescar el catálogo de modelos de OpenCode pidiendo el server
 * local (spawneándolo si hace falta, `getOpencodeServer`) y llamando
 * `provider.list()`. SOLO se listan modelos de providers en `connected`.
 * Ante CUALQUIER fallo (binario ausente, server que no arranca, timeout,
 * forma de respuesta inesperada) devuelve el catálogo curado
 * (`AI_PROVIDER_CATALOG.opencode.models`) sin lanzar. A diferencia de
 * `fetchCodexModelCatalog`, el server NO se mata al terminar: es el singleton
 * compartido de `./opencode-runtime.ts` (T55), no un proceso efímero por
 * refresco.
 */
export async function fetchOpencodeModelCatalog(
  createClient: (baseUrl: string) => { provider: { list: () => Promise<{ data?: OpencodeProviderListData }> } } = (
    baseUrl,
  ) => createOpencodeClient({ baseUrl }),
): Promise<readonly AiModelOption[]> {
  try {
    const server = await getOpencodeServer()
    const client = createClient(server.url)
    const result = await client.provider.list()
    const data = result.data
    if (!data) return AI_PROVIDER_CATALOG.opencode.models

    const connected = new Set(data.connected)
    const nameCounts = countModelNames(data.all, connected)

    const models: AiModelOption[] = []
    for (const provider of data.all) {
      if (!connected.has(provider.id)) continue
      for (const model of Object.values(provider.models)) {
        const option = toModelOption(provider, model, nameCounts)
        if (option) models.push(option)
      }
    }

    if (models.length === 0) return AI_PROVIDER_CATALOG.opencode.models
    // `models` es un array armado localmente en este loop (no una referencia
    // compartida): ordenarlo in-place con `.sort()` es seguro y evita
    // `.toSorted()` (ES2023, fuera del `lib` de este proyecto, ES2022).
    return models.sort((a, b) => a.label.localeCompare(b.label))
  } catch {
    return AI_PROVIDER_CATALOG.opencode.models
  }
}
