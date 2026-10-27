/**
 * Catálogo de proveedores de IA (T26): Claude Code, Codex y OpenCode (T57),
 * cada uno con su propia lista curada de modelos. Hasta T59 existía un cuarto
 * proveedor, OpenRouter, que hablaba HTTP directo con `openrouter.ai` (API
 * OpenAI-compatible) y gestionaba su propia API key en Settings; decisión de
 * Edilson (T59): Minerva deja de hablar con OpenRouter directamente — quien
 * quiera esos modelos los usa DENTRO de OpenCode (`opencode auth login` con
 * el upstream `openrouter`, ver `OPENCODE_MODELS` más abajo y el slug
 * `openrouter/<id>` que produce la migración de `main/settings/store.ts`).
 * Claude Code, Codex y OpenCode no llaman a una API HTTP con un id de modelo
 * libre, usan los CLIs/SDK oficiales (T27/T28/T29/T55-T57), así que su
 * catálogo curado es el FALLBACK cuando no hay lista dinámica (T35, T57 y F19:
 * `main/ai/providers/{claude-code,codex,opencode}-model-catalog.ts`).
 *
 * F19: los TRES proveedores tienen catálogo dinámico — Claude Code era el
 * último que no lo tenía, y por eso su lista solo se actualizaba publicando
 * una release de Minerva. Corolario para quien edite las listas de abajo: son
 * fallbacks de emergencia (CLI ausente o que no responde), NO la fuente de
 * verdad de "qué modelos hay"; agregar un modelo nuevo acá no es necesario
 * para que aparezca en la UI.
 */
export type AiProviderId = 'claude-code' | 'codex' | 'opencode'

/**
 * Una opción concreta dentro de un `ModelOptionDescriptor` (T34, F8): p. ej.
 * para el descriptor `effort`, cada choice es un nivel (`low`/`medium`/...)
 * con su etiqueta humana y una descripción corta para la UI (T37).
 * `isDefault` marca el choice al que cae la resolución cuando no hay nada
 * persistido para ese modelo, o cuando lo persistido no es válido para él
 * (ver `resolveOptionValue` más abajo y `getEffectiveAiSelection` en
 * `main/ai/env.ts`) — a lo sumo un choice por descriptor debería tener
 * `isDefault: true`; si ninguno lo tiene, `resolveOptionValue` cae al primero
 * de la lista.
 */
export interface ModelOptionChoice {
  value: string
  label: string
  description?: string
  isDefault?: boolean
}

/**
 * Descriptor de opción AUTOCONTENIDO por modelo (patrón de t3code, F8): cada
 * modelo del catálogo declara sus propias opciones configurables (hoy solo
 * `effort`, extensible a service tier/thinking/context window después) con
 * sus choices válidas — la UI (T37) es genérica sobre este array, nunca
 * bifurca por proveedor, y al cambiar de modelo el valor elegido se recalcula
 * contra las choices del nuevo descriptor (nunca se manda un valor que el
 * modelo activo no soporta).
 */
export interface ModelOptionDescriptor {
  id: string
  label: string
  choices: ModelOptionChoice[]
}

export interface AiModelOption {
  id: string
  label: string
  vendor: string
  /** Descriptores de opción de este modelo (T34); ausente = el modelo no tiene opciones configurables. */
  options?: ModelOptionDescriptor[]
  /**
   * Id canónico al que resuelve `id` cuando `id` es un ALIAS de familia
   * (F19: `sonnet` → `claude-sonnet-5`, `opus[1m]` → `claude-opus-5[1m]`), tal
   * como lo reporta el proveedor (`resolvedModel` de `ModelInfo` en el Agent
   * SDK de Claude Code). Existe para MATCHEAR una selección persistida contra
   * la fila del catálogo que la cubre: quien eligió `claude-sonnet-5` cuando
   * ese id estaba en el catálogo curado sigue teniendo eso en `settings.json`,
   * y el catálogo dinámico hoy trae la fila como `sonnet` — sin este campo esa
   * selección no matchearía ninguna fila y perdería tanto el badge "Activo"
   * como el selector de razonamiento (ver `findModelInList`).
   *
   * Ausente cuando `id` YA es el id canónico (el caso de todos los modelos de
   * Codex/OpenCode y de los curados de este archivo).
   */
  aliasFor?: string
}

