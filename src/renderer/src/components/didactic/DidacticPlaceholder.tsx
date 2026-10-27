import { useTranslation } from 'react-i18next'

interface DidacticPlaceholderProps {
  /** `undefined` (sin PR seleccionado) deja el botón deshabilitado. */
  onAnalyze?: () => void
}

/** Descripción de lo que hace el panel + botón "Analizar PR" (habilitado solo con PR seleccionado). */
export function DidacticPlaceholder({ onAnalyze }: DidacticPlaceholderProps): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <>
      <div className="rounded-md border border-border bg-bg p-3 text-sm text-muted">
        <p className="mb-2 text-text">{t('didactic.placeholder.intro')}</p>
        <ul className="list-inside list-disc space-y-1">
          <li>{t('didactic.placeholder.itemSummary')}</li>
          <li>{t('didactic.placeholder.itemC4')}</li>
          <li>{t('didactic.placeholder.itemEndpoints')}</li>
          <li>{t('didactic.placeholder.itemEr')}</li>
        </ul>
      </div>

      <button
        type="button"
        disabled={!onAnalyze}
        onClick={onAnalyze}
        title={onAnalyze ? undefined : t('didactic.placeholder.selectPrFirst')}
        className={
          onAnalyze
            ? 'rounded-md border border-accent/40 bg-accent/15 px-3 py-2 text-sm font-medium text-accent transition-colors hover:bg-accent/25'
            : 'cursor-not-allowed rounded-md border border-border bg-border/40 px-3 py-2 text-sm font-medium text-muted'
        }
      >
        {t('didactic.placeholder.analyze')}
      </button>
    </>
  )
}
