import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { resolveOptionValue } from '../../../../shared/ai-providers'
import type { AiModelOption, AiProviderId } from '../../../../shared/ai-providers'
import { choiceDescription, choiceLabel, optionLabel } from '../../lib/model-labels'
import { Chip } from '../ui/Chip'
import { Spinner } from '../ui/Spinner'

interface ModelOptionPickerProps {
  provider: AiProviderId
  /** El `AiModelOption` SELECCIONADO en `ModelPicker` (draft o guardado) — sus `options` deciden qué se pinta. */
  model: AiModelOption
  /** Valores YA resueltos para `provider` (`info.selectedOptions?.[provider]`, T34) — puede faltar la entrada de un descriptor si nunca se guardó nada. */
  selected: Record<string, string>
  onSelect: (provider: AiProviderId, optionId: string, value: string) => Promise<boolean>
}

/**
 * Selector GENÉRICO de opciones de modelo (T37, F8): dado el `AiModelOption`
 * seleccionado, pinta un grupo por cada `ModelOptionDescriptor` de
 * `model.options` (hoy solo `effort`, pensado para sumar service tier/
 * thinking después sin reescribir esta UI). Si el modelo no tiene `options`
 * (p. ej. un modelo Codex sin efforts, o los modelos fallback curados de
 * OpenCode), el llamador simplemente no monta este componente (ver
 * `ModelPicker`).
 *
 * El valor activo de cada descriptor sale de `resolveOptionValue`
 * (`shared/ai-providers.ts`, T34): la misma "resolución robusta" que usa
 * `main/ai/env.ts` para nunca mostrar/mandar un choice que el modelo activo
 * no soporta, aunque `selected` traiga un valor de un modelo distinto (p. ej.
 * el usuario cambió de modelo en el picker sin guardar todavía).
 *
 * Persistencia INMEDIATA al elegir un choice (sin botón de "Guardar" aparte,
 * mismo criterio que `ProviderPicker.handleSelect`): cada grupo trackea su
 * propio choice "en vuelo" (`savingValue`) para no bloquear los demás
 * descriptores mientras uno está guardando.
 *
 * El llamador (`ModelPicker`) monta este componente con
 * `key={provider + '/' + model.id}`: cambiar de modelo/proveedor debe
 * resetear el estado local de guardado en vez de arrastrarlo del modelo
 * anterior (mismo patrón de remount-por-`key` que el resto del repo, en vez
 * de un efecto de sincronización).
 */
export function ModelOptionPicker({
  provider,
  model,
  selected,
  onSelect,
}: ModelOptionPickerProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const [savingValue, setSavingValue] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  const descriptors = model.options
  if (!descriptors || descriptors.length === 0) return null

  async function handleSelect(optionId: string, value: string): Promise<void> {
    setSavingValue(value)
    setSaveError(null)
    const ok = await onSelect(provider, optionId, value)
    setSavingValue(null)
    if (!ok) setSaveError(t('settings.modelOptions.saveError'))
  }

  return (
    <div className="mt-3 space-y-3 border-t border-border pt-3">
      {descriptors.map((descriptor) => {
        const currentValue = resolveOptionValue(descriptor, selected[descriptor.id])
        const currentChoice = descriptor.choices.find((choice) => choice.value === currentValue)
        const currentDescription = currentChoice ? choiceDescription(t, currentChoice) : undefined
        return (
          <div key={descriptor.id}>
            <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
              {optionLabel(t, descriptor)}
            </h4>
            <div className="flex flex-wrap gap-1.5">
              {descriptor.choices.map((choice) => {
                const checked = currentValue === choice.value
                const isSaving = savingValue === choice.value
                return (
                  <Chip
                    key={choice.value}
                    title={choiceDescription(t, choice)}
                    selected={checked}
                    disabled={savingValue !== null}
                    onClick={() => void handleSelect(descriptor.id, choice.value)}
                    icon={isSaving ? <Spinner size={11} /> : undefined}
                  >
                    {choiceLabel(t, choice)}
                  </Chip>
                )
              })}
            </div>
            {currentDescription && (
              <p className="mt-1 text-[11px] text-muted">{currentDescription}</p>
            )}
          </div>
        )
      })}
      {saveError && (
        <p role="alert" className="text-xs text-danger">
          {saveError}
        </p>
      )}
    </div>
  )
}