export interface AiProviderCatalogEntry {
  provider: AiProviderId
  label: string
  models: readonly AiModelOption[]
}

/**
 * Etiquetas/descripciones humanas para choices de `effort`, compartidas por
 * todos los descriptores `effort` del catálogo (T34, F8) — así la UI (T37)
 * siempre ve el mismo texto para el mismo nivel, sea cual sea el proveedor.
 */
// English on purpose (default UI language): the renderer translates known
// levels by `value` (`settings.modelOptions.*` in its locales) and shows this
// text only as the fallback. Exported so the renderer can tell a curated
// description (translatable) from one a provider sent (shown as is).
export const EFFORT_CHOICE_LABELS: Record<string, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Very high',
  max: 'Max',
  ultra: 'Ultra',
}

export const EFFORT_CHOICE_DESCRIPTIONS: Record<string, string> = {
  low: 'Faster answers, with less reasoning.',
  medium: 'Balance between speed and reasoning depth.',
  high: 'Deeper reasoning; slower answers.',
  xhigh: 'Extended reasoning for complex tasks.',
  max: 'The most reasoning available; the slowest option.',
  ultra: 'Maximum reasoning with automatic task delegation.',
}

/**
 * Arma el descriptor `effort` a partir de la lista de niveles soportados por
 * un modelo concreto y cuál es su default (T34) — evita repetir a mano las
 * choices en cada entrada del catálogo de abajo. `defaultValue` DEBE estar en
 * `values` (invariante de los datos curados de este archivo, no se valida en
 * runtime porque es contenido estático, no input de usuario).
 *
 * Exportada desde F19 para que el catálogo DINÁMICO de Claude Code
 * (`main/ai/providers/claude-code-model-catalog.ts`) arme sus descriptores con
 * las MISMAS etiquetas y descripciones que los curados de acá: el Agent SDK
 * reporta los niveles soportados (`supportedEffortLevels`) pero no texto
 * humano para cada uno, así que reusar esta función es lo que evita una cuarta
 * copia del mapa `low/medium/high/...` (Codex y OpenCode tienen la suya porque
 * sus proveedores SÍ mandan descripciones/variantes propias).
 */
export function effortDescriptor(
  values: readonly string[],
  defaultValue: string,
): ModelOptionDescriptor {
  return {
    id: 'effort',
    label: 'Reasoning',
    choices: values.map((value) => ({
      value,
      label: EFFORT_CHOICE_LABELS[value] ?? value,
      description: EFFORT_CHOICE_DESCRIPTIONS[value],
      isDefault: value === defaultValue,
    })),
  }
}

/**
 * Matriz de `effort` para Claude Code curada a mano (T34, fuente: informe de
 * investigación de t3code): `fable-5`/`opus-4-8`/`sonnet-5` soportan el rango
 * completo (incluido `xhigh` nativo); `haiku-4-5` es más conservador (sin
 * `xhigh`/`max`). El default en los cuatro es `high`. T36 normaliza cualquier
 * remapeo de compatibilidad adicional al pasarlo al SDK.
 */
const CLAUDE_CODE_FULL_EFFORT = effortDescriptor(['low', 'medium', 'high', 'xhigh', 'max'], 'high')
const CLAUDE_CODE_HAIKU_EFFORT = effortDescriptor(['low', 'medium', 'high'], 'high')

