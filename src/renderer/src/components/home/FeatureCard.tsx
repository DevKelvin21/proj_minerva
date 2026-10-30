import { Tag } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { FeatureGroup } from '../../lib/dashboard'
import { Badge } from '../ui/Badge'
import { ScmProviderIcon } from '../ui/ScmProviderIcon'
import { useCardFilter } from '../../hooks/use-card-filter'
import { ActionCard, CardOpenButton } from '../ui/SelectableCard'

/** "x of n approved" as a thin bar (theme tokens only). */
export function ApprovalBar({
  approved,
  total,
  label,
}: {
  approved: number
  total: number
  label: string
}): React.JSX.Element {
  const percent = total === 0 ? 0 : Math.round((approved / total) * 100)
  return (
    <span
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={approved}
      className="block h-1.5 w-full overflow-hidden rounded-full bg-border/60"
    >
      <span className="block h-full rounded-full bg-success" style={{ width: percent + '%' }} />
    </span>
  )
}

/**
 * One cross-repo feature (a tag shared by PRs in several repos): its name
 * (custom or the tag), its tag chip, the repos involved, the PR count and
 * the approval progress. The name opens the feature page (so does a click
 * anywhere else on the card); the tag chip is its own button, which adds
 * "Tag: <tag>" to the Home filter bar.
 */
export function FeatureCard({
  group,
  onOpen,
}: {
  group: FeatureGroup
  onOpen: (featureKey: string) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const { byTag } = useCardFilter()
  return (
    <ActionCard
      data-testid="feature-card"
      data-feature-key={group.key}
      onOpen={() => onOpen(group.key)}
      padding="md"
    >
      <span className="flex min-w-0 items-start gap-2">
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <CardOpenButton className="truncate text-sm font-semibold text-text" title={group.name}>
            {group.name}
          </CardOpenButton>
          <button
            type="button"
            data-filter-tag={group.tag}
            onClick={() => byTag(group.tag)}
            title={t('home.cardFilter.tagged', { tag: group.tag })}
            className="group inline-flex min-w-0 max-w-full self-start rounded-full"
          >
            <Badge
              tone="outline"
              size="sm"
              className="min-w-0 max-w-full group-hover:text-text group-hover:ring-accent/60"
              icon={<Tag size={10} aria-hidden />}
            >
              <span className="min-w-0 truncate">{group.tag}</span>
            </Badge>
          </button>
        </span>
        {group.needsMyReview > 0 && (
          <Badge tone="warning" size="sm">
            {t('home.featureCard.needsReview', { count: group.needsMyReview })}
          </Badge>
        )}
      </span>
      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted">
        <span className="inline-flex min-w-0 items-center gap-1">
          {group.repos.map((featureRepo) => (
            <span
              key={featureRepo.key}
              className="inline-flex min-w-0 items-center gap-0.5"
              title={featureRepo.repo.fullName}
            >
              <ScmProviderIcon provider={featureRepo.repo.provider} size={10} />
              <span className="max-w-[7rem] truncate">{featureRepo.repo.name}</span>
            </span>
          ))}
        </span>
        <span className="ml-auto shrink-0">
          {t('home.featureCard.repos', { count: group.repos.length })} ·{' '}
          {t('home.featureCard.prs', { count: group.prCount })}
        </span>
      </span>
      <span className="flex flex-col gap-1">
        <ApprovalBar
          approved={group.approved}
          total={group.prCount}
          label={t('home.featureCard.progressAriaLabel')}
        />
        <span className="text-[10px] text-muted">
          {t('home.featureCard.approved', { approved: group.approved, total: group.prCount })}
        </span>
      </span>
    </ActionCard>
  )
}
