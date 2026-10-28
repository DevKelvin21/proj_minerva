import { useTranslation } from 'react-i18next'
import type { AiProviderId } from '../../../../shared/ai-providers'
import type { AiProviderStatus, AiSettingsInfo } from '../../../../shared/types'
import { resolveModelHintLabels } from '../../lib/model-labels'
import { Badge } from '../ui/Badge'

const STATUS_TONE: Record<AiProviderStatus['status'], 'neutral' | 'warning' | 'success'> = {
  unavailable: 'neutral',
  installed: 'warning',
  authenticated: 'success',
}

interface ActiveConfigSummaryProps {
  info: AiSettingsInfo
  statuses: Record<AiProviderId, AiProviderStatus> | null
}

/** Sign-in state of one AI provider's CLI, as a badge (`…` while it is being checked). */
export function ProviderStatusBadge({
  status,
}: {
  status: AiProviderStatus | undefined
}): React.JSX.Element {
  const { t } = useTranslation()
  if (!status) return <Badge tone="neutral">…</Badge>
  return (
    <Badge tone={STATUS_TONE[status.status]}>
      {t(`settings.providerStatus.${status.status}`)}
      {status.status === 'authenticated' && status.account?.plan ? ' · ' + status.account.plan : ''}
      {status.status === 'authenticated' && status.account?.email ? ' · ' + status.account.email : ''}
    </Badge>
  )
}

/**
 * Strip "En uso" (T62, F12): enuncia sin ambigüedad qué proveedor, modelo y
 * nivel de razonamiento están ACTIVOS antes de que el usuario toque nada más
 * del modal. Diagnóstico que motivó esto (ver `PLAN.md` § F12): con el
 * diseño viejo (`ProviderPicker`/`ModelPicker`, radios) nada lo enunciaba —
 * el proveedor se deducía de qué radio estaba marcada y el modelo activo se
 * confundía con el borrador todavía sin "Guardar".
 *
 * It heads Settings › AI › Model, in its own "In use" group above the
 * provider tabs: looking at another provider's models never hides what is
 * really active.
 */
export function ActiveConfigSummary({
  info,
  statuses,
}: ActiveConfigSummaryProps): React.JSX.Element {
  const { t } = useTranslation()
  const status = statuses?.[info.provider]
  const { effortLabel } = resolveModelHintLabels(
    info.catalog,
    info.provider,
    info.model,
    info.selectedOptions?.[info.provider]?.effort,
    t,
  )

  const statusBadge = <ProviderStatusBadge status={status} />

  // El aviso de procedencia del modelo se muestra en AMBAS densidades: es la
  // única pista de que `MINERVA_AI_MODEL` está pisando lo que se elija acá.
  const sourceNote = (
    <>
      {info.modelSource === 'env' && (
        <p className="mt-1.5 rounded-md border border-warning/30 bg-warning/10 px-2.5 py-1.5 text-xs text-warning">
          {t('settings.activeConfig.envOverride')}
        </p>
      )}
      {info.modelSource === 'default' && (
        <p className="mt-1.5 text-xs text-muted">{t('settings.activeConfig.providerDefault')}</p>
      )}
    </>
  )

  return (
    <div className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-text">{info.catalog[info.provider].label}</span>
        {statusBadge}
      </div>

      <p className="mt-1 text-sm text-text">
        <span className="font-mono">{info.model}</span>
        {effortLabel && (
          <span className="text-muted">
            {' · '}
            {t('settings.activeConfig.reasoning', { effort: effortLabel })}
          </span>
        )}
      </p>

      {sourceNote}
    </div>
  )
}
