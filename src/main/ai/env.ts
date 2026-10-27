/**
 * Carga en runtime (nunca en build) el proveedor+modelo de IA efectivos.
 *
 * Hasta T59 este módulo también resolvía `OPENROUTER_API_KEY` (con
 * precedencia `safeStorage` > `process.env` > `.env` de raíz en dev, ver
 * `getAiEnv`/`getOpenRouterKeyStatus` en la historia de este archivo) para
 * `OpenRouterAiService`, que hablaba HTTP directo con `openrouter.ai`.
 * Decisión de Edilson (T59): Minerva deja de hablar con OpenRouter
 * directamente — quien quiera esos modelos los usa DENTRO de OpenCode
 * (`opencode auth login`), que gestiona sus propias credenciales sin que
 * Minerva las toque. Por eso ya no hay ninguna resolución de API key acá: el
 * único secreto de IA que Minerva podría necesitar (si algún proveedor
 * futuro volviera a ser `api-key`) viviría igual, cifrado con `safeStorage`,
 * pero hoy los tres proveedores (`claude-code`/`codex`/`opencode`) son `cli`
 * (`main/ai/providers/registry.ts`): se autentican solos contra su propia
 * sesión en disco.
 *
 * El `.env` de la raíz del proyecto SIGUE existiendo como fuente para
 * `MINERVA_AI_PROVIDER`/`MINERVA_AI_MODEL` (ver `getDotEnv` más abajo) — se
 * mantiene el loader porque esas dos variables de entorno siguen siendo una
 * precedencia válida, ahora sin ninguna key que leer del mismo archivo. Ese
 * `.env` solo existe en checkout de desarrollo (está en `.gitignore`, ver
 * `.env.example`); en una build empaquetada (electron-builder) ese archivo no
 * se incluye, así que `readProjectDotEnv()` falla silenciosamente (ENOENT) y
 * queda solo `process.env`.
 */
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  AI_PROVIDER_CATALOG,
  DEFAULT_AI_PROVIDER,
  DEFAULT_MODEL_BY_PROVIDER,
  findModelInList,
  getModelOption,
  isAiProviderId,
  resolveOptionValue,
  type AiProviderId,
  type ModelOptionDescriptor,
} from '../../shared/ai-providers'
import type { AiModelSource, AiSettingsInfo } from '../../shared/types'
import { getSnapshotProviderModels } from './providers/model-catalog-snapshot'
import { settingsStore } from '../settings/store'

/**
 * Parser mínimo de `.env`: una variable por línea (`KEY=VALUE`), ignora
 * líneas vacías y comentarios (`#` al inicio, tras recortar espacios). Sin
 * soporte de multilínea ni interpolación — alcanza para este archivo. Quita
 * comillas simples/dobles que envuelvan el valor completo, si las hay.
 */
export function parseDotEnv(content: string): Record<string, string> {
  const result: Record<string, string> = {}

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) continue

    const eqIndex = line.indexOf('=')
    if (eqIndex === -1) continue

    const key = line.slice(0, eqIndex).trim()
    let value = line.slice(eqIndex + 1).trim()
    if (key === '') continue

    const isQuoted =
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    if (isQuoted) {
      value = value.slice(1, -1)
    }

    result[key] = value
  }

  return result
}

/**
 * Raíz del proyecto vista desde este módulo. Tras el bundle de electron-vite,
 * todo `main/**` termina en un único `out/main/index.js`, así que
 * `import.meta.dirname` apunta a `out/main` tanto en dev como en build —
 * mismo patrón que usa `src/main/index.ts` para resolver `../preload` y
 * `../renderer`. Dos niveles arriba de `out/main` es la raíz del proyecto.
 */
function projectRoot(): string {
  return resolve(import.meta.dirname, '../..')
}

let cachedDotEnv: Record<string, string> | null = null

function getDotEnv(): Record<string, string> {
  if (cachedDotEnv) return cachedDotEnv

  try {
    const content = readFileSync(join(projectRoot(), '.env'), 'utf-8')
    cachedDotEnv = parseDotEnv(content)
  } catch {
    // Sin `.env` (build empaquetada, o dev sin el archivo todavía): no es un
    // error, simplemente no hay nada que aportar por esta vía.
    cachedDotEnv = {}
  }

  return cachedDotEnv
}

