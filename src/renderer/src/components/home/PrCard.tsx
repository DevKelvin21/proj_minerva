import { GitPullRequest, MessageSquare } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { prKey } from '../../../../shared/scm'
import type { PrLabel, PullRequestSummary, ReviewDecision } from '../../../../shared/types'
import { useCardFilter } from '../../hooks/use-card-filter'
import { isUnread, needsMyReview, type ViewerIdentity } from '../../lib/dashboard'
import { personLabel } from '../../lib/home-filter'
import { labelStyle } from '../../lib/label-colors'
import { reviewDecisionLabelKey } from '../../lib/scm-labels'
import { Avatar } from '../ui/Avatar'
import { Badge, type BadgeTone } from '../ui/Badge'
import { CiStatusIcon } from '../ui/CiStatusIcon'
import { Spinner } from '../ui/Spinner'
import { DiffStat } from '../ui/DiffStat'
import { ActionCard, CardOpenButton } from '../ui/SelectableCard'
import { OrphanBadge } from '../stacks/StackTree'

const MAX_LABELS = 3

function reviewDecisionTone(decision: ReviewDecision): string {
  switch (decision) {
    case 'approved':
      return 'bg-success'
    case 'changes_requested':
    case 'rejected':
      return 'bg-danger'
    case 'review_required':
      return 'bg-warning'
    default:
      return ''
  }
}

/**
 * The PR glyph before the number. Decorative: a draft says so once, with its
 * badge, so the icon only turns muted (same shape).
 */
export function PrStateIcon({ isDraft }: { isDraft: boolean }): React.JSX.Element {
  return (
    <GitPullRequest
      size={14}
      aria-hidden
      className={`shrink-0 ${isDraft ? 'text-muted' : 'text-success'}`}
    />
  )
}

type RoleKey = 'toReview' | 'required' | 'optional' | 'mine'

/**
 * The viewer's role, in the filter's words: "To review" (a required review
 * still owed, in warning), "Required" (already voted), "Optional", "Yours".
 */
export function RoleBadges({
  pr,
  identity,
}: {
  pr: PullRequestSummary
  identity: ViewerIdentity
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const viewer = pr.viewer
  if (!viewer) return null
  const chips: { key: RoleKey; role: 'required' | 'optional' | 'mine'; tone: BadgeTone }[] = []
  if (viewer.reviewer === 'required') {
    chips.push(
      needsMyReview(pr, identity)
        ? { key: 'toReview', role: 'required', tone: 'warning' }
        : { key: 'required', role: 'required', tone: 'neutral' },
    )
  } else if (viewer.reviewer === 'optional') {
    chips.push({ key: 'optional', role: 'optional', tone: 'neutral' })
  }
  if (viewer.isAuthor) {
    chips.push({ key: 'mine', role: 'mine', tone: 'neutral' })
  }
  if (chips.length === 0) return null
  return (
    <>
      {chips.map((chip) => (
        <Badge key={chip.key} data-role={chip.role} tone={chip.tone} size="sm">
          {t(`home.prCard.role.${chip.key}`)}
        </Badge>
      ))}
    </>
  )
}

/**
 * A tag on a Home card as a button: one click adds "Tag: <name>" to the Home
 * filter. Same pill as a static tag, with a hover ring.
 */
export function TagFilterButton({
  label,
  onFilter,
  className = '',
}: {
  label: PrLabel
  onFilter: (tag: string) => void
  className?: string
}): React.JSX.Element {
  const { t } = useTranslation()
  const dot = labelStyle(label.color)
  return (
    <button
      type="button"
      data-filter-tag={label.name}
      onClick={() => onFilter(label.name)}
      title={t('home.cardFilter.tagged', { tag: label.name })}
      className={`group inline-flex min-w-0 max-w-[9rem] rounded-full ${className}`}
    >
      <Badge
        tone="outline"
        size="sm"
        className="min-w-0 max-w-full group-hover:text-text group-hover:ring-accent/60"
        icon={
          dot ? (
            <span
              aria-hidden
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: dot.backgroundColor }}
            />
          ) : undefined
        }
      >
        <span className="min-w-0 truncate">{label.name}</span>
      </Badge>
    </button>
  )
}

interface PrCardProps {
  pr: PullRequestSummary
  identity: ViewerIdentity
  onOpen: (pr: PullRequestSummary) => void
  /** Does not match the active filter: still visible (the stack keeps its shape), but faded. */
  dimmed?: boolean
  /** Being fetched before it can open. */
  pending?: boolean
  /** Stack root that still targets a completed PR's branch: the badge (the stack carries the border). */
  orphan?: boolean
  testId?: string
}