/**
 * Alias de modelo que entiende `@anthropic-ai/claude-agent-sdk` (T28) vía
 * `query({ options: { model } })` — no son ids de vendor/model estilo
 * `openrouter.ai`, son los nombres que el SDK/CLI de Claude Code resuelve.
 *
 * Desde F19 esta lista es SOLO el fallback: el catálogo real lo trae
 * `main/ai/providers/claude-code-model-catalog.ts` pidiéndole los modelos al
 * propio CLI (`supportedModels()` del Agent SDK), así que un modelo nuevo de
 * Anthropic aparece sin tocar este archivo ni publicar una release. Este
 * fallback solo se ve cuando el CLI no está instalado / no responde.
 *
 * Por eso la primera entrada es el ALIAS DE FAMILIA `opus` y no un id con
 * versión: un alias resuelve siempre al Opus más nuevo que la cuenta tenga
 * disponible, así que ni el fallback envejece hacia atrás (era exactamente el
 * síntoma que abrió F19: Opus 5 disponible en el CLI y el picker mostrando
 * `claude-opus-4-8` como lo más nuevo). Los ids con versión que le siguen se
 * mantienen porque siguen siendo ids válidos y son los que pueden estar
 * persistidos en `settings.json` de instalaciones previas.
 */
const CLAUDE_CODE_MODELS = [
  { id: 'opus', label: 'Opus (latest)', vendor: 'Anthropic', options: [CLAUDE_CODE_FULL_EFFORT] },
  { id: 'claude-fable-5', label: 'Fable 5', vendor: 'Anthropic', options: [CLAUDE_CODE_FULL_EFFORT] },
  { id: 'claude-sonnet-5', label: 'Sonnet 5', vendor: 'Anthropic', options: [CLAUDE_CODE_FULL_EFFORT] },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5', vendor: 'Anthropic', options: [CLAUDE_CODE_HAIKU_EFFORT] },
] as const satisfies readonly AiModelOption[]

/**
 * Matriz de `effort` de Codex según `model/list` de `codex app-server`
 * 0.144.x: la familia GPT-5.6 (Sol/Terra/Luna) amplía el set — Sol y Terra
 * soportan `low|medium|high|xhigh|max|ultra`, Luna llega hasta `max`, y los
 * modelos previos (gpt-5.5 y anteriores) se quedan en `low|medium|high|xhigh`.
 * Los `defaultReasoningEffort` varían por modelo (spark=high, el resto=medium)
 * pero eso solo cambia a qué cae cuando NO hay valor elegido, y el catálogo
 * DINÁMICO (`codex-model-catalog.ts`) trae el default real por modelo para la
 * UI. Acá el default es `medium` (el más común).
 */
const CODEX_EFFORT = effortDescriptor(['low', 'medium', 'high', 'xhigh'], 'medium')
const CODEX_GPT56_EFFORT = effortDescriptor(['low', 'medium', 'high', 'xhigh', 'max', 'ultra'], 'medium')
const CODEX_GPT56_LUNA_EFFORT = effortDescriptor(['low', 'medium', 'high', 'xhigh', 'max'], 'medium')

/**
 * IDs verificados contra la RPC `model/list` de `codex app-server` 0.144.x
 * (T29/T35; familia GPT-5.6 Sol/Terra/Luna agregada en 0.2.4 — OJO: un CLI
 * `codex` < 0.144 NO expone estos modelos por la RPC, hay que actualizarlo
 * para verlos en el catálogo dinámico). Esta lista ESTÁTICA cumple dos roles:
 * (a) fallback cuando no hay
 * sesión Codex / la RPC falla, y (b) — CLAVE — es el catálogo contra el que
 * `getEffectiveAiSelection` (`main/ai/env.ts`, SÍNCRONO) resuelve el `effort`
 * elegido: por eso cada modelo lleva su descriptor `effort`, sin el cual el
 * effort guardado se descartaría al resolver (bug destapado en la verificación
 * e2e de F8). `codex-model-catalog.ts` refresca la LISTA dinámicamente para la
 * UI (`ai:getProviderModels`), con los defaults reales por modelo; un modelo
 * dinámico que no esté en esta lista igual se puede elegir, pero su effort solo
 * se resuelve en main si comparte los valores de `CODEX_EFFORT` (hoy, todos).
 */