export interface EffectiveAiSelection {
  provider: AiProviderId
  model: string
  /**
   * Opciones RESUELTAS (T34, F8) para el modelo activo: una entrada por cada
   * `ModelOptionDescriptor` que el modelo declare en el catálogo
   * (`../../shared/ai-providers.ts`), p. ej. `{ effort: 'high' }`. `{}` si el
   * modelo activo no tiene ningún descriptor de opción. Los servicios (T36)
   * leen `options.effort` para decidir si (y qué) reasoning effort mandarle
   * al proveedor.
   */
  options: Record<string, string>
}

/**
 * Resuelve las opciones (T34) del modelo activo contra lo persistido en
 * `settings.json` (`settingsStore.getPersistedModelOptions`): por cada
 * descriptor que el modelo declare en el catálogo, `resolveOptionValue`
 * decide el valor efectivo — el guardado si sigue siendo una choice válida
 * de ESE modelo, si no el choice `isDefault`, si no el primero. Esto es lo
 * que hace la resolución "robusta": un `effort` guardado para un modelo
 * anterior que ya no aplica al modelo activo (p. ej. `xhigh` guardado y
 * luego el usuario cambia a un modelo que no lo soporta) nunca se filtra tal
 * cual, siempre cae a algo que el modelo activo sí soporta. Un modelo sin
 * descriptores (o que no está en ningún catálogo, p. ej. un slug "avanzado" de
 * OpenCode tecleado a mano) resuelve a `{}`.
 *
 * De dónde salen los descriptores (F19): primero del último catálogo DINÁMICO
 * conocido del proveedor (`./providers/model-catalog-snapshot.ts`) y solo si
 * ahí no hay nada, del curado. Ese orden es el punto: los modelos nuevos —los
 * que aparecen sin release, justo lo que F19 habilita— existen únicamente en el
 * catálogo dinámico, así que buscarlos solo en el curado descartaba en silencio
 * el `effort`/`variant` que el usuario había elegido en Settings (la UI sí veía
 * el selector, main mandaba el análisis sin la opción). Además el catálogo
 * dinámico trae los niveles REALES de esa cuenta, no los curados a mano.
 */
function findDescriptors(provider: AiProviderId, model: string): readonly ModelOptionDescriptor[] {
  const dynamic = getSnapshotProviderModels(provider)
  const fromDynamic = dynamic === undefined ? undefined : findModelInList(dynamic, model)
  if (fromDynamic) return fromDynamic.options ?? []
  return getModelOption(AI_PROVIDER_CATALOG, provider, model)?.options ?? []
}

/**
 * Proveedor cuyo catálogo dinámico conviene refrescar ANTES de resolver la
 * selección, o `null` si no hace falta (F19). Lo usa el handler de análisis
 * (`../ipc/handlers.ts`): la resolución de opciones es síncrona y mira los dos
 * catálogos de `findDescriptors`, así que solo hay algo que ganar cuando NINGUNO
 * de los dos conoce todavía el modelo activo — el caso "modelo nuevo con la app
 * recién arrancada".
 *
 * La condición importa por costo, no por corrección: calentar spawnea el CLI del
 * proveedor (para OpenCode, arrancar su server, que en frío tarda segundos), y
 * hacerlo en TODO análisis retrasaba el arranque del streaming lo suficiente
 * para romper un e2e que muestrea la primera vuelta y a nadie le sirve pagarlo
 * cuando los descriptores ya están a mano.
 */
export function providerNeedingCatalogWarmup(): AiProviderId | null {
  const { provider, model } = getEffectiveAiSelection()
  return findDescriptorSource(provider, model) === null ? provider : null
}

function findDescriptorSource(
  provider: AiProviderId,
  model: string,
): 'dynamic' | 'curated' | null {
  const dynamic = getSnapshotProviderModels(provider)
  if (dynamic !== undefined && findModelInList(dynamic, model) !== undefined) return 'dynamic'
  if (getModelOption(AI_PROVIDER_CATALOG, provider, model) !== undefined) return 'curated'
  return null
}

function resolveModelOptions(provider: AiProviderId, model: string): Record<string, string> {
  const descriptors = findDescriptors(provider, model)
  if (descriptors.length === 0) return {}

  const saved = settingsStore.getPersistedModelOptions(provider)
  const resolved: Record<string, string> = {}
  for (const descriptor of descriptors) {
    resolved[descriptor.id] = resolveOptionValue(descriptor, saved[descriptor.id])
  }
  return resolved
}