/**
 * One pull request as a card (stack board, repo page list, feature page).
 * Dense: number + title, author + CI + review state + size, then the
 * viewer's role, the orphan flag and the first tags. The title is the
 * card's button (a click anywhere else on the card opens it too); the
 * author and the tags are their own buttons, which add that filter to the
 * Home filter bar. The full title lives in `title`.
 */
export function PrCard({
  pr,
  identity,
  onOpen,
  dimmed = false,
  pending = false,
  orphan = false,
  testId = 'pr-card',
}: PrCardProps): React.JSX.Element {
  const { t } = useTranslation()
  const { byAuthor, byTag } = useCardFilter()
  const unread = isUnread(pr)
  const labels = pr.labels ?? []
  const shownLabels = labels.slice(0, MAX_LABELS)
  const hiddenLabels = labels.length - shownLabels.length
  const authorName = personLabel(pr.author)

  return (
    <ActionCard
      data-testid={testId}
      data-pr-key={prKey(pr.repo, pr.number)}
      data-dimmed={dimmed || undefined}
      onOpen={() => onOpen(pr)}
      busy={pending}
      title={'#' + pr.number + ' ' + pr.title}
      className={dimmed ? 'opacity-45 hover:opacity-100 focus-within:opacity-100' : ''}
    >
      <CardOpenButton disabled={pending} className="flex items-start gap-1.5">
        {pending ? (
          <Spinner size={14} className="mt-0.5" />
        ) : (
          <span className="mt-0.5">
            <PrStateIcon isDraft={pr.isDraft} />
          </span>
        )}
        <span className="shrink-0 font-mono text-xs text-muted">#{pr.number}</span>
        <span
          className={`line-clamp-2 min-w-0 flex-1 text-sm leading-snug ${
            unread ? 'font-medium text-text' : 'text-text/80'
          }`}
        >
          {pr.title}
        </span>
        {unread && (
          <span
            className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-danger"
            role="img"
            aria-label={t('home.prCard.unread')}
            title={t('home.prCard.unread')}
          />
        )}
      </CardOpenButton>
      <span className="flex min-w-0 items-center gap-2 text-[11px] text-muted">
        <button
          type="button"
          data-filter-author
          onClick={() => byAuthor(pr)}
          title={t('home.cardFilter.byAuthor', { name: authorName })}
          className="inline-flex min-w-0 items-center gap-1.5 rounded decoration-border underline-offset-2 hover:text-text hover:underline hover:decoration-dotted"
        >
          <Avatar user={pr.author} size={14} />
          <span className="min-w-0 truncate">{authorName}</span>
        </button>
        <CiStatusIcon status={pr.ciStatus} size={12} />
        {pr.reviewDecision && (
          <span
            data-review={pr.reviewDecision}
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${reviewDecisionTone(pr.reviewDecision)}`}
            title={t(reviewDecisionLabelKey(pr.reviewDecision, pr.repo.provider))}
          />
        )}
        {pr.commentCount !== null && pr.commentCount > 0 && (
          <span
            className="flex shrink-0 items-center gap-0.5"
            title={t('prList.comments', { count: pr.commentCount })}
          >
            <MessageSquare size={11} aria-hidden />
            {pr.commentCount}
          </span>
        )}
        {pr.additions !== null && pr.deletions !== null && (
          <DiffStat additions={pr.additions} deletions={pr.deletions} size="xs" className="ml-auto" />
        )}
      </span>
      {(pr.viewer || orphan || pr.isDraft || shownLabels.length > 0) && (
        <span className="flex min-w-0 flex-wrap items-center gap-1">
          <RoleBadges pr={pr} identity={identity} />
          {pr.isDraft && (
            <Badge tone="outline" size="sm">
              {t('home.prCard.draft')}
            </Badge>
          )}
          {orphan && <OrphanBadge />}
          {shownLabels.map((label) => (
            <TagFilterButton key={label.name} label={label} onFilter={byTag} />
          ))}
          {hiddenLabels > 0 && (
            <span
              className="text-[10px] text-muted"
              title={labels.slice(MAX_LABELS).map((label) => label.name).join(', ')}
            >
              {t('home.prCard.moreLabels', { count: hiddenLabels })}
            </span>
          )}
        </span>
      )}
    </ActionCard>
  )
}
