import { Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AnalysisGenerationInfo } from '../../../../shared/types'
import { useSettings } from '../../hooks/use-settings'
import { formatModelName } from '../../lib/analysis-status'
import { modelDisplayLabel, resolveModelHintLabels } from '../../lib/model-labels'

interface ActiveModelHintProps {
  /**
   * Sello de generación del análisis MOSTRADO (`analysis.generatedWith`,
   * T39/T40). Si viene, el banner pinta proveedor/modelo/effort de ESTE
   * objeto (no de la config vigente) — así no miente si el usuario cambia
   * de proveedor/modelo/effort en Settings después de generar el análisis
   * (Issue 1, F9). Si no viene (streaming en curso, aún sin `analysis`
   * final), cae al comportamiento de siempre: la config vigente.
   */
  generatedWith?: AnalysisGenerationInfo
}

/**
 * The model of the analysis, named like the title bar chip: "Big Pickle ·
 * OpenCode" (+ effort). Sealed with the GENERATION config of the analysis on
 * screen when `generatedWith` is passed, else the current config from
 * `useSettings()` (before an analysis exists, while it streams, when it
 * fails). The tooltip keeps the raw id. `null` while the catalog has not
 * loaded: a secondary detail, not worth an error.
 */
export function ActiveModelHint({ generatedWith }: ActiveModelHintProps = {}): React.JSX.Element | null {
  const { info } = useSettings()
  const { t } = useTranslation()
  if (!info) return null

  const provider = generatedWith?.provider ?? info.provider
  const model = generatedWith?.model ?? info.model
  const effortValue = generatedWith
    ? generatedWith.options.effort
    : info.selectedOptions?.[info.provider]?.effort

  const { providerLabel, effortLabel } = resolveModelHintLabels(
    info.catalog,
    provider,
    model,
    effortValue,
    t,
  )
  const name = formatModelName(modelDisplayLabel(info.catalog, provider, model), providerLabel, effortLabel)
  const summary = providerLabel + ' · ' + model + (effortLabel ? ' · ' + effortLabel : '')

  return (
    <span
      className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted"
      title={t('didactic.modelHint.title', { summary })}
      data-testid="analysis-model"
    >
      <Sparkles size={11} className="shrink-0 text-accent" aria-hidden />
      <span className="truncate">{name}</span>
    </span>
  )
}