const CODEX_MODELS = [
  { id: 'gpt-5.6-sol', label: 'GPT-5.6-Sol', vendor: 'OpenAI', options: [CODEX_GPT56_EFFORT] },
  { id: 'gpt-5.6-terra', label: 'GPT-5.6-Terra', vendor: 'OpenAI', options: [CODEX_GPT56_EFFORT] },
  { id: 'gpt-5.6-luna', label: 'GPT-5.6-Luna', vendor: 'OpenAI', options: [CODEX_GPT56_LUNA_EFFORT] },
  { id: 'gpt-5.5', label: 'GPT-5.5', vendor: 'OpenAI', options: [CODEX_EFFORT] },
  { id: 'gpt-5.4', label: 'GPT-5.4', vendor: 'OpenAI', options: [CODEX_EFFORT] },
  { id: 'gpt-5.4-mini', label: 'GPT-5.4-Mini', vendor: 'OpenAI', options: [CODEX_EFFORT] },
  {
    id: 'gpt-5.3-codex-spark',
    label: 'GPT-5.3-Codex-Spark',
    vendor: 'OpenAI',
    options: [CODEX_EFFORT],
  },
] as const satisfies readonly AiModelOption[]

/**
 * Catálogo curado MÍNIMO de OpenCode (T57): fallback cuando el catálogo
 * DINÁMICO (`main/ai/providers/opencode-model-catalog.ts`, vía
 * `provider.list()` del server local) no está disponible — binario ausente,
 * server que no arranca, o sin ningún upstream `connected` todavía. Verificado
 * EMPÍRICAMENTE contra `opencode` 1.17.18 (`opencode models`, gateway
 * `opencode/*` visible sin ningún upstream configurado): `big-pickle` es el
 * modelo por default del gateway (sin costo, sin necesidad de credenciales
 * propias) y el resto son los `*-free` del mismo gateway. Estos ids NO
 * requieren autenticación adicional (a diferencia de `anthropic/*`,
 * `openai/*`, etc., que solo aparecen tras `opencode auth login` y viven en el
 * catálogo DINÁMICO, nunca en este fallback estático). Sin descriptor
 * `effort`/`variant` a propósito: el catálogo dinámico trae las variantes
 * reales por modelo, y este fallback deliberadamente minimalista solo cubre
 * el caso "no hay nada más que mostrar".
 */
const OPENCODE_MODELS = [
  { id: 'opencode/big-pickle', label: 'Big Pickle', vendor: 'OpenCode' },
  { id: 'opencode/deepseek-v4-flash-free', label: 'DeepSeek V4 Flash Free', vendor: 'OpenCode' },
  { id: 'opencode/hy3-free', label: 'Hy3 Free', vendor: 'OpenCode' },
  { id: 'opencode/mimo-v2.5-free', label: 'MiMo V2.5 Free', vendor: 'OpenCode' },
] as const satisfies readonly AiModelOption[]

export const AI_PROVIDER_CATALOG: Record<AiProviderId, AiProviderCatalogEntry> = {
  'claude-code': { provider: 'claude-code', label: 'Claude Code', models: CLAUDE_CODE_MODELS },
  codex: { provider: 'codex', label: 'Codex', models: CODEX_MODELS },
  opencode: { provider: 'opencode', label: 'OpenCode', models: OPENCODE_MODELS },
}

export const AI_PROVIDER_IDS = [
  'claude-code',
  'codex',
  'opencode',
] as const satisfies readonly AiProviderId[]

