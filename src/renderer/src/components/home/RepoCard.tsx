import { Layers, TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { repoOwnerLabel, type RepoSummary } from '../../lib/dashboard'
import { Badge } from '../ui/Badge'
import { ScmProviderIcon } from '../ui/ScmProviderIcon'
import { SelectableCard } from '../ui/SelectableCard'

function CountBadge({
  value,
  label,
  title,
  tone,
}: {
  value: number
  label: string
  title: string
  tone: 'accent' | 'warning' | 'neutral'
}): React.JSX.Element | null {
  if (value === 0) return null
  return (
    <Badge tone={tone} size="sm" title={title}>
      {label}
    </Badge>
  )
}

/**
 * One repository as a card: provider, name, where it lives, and the counts
 * that decide whether to open it (to review, optional, yours, stacks,
 * orphans), with an unread dot. The whole card is a button.
 */
export function RepoCard({
  summary,
  onOpen,
}: {
  summary: RepoSummary
  onOpen: (repoKey: string) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const { repo } = summary
  return (
    <SelectableCard
      data-testid="repo-card"
      data-repo-key={summary.key}
      onClick={() => onOpen(summary.key)}
      padding="md"
    >
      <span className="flex min-w-0 items-start gap-2">
        <span className="mt-0.5 text-muted">
          <ScmProviderIcon provider={repo.provider} size={14} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-semibold text-text" title={repo.fullName}>
            {repo.name}
          </span>
          <span className="truncate text-[11px] text-muted" title={repoOwnerLabel(repo)}>
            {repoOwnerLabel(repo)}
          </span>
        </span>
        {summary.unread > 0 && (
          <span
            className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-danger"
            role="img"
            aria-label={t('home.repoCard.unread')}
            title={t('home.repoCard.unread')}
          />
        )}
      </span>
      <span className="flex min-w-0 flex-wrap items-center gap-1">
        {summary.open === 0 ? (
          <span className="text-[11px] text-muted">{t('home.repoCard.noOpen')}</span>
        ) : (
          <span className="text-[11px] text-muted">
            {t('home.repoCard.openCount', { count: summary.open })}
          </span>
        )}
        <CountBadge
          value={summary.needsMyReview}
          label={t('home.repoCard.needsReview', { count: summary.needsMyReview })}
          title={t('home.repoCard.needsReviewTitle')}
          tone="warning"
        />
        <CountBadge
          value={summary.optional}
          label={t('home.repoCard.optional', { count: summary.optional })}
          title={t('home.repoCard.optionalTitle')}
          tone="neutral"
        />
        <CountBadge
          value={summary.mine}
          label={t('home.repoCard.mine', { count: summary.mine })}
          title={t('home.repoCard.mineTitle')}
          tone="accent"
        />
      </span>
      {(summary.stacks > 0 || summary.orphans > 0) && (
        <span className="flex min-w-0 flex-wrap items-center gap-2 text-[11px] text-muted">
          {summary.stacks > 0 && (
            <span className="inline-flex items-center gap-1" title={t('home.repoCard.stacksTitle')}>
              <Layers size={11} className="text-accent" aria-hidden />
              {t('home.repoCard.stacks', { count: summary.stacks })}
            </span>
          )}
          {summary.orphans > 0 && (
            <span
              className="inline-flex items-center gap-1 text-warning"
              title={t('home.repoCard.orphansTitle')}
            >
              <TriangleAlert size={11} aria-hidden />
              {t('home.repoCard.orphans', { count: summary.orphans })}
            </span>
          )}
        </span>
      )}
    </SelectableCard>
  )
}
