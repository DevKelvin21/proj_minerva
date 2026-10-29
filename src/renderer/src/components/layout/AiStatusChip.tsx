import { Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { prKey } from '../../../../shared/scm'
import type { PullRequestSummary } from '../../../../shared/types'
import { useAppStore } from '../../stores/app-store'
import { useSettings } from '../../hooks/use-settings'
import { useDidacticAnalysis } from '../../hooks/use-didactic-analysis'
import { modelDisplayLabel, resolveModelHintLabels } from '../../lib/model-labels'
import { Spinner } from '../ui/Spinner'

/** What the AI is doing for the PR on screen; `null` = no PR under review. */
type AiChipStatus = 'idle' | 'checking' | 'exploring' | 'writing' | 'ready' | 'failed'

const STATUS_DOT: Record<AiChipStatus, string> = {
  idle: 'bg-muted/60',
  checking: 'bg-muted/60',
  exploring: 'bg-accent',
  writing: 'bg-accent',
  ready: 'bg-success',
  failed: 'bg-danger',
}

/**
 * The AI in the title bar: the active model and, on a review, the state of
 * that PR's analysis (not analyzed, exploring/writing while it streams,
 * ready, failed). Click = Settings, where the provider and model are picked.
 * Replaces the old "Provider · Model" Settings chip; the gear stays apart.
 */
export function AiStatusChip({ compact }: { compact: boolean }): React.JSX.Element | null {
  const selectedPr = useAppStore((s) => s.selectedPr)
  const onReview = useAppStore((s) => s.mainView === 'review')
  if (onReview && selectedPr) {
    return (
      <ReviewAiChip
        key={prKey(selectedPr.repo, selectedPr.number)}
        pr={selectedPr}
        compact={compact}
      />
    )
  }
  return <ChipView status={null} compact={compact} />
}

function ReviewAiChip({
  pr,
  compact,
}: {
  pr: PullRequestSummary
  compact: boolean
}): React.JSX.Element | null {
  const { analysis, streamingSections, phase, checkingCache, loading, error } =
    useDidacticAnalysis({ repo: pr.repo, number: pr.number })
  const status: AiChipStatus = error
    ? 'failed'
    : analysis
      ? 'ready'
      : loading || streamingSections
        ? phase === 'writing'
          ? 'writing'
          : 'exploring'
        : checkingCache
          ? 'checking'
          : 'idle'
  return <ChipView status={status} compact={compact} />
}

function ChipView({
  status,
  compact,
}: {
  status: AiChipStatus | null
  compact: boolean
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const openSettings = useAppStore((s) => s.openSettings)
  const { info } = useSettings()
  if (!info) return null

  const modelLabel = modelDisplayLabel(info.catalog, info.provider, info.model)
  const { providerLabel, effortLabel } = resolveModelHintLabels(
    info.catalog,
    info.provider,
    info.model,
    info.selectedOptions?.[info.provider]?.effort,
  )
  const source = t(`layout.aiChip.modelSource.${info.modelSource}`)
  const config = effortLabel
    ? t('layout.aiChip.titleWithEffort', {
        provider: providerLabel,
        model: info.model,
        effort: effortLabel,
        source,
      })
    : t('layout.aiChip.title', { provider: providerLabel, model: info.model, source })
  const statusText =
    status && status !== 'checking' ? t(`layout.aiChip.status.${status}`) : null
  const label = statusText ? config + '\n' + t('layout.aiChip.analysis', { status: statusText }) : config
  const busy = status === 'exploring' || status === 'writing'

  return (
    <button
      type="button"
      onClick={() => openSettings('ai-model')}
      title={label}
      aria-label={label}
      data-testid="ai-status-chip"
      data-ai-status={status ?? 'none'}
      className="flex h-8 shrink-0 items-center gap-2 rounded-full border border-border px-2.5 text-xs text-text transition-colors duration-150 hover:border-accent"
    >
      <Sparkles size={14} className="shrink-0 text-accent" aria-hidden />
      {!compact && <span className="max-w-[160px] truncate font-semibold">{modelLabel}</span>}
      {status &&
        (busy ? (
          <Spinner size={12} />
        ) : (
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[status]}`} aria-hidden />
        ))}
      {!compact && statusText && <span className="whitespace-nowrap text-muted">{statusText}</span>}
    </button>
  )
}