/** Guard de runtime: valida un `unknown` (payload IPC, JSON persistido, env var) como `AiProviderId`. */
export function isAiProviderId(value: unknown): value is AiProviderId {
  return typeof value === 'string' && (AI_PROVIDER_IDS as readonly string[]).includes(value)
}

/** Proveedor activo cuando no hay nada persistido en `settings.json` ni `MINERVA_AI_PROVIDER` en el entorno. */
export const DEFAULT_AI_PROVIDER: AiProviderId = 'opencode'

/** Modelo default por proveedor, usado cuando no hay nada persistido ni `MINERVA_AI_MODEL` para ESE proveedor. */
export const DEFAULT_MODEL_BY_PROVIDER: Record<AiProviderId, string> = {
  'claude-code': 'claude-sonnet-5',
  codex: 'gpt-5.5',
  opencode: 'opencode/big-pickle',
}

/**
 * Busca la entrada de catálogo (`AiModelOption`, con sus `options` si tiene)
 * de un modelo concreto dentro de un proveedor (T34) — la usan
 * `getEffectiveAiSelection`/`getAiSettingsInfo` (`main/ai/env.ts`) para saber
 * qué descriptores de opción aplican al modelo ACTIVO, y la UI (T37) para
 * pintar el selector de opciones del modelo seleccionado. `undefined` si el
 * modelo no está en el catálogo curado (p. ej. un slug "avanzado" de OpenCode
 * tecleado a mano, que no tiene opciones configurables).
 */
export function getModelOption(
  catalog: Record<AiProviderId, AiProviderCatalogEntry>,
  provider: AiProviderId,
  modelId: string,
): AiModelOption | undefined {
  return findModelInList(catalog[provider].models, modelId)
}

/**
 * Busca `modelId` en una lista de modelos (curada o DINÁMICA, F19) matcheando
 * primero por id exacto y, solo si nada matchea, por `aliasFor` — el orden
 * importa: `default`/`opus[1m]` pueden resolver al mismo id canónico, y probar
 * el exacto primero garantiza que una selección concreta nunca se atribuya a
 * la fila alias que la envuelve.
 *
 * Se usa en los dos lados de la frontera IPC: en main para resolver las
 * opciones del modelo activo (`main/ai/env.ts`) y en el renderer para marcar
 * "Activo" y pintar el selector de razonamiento
 * (`components/settings/ProviderModelPanel.tsx`). Sin el paso por `aliasFor`,
 * una selección persistida como `claude-sonnet-5` no matchearía la fila
 * `sonnet` que hoy devuelve el catálogo dinámico de Claude Code y el usuario
 * vería el picker sin ninguna card activa.
 */
export function findModelInList(
  models: readonly AiModelOption[],
  modelId: string,
): AiModelOption | undefined {
  return (
    models.find((model) => model.id === modelId) ??
    models.find((model) => model.aliasFor === modelId)
  )
}

/**
 * Resuelve el valor efectivo de un descriptor de opción (T34): si
 * `savedValue` es una de las `choices` del descriptor, gana; si no (no hay
 * nada guardado, o lo guardado no aplica al modelo ACTIVO — p. ej. `effort:
 * 'xhigh'` guardado para un modelo que no lo soporta), cae al choice marcado
 * `isDefault`; si ninguno lo está, cae al primero de la lista. Esta es la
 * "resolución robusta" que garantiza que NUNCA se le manda a un servicio
 * (T36) un valor que el modelo activo no soporta, sin importar qué haya
 * quedado persistido de una selección de modelo anterior.
 */
export function resolveOptionValue(
  descriptor: ModelOptionDescriptor,
  savedValue: string | undefined,
): string {
  if (savedValue !== undefined && descriptor.choices.some((choice) => choice.value === savedValue)) {
    return savedValue
  }
  const defaultChoice = descriptor.choices.find((choice) => choice.isDefault)
  return (defaultChoice ?? descriptor.choices[0])?.value ?? ''
}
