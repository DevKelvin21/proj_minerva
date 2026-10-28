import { Tag } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { FeatureGroup } from '../../lib/dashboard'
import { Badge } from '../ui/Badge'
import { ScmProviderIcon } from '../ui/ScmProviderIcon'

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
 * (custom or the tag), the tag chip when renamed, the repos involved, the
 * PR count and the approval progress. The whole card is a button.
 */
export function FeatureCard({
  group,
  onOpen,
}: {
  group: FeatureGroup
  onOpen: (featureKey: string) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      data-testid="feature-card"
      data-feature-key={group.key}
      onClick={() => onOpen(group.key)}
      className="flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-panel p-3 text-left transition-colors duration-150 hover:border-accent focus-visible:border-accent focus-visible:outline-none"
    >
      <span className="flex min-w-0 items-start gap-2">
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-sm font-semibold text-text" title={group.name}>
            {group.name}
          </span>
          <Badge
            size="sm"
            className="max-w-full self-start"
            icon={<Tag size={10} aria-hidden />}
            title={
              group.renamed
                ? t('home.featureCard.renamedTitle', { tag: group.tag })
                : t('home.featureCard.tag')
            }
          >
            <span className="truncate">{group.tag}</span>
          </Badge>
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
    </button>
  )
}
