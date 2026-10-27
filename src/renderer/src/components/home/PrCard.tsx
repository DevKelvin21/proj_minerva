import { LoaderCircle, MessageSquare } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { prKey } from '../../../../shared/scm'
import type { PullRequestSummary, ReviewDecision } from '../../../../shared/types'
import { isUnread, needsMyReview, type ViewerIdentity } from '../../lib/dashboard'
import { labelStyle } from '../../lib/label-colors'
import { reviewDecisionLabelKey } from '../../lib/scm-labels'
import { Avatar } from '../ui/Avatar'
import { CiStatusIcon } from '../ui/CiStatusIcon'
import { OrphanBadge, StackStateIcon } from '../stacks/StackTree'

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

/** "Required reviewer" / "Optional reviewer" / "Yours" chips from the viewer relation. */
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
  const chips: { key: 'required' | 'optional' | 'mine'; className: string }[] = []
  if (viewer.reviewer === 'required') {
    chips.push({
      key: 'required',
      className: needsMyReview(pr, identity)
        ? 'border-warning/50 bg-warning/10 text-warning'
        : 'border-border text-muted',
    })
  } else if (viewer.reviewer === 'optional') {
    chips.push({ key: 'optional', className: 'border-border text-muted' })
  }
  if (viewer.isAuthor) {
    chips.push({ key: 'mine', className: 'border-accent/40 bg-accent/10 text-accent' })
  }
  if (chips.length === 0) return null
  return (
    <>
      {chips.map((chip) => (
        <span
          key={chip.key}
          data-role={chip.key}
          className={`inline-flex shrink-0 items-center rounded border px-1 text-[10px] font-medium ${chip.className}`}
        >
          {t(`home.prCard.role.${chip.key}`)}
        </span>
      ))}
    </>
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
  /** Stack root that still targets a completed PR's branch. */
  orphan?: boolean
  testId?: string
}

/**
 * One pull request as a card (stack board, repo page list, feature page).
 * Dense: number + title, author + CI + review state + size, then the
 * viewer's role, the orphan flag and the first tags. The whole card is one
 * button (keyboard reachable); the full title lives in `title`.
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
  const unread = isUnread(pr)
  const labels = pr.labels ?? []
  const shownLabels = labels.slice(0, MAX_LABELS)
  const hiddenLabels = labels.length - shownLabels.length
  const authorName = pr.author.displayName ?? pr.author.login

  return (
    <button
      type="button"
      data-testid={testId}
      data-pr-key={prKey(pr.repo, pr.number)}
      data-dimmed={dimmed || undefined}
      onClick={() => onOpen(pr)}
      disabled={pending}
      title={'#' + pr.number + ' ' + pr.title}
      className={`flex w-full min-w-0 flex-col gap-1.5 rounded-md border bg-panel p-2.5 text-left transition-colors duration-150 hover:border-accent focus-visible:border-accent focus-visible:outline-none disabled:cursor-wait ${
        orphan ? 'border-warning/50' : 'border-border'
      } ${dimmed ? 'opacity-45 hover:opacity-100' : ''}`}
    >
      <span className="flex min-w-0 items-start gap-1.5">
        {pending ? (
          <LoaderCircle size={14} className="mt-0.5 shrink-0 animate-spin text-muted" aria-hidden />
        ) : (
          <span className="mt-0.5">
            <StackStateIcon isDraft={pr.isDraft} />
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
      </span>
      <span className="flex min-w-0 items-center gap-2 text-[11px] text-muted">
        <Avatar user={pr.author} size={14} />
        <span className="min-w-0 truncate" title={authorName}>
          {authorName}
        </span>
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
          <span className="ml-auto flex shrink-0 items-center gap-1 font-mono text-[10px]">
            <span className="text-success">+{pr.additions}</span>
            <span className="text-danger">-{pr.deletions}</span>
          </span>
        )}
      </span>
      {(pr.viewer || orphan || pr.isDraft || shownLabels.length > 0) && (
        <span className="flex min-w-0 flex-wrap items-center gap-1">
          <RoleBadges pr={pr} identity={identity} />
          {pr.isDraft && (
            <span className="inline-flex shrink-0 items-center rounded border border-border px-1 text-[10px] text-muted">
              {t('home.prCard.draft')}
            </span>
          )}
          {orphan && <OrphanBadge />}
          {shownLabels.map((label) => {
            const style = labelStyle(label.color)
            return (
              <span
                key={label.name}
                className={`inline-flex max-w-[9rem] truncate rounded-full px-1.5 text-[10px] font-medium ${
                  style ? '' : 'bg-border/60 text-muted'
                }`}
                style={style ?? undefined}
                title={label.name}
              >
                {label.name}
              </span>
            )
          })}
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
    </button>
  )
}
