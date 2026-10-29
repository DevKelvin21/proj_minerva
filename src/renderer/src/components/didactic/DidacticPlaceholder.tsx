import { useTranslation } from 'react-i18next'
import { Button } from '../ui/Button'
import { ActiveModelHint } from './ActiveModelHint'

interface DidacticPlaceholderProps {
  /** `undefined` (sin PR seleccionado) deja el botón deshabilitado. */
  onAnalyze?: () => void
}

/**
 * Before the first analysis: what the panel will show (the same sections an
 * analysis has, walkthrough included), the primary "Analyze PR" button and
 * the model that will run it.
 */
export function DidacticPlaceholder({ onAnalyze }: DidacticPlaceholderProps): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="flex min-w-0 flex-col gap-2.5" data-testid="didactic-placeholder">
      <p className="text-sm text-text">{t('didactic.placeholder.intro')}</p>
      <ul className="list-disc space-y-0.5 pl-5 text-xs leading-relaxed text-muted">
        <li>{t('didactic.placeholder.itemSummary')}</li>
        <li>{t('didactic.placeholder.itemDiagrams')}</li>
        <li>{t('didactic.placeholder.itemEndpoints')}</li>
        <li>{t('didactic.placeholder.itemSetup')}</li>
      </ul>
      <Button
        variant="primary"
        size="md"
        className="w-full"
        disabled={!onAnalyze}
        onClick={onAnalyze}
        title={onAnalyze ? undefined : t('didactic.placeholder.selectPrFirst')}
      >
        {t('didactic.placeholder.analyze')}
      </Button>
      <ActiveModelHint />
    </div>
  )
}
