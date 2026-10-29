import type { TFunction } from 'i18next'
import { EFFORT_CHOICE_DESCRIPTIONS, getModelOption } from '../../../shared/ai-providers'
import type {
  AiProviderCatalogEntry,
  AiProviderId,
  ModelOptionChoice,
  ModelOptionDescriptor,
} from '../../../shared/ai-providers'
import { i18next } from '../i18n'

/** Descriptor ids whose heading has its own translation (`settings.modelOptions.<id>`). */
const KNOWN_OPTION_IDS = ['effort', 'variant'] as const
type KnownOptionId = (typeof KNOWN_OPTION_IDS)[number]

/** Choice values with a translated label (`settings.modelOptions.levels.<value>`). */
const KNOWN_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra', 'minimal', 'none'] as const
type KnownLevel = (typeof KNOWN_LEVELS)[number]

/** Levels whose curated description has a translation (`settings.modelOptions.levelDescriptions.<value>`). */
const DESCRIBED_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] as const
type DescribedLevel = (typeof DESCRIBED_LEVELS)[number]

function isOneOf<T extends string>(list: readonly T[], value: string): value is T {
  return (list as readonly string[]).includes(value)
}

/** Heading of an option group ("Reasoning"), translated when the id is known. */
export function optionLabel(t: TFunction, descriptor: ModelOptionDescriptor): string {
  return isOneOf<KnownOptionId>(KNOWN_OPTION_IDS, descriptor.id)
    ? t(`settings.modelOptions.${descriptor.id}`)
    : descriptor.label
}

/** Label of one choice ("High"), translated when the value is a known level. */
export function choiceLabel(t: TFunction, choice: ModelOptionChoice): string {
  return isOneOf<KnownLevel>(KNOWN_LEVELS, choice.value)
    ? t(`settings.modelOptions.levels.${choice.value}`)
    : choice.label
}

/**
 * Description of one choice: the curated text (ours, English in the shared
 * catalog) is translated; text a provider sent (Codex) is shown as is.
 */
export function choiceDescription(t: TFunction, choice: ModelOptionChoice): string | undefined {
  if (
    choice.description !== undefined &&
    isOneOf<DescribedLevel>(DESCRIBED_LEVELS, choice.value) &&
    EFFORT_CHOICE_DESCRIPTIONS[choice.value] === choice.description
  ) {
    return t(`settings.modelOptions.levelDescriptions.${choice.value}`)
  }
  return choice.description
}

/**
 * Human name of a model ("Big Pickle"), the same in the title bar chip and the
 * analysis panel; the raw id when the catalog no longer lists it.
 */
export function modelDisplayLabel(
  catalog: Record<AiProviderId, AiProviderCatalogEntry>,
  provider: AiProviderId,
  model: string,
): string {
  return getModelOption(catalog, provider, model)?.label ?? model
}

/**
 * Resuelve los labels humanos (proveedor, effort) para un
 * `(provider, model, effortValue)` dado, contra el catálogo ESTÁTICO
 * (`AiSettingsInfo.catalog` — no cambia con la selección del usuario).
 *
 * Extraído en T62 (F12) de `ActiveModelHint.tsx` para que tres consumidores
 * compartan la MISMA resolución: el banner sutil del panel didáctico
 * (`ActiveModelHint`), el strip "En uso" del modal de Settings
 * (`ActiveConfigSummary`) y el chip de la TitleBar — así "Proveedor · Modelo
 * · Razonamiento" nunca diverge entre superficies.
 *
 * Si el modelo ya no está en el catálogo (id viejo, o un slug tecleado a
 * mano en el modo "avanzado" de OpenCode) `getModelOption` devuelve
 * `undefined` — degradamos mostrando el id crudo sin effort, sin romper.
 *
 * `effortLabel` sale traducido al idioma activo; `t` es opcional para que los
 * llamadores que ya tienen el de `useTranslation()` lo pasen (y re-rendericen
 * al cambiar de idioma).
 */
export function resolveModelHintLabels(
  catalog: Record<AiProviderId, AiProviderCatalogEntry>,
  provider: AiProviderId,
  model: string,
  effortValue: string | undefined,
  t?: TFunction,
): { providerLabel: string; effortLabel: string | undefined } {
  const providerLabel = catalog[provider].label
  const effortDescriptor = getModelOption(catalog, provider, model)?.options?.find(
    (descriptor) => descriptor.id === 'effort',
  )
  const effortChoice = effortDescriptor?.choices.find((choice) => choice.value === effortValue)
  // `i18next.t` is not bound to its instance: bind it for the fallback.
  const translate = t ?? i18next.t.bind(i18next)
  const effortLabel = effortChoice ? choiceLabel(translate, effortChoice) : undefined

  return { providerLabel, effortLabel }
}