/**
 * Selección efectiva de proveedor+modelo+opciones (T26; `options` desde
 * T34): generalizado a los tres proveedores (`../../shared/ai-providers.ts`).
 * Precedencia evaluada de forma INDEPENDIENTE para el proveedor y para el
 * modelo, de mayor a menor prioridad:
 * 1. `settings.json` (`settingsStore.getPersistedSettings()`): `aiProvider`
 *    para el proveedor, `models[provider]` para el modelo de ESE proveedor.
 * 2. Entorno: `MINERVA_AI_PROVIDER` para el proveedor, `MINERVA_AI_MODEL`
 *    para el modelo — el modelo de entorno aplica al proveedor YA resuelto
 *    (persistido o de entorno), no queda forzado a un proveedor fijo.
 *    `MINERVA_AI_PROVIDER` con un valor que no es un `AiProviderId` conocido
 *    (p. ej. `openrouter`, eliminado en T59, o cualquier otro inválido) se
 *    ignora con un `console.warn` — nunca crashea, cae al default.
 * 3. Default del catálogo: `DEFAULT_AI_PROVIDER` y
 *    `DEFAULT_MODEL_BY_PROVIDER[provider]`.
 *
 * `options` (T34) se resuelve SIEMPRE contra el `provider`+`model` ya
 * resueltos arriba (ver `resolveModelOptions`), sin precedencia propia: no
 * tiene sentido "options de settings" vs "options de env", solo existe la
 * persistida (`modelOptions` en `settings.json`) resuelta contra las choices
 * del modelo activo.
 *
 * Se recalcula en cada llamada (sin cache del resultado combinado): si el
 * usuario cambia la selección desde Settings mientras la app corre, la
 * siguiente llamada a `ai:analyzePullRequest` ya debe usar el nuevo valor.
 */
export function getEffectiveAiSelection(): EffectiveAiSelection {
  const persisted = settingsStore.getPersistedSettings()
  const dotEnv = getDotEnv()

  const envProviderRaw = (
    process.env.MINERVA_AI_PROVIDER ??
    dotEnv.MINERVA_AI_PROVIDER ??
    ''
  ).trim()
  let envProvider: AiProviderId | null = null
  if (envProviderRaw.length > 0) {
    if (isAiProviderId(envProviderRaw)) {
      envProvider = envProviderRaw
    } else {
      console.warn(
        '[ai] MINERVA_AI_PROVIDER="' +
          envProviderRaw +
          '" no es un proveedor conocido; se ignora y se usa el default (' +
          DEFAULT_AI_PROVIDER +
          ').',
      )
    }
  }

  const provider: AiProviderId = persisted?.aiProvider ?? envProvider ?? DEFAULT_AI_PROVIDER

  const persistedModel = persisted?.models[provider]
  const envModel = (process.env.MINERVA_AI_MODEL ?? dotEnv.MINERVA_AI_MODEL ?? '').trim()
  const model =
    persistedModel || (envModel.length > 0 ? envModel : DEFAULT_MODEL_BY_PROVIDER[provider])

  return { provider, model, options: resolveModelOptions(provider, model) }
}

/**
 * Agregado que consume el canal IPC `settings:get` (y las respuestas de
 * `settings:setAiProvider`/`settings:setProviderModel`/`settings:setModelOption`,
 * T26/T34): la selección efectiva (`getEffectiveAiSelection`) más
 * `modelSource` (de dónde vino el modelo resuelto para el proveedor activo,
 * ver `AiModelSource` en `../../shared/types.ts`), el mapa persistido
 * completo (`perProviderModel`, para que la UI recuerde la última elección de
 * cada proveedor aunque no esté activo), el catálogo completo (para pintar la
 * UI sin un roundtrip adicional, con los `options` por modelo desde T34) y
 * `selectedOptions` (T34): las opciones YA RESUELTAS del proveedor+modelo
 * activo (mismo `options` de `getEffectiveAiSelection`), indexadas por
 * proveedor para dejar espacio a exponer más de uno si T37 lo necesita.
 */
export function getAiSettingsInfo(): AiSettingsInfo {
  const persisted = settingsStore.getPersistedSettings()
  const { provider, model, options } = getEffectiveAiSelection()

  let modelSource: AiModelSource
  if (persisted?.models[provider]) {
    modelSource = 'settings'
  } else {
    const dotEnv = getDotEnv()
    const envModel = (process.env.MINERVA_AI_MODEL ?? dotEnv.MINERVA_AI_MODEL ?? '').trim()
    modelSource = envModel.length > 0 ? 'env' : 'default'
  }

  return {
    provider,
    model,
    modelSource,
    perProviderModel: persisted?.models ?? {},
    catalog: AI_PROVIDER_CATALOG,
    selectedOptions: { [provider]: options },
  }
}
