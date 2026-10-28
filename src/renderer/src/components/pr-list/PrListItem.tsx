import {
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  MessageSquare,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { PullRequestState, PullRequestSummary, ReviewDecision } from '../../../../shared/types'
import { useAppStore } from '../../stores/app-store'
import { Avatar } from '../ui/Avatar'
import { Badge } from '../ui/Badge'
import { CiStatusIcon } from '../ui/CiStatusIcon'
import { ScmProviderIcon } from '../ui/ScmProviderIcon'
import { prKey } from '../../../../shared/scm'
import { reviewDecisionLabelKey } from '../../lib/scm-labels'

interface PrListItemProps {
  pr: PullRequestSummary
  /** Selección (T52, F10): además de marcar el item activo, sella "visto" (`markSeen`). */
  onSelect: (pr: PullRequestSummary) => void
  /** Rows outside a repo group (the Queue view) name their repo (and drop the +/- counts). */
  showRepo?: boolean
  /** One short status on the right (the Queue view's "Required", "Approved"…); replaces +/-. */
  badge?: ReactNode
}

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

/** Icono de estado (T52, F10): coherente con el tono del badge (merge morado, closed atenuado). */
function StateIcon({
  state,
  isDraft,
}: {
  state: PullRequestState
  isDraft: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  if (isDraft) {
    return (
      <GitPullRequestDraft
        size={14}
        className="mt-0.5 shrink-0 text-muted"
        aria-label={t('prList.state.draft')}
      />
    )
  }
  if (state === 'merged') {
    return (
      <GitMerge
        size={14}
        className="mt-0.5 shrink-0 text-merged"
        aria-label={t('prList.state.merged')}
      />
    )
  }
  if (state === 'closed') {
    return (
      <GitPullRequestClosed
        size={14}
        className="mt-0.5 shrink-0 text-muted"
        aria-label={t('prList.state.closed')}
      />
    )
  }
  return (
    <GitPullRequest
      size={14}
      className="mt-0.5 shrink-0 text-accent"
      aria-label={t('prList.state.open')}
    />
  )
}

/** Chip pequeño de estado (T52, F10): solo para PRs no abiertos (closed incluye merged, con badges distintos). */
function StateBadge({ state }: { state: PullRequestState }): React.JSX.Element | null {
  const { t } = useTranslation()
  if (state === 'merged') {
    return (
      <Badge tone="merged" size="sm">
        {t('prList.state.mergedBadge')}
      </Badge>
    )
  }
  if (state === 'closed') {
    return (
      <Badge tone="danger" size="sm">
        {t('prList.state.closedBadge')}
      </Badge>
    )
  }
  return null
}

export function PrListItem({
  pr,
  onSelect,
  showRepo = false,
  badge,
}: PrListItemProps): React.JSX.Element {
  const { t } = useTranslation()
  const selectedPrKey = useAppStore((s) =>
    s.selectedPr ? prKey(s.selectedPr.repo, s.selectedPr.number) : null,
  )
  const isSelected = selectedPrKey === prKey(pr.repo, pr.number)

  // Tratar `unread` ausente (main viejo / summary sin decorar) como "ya
  // visto": sin dot, título en el tono atenuado normal.
  const isUnseen = Boolean(pr.unread && (pr.unread.isNew || pr.unread.hasUpdates))
  const hasNewComments = Boolean(pr.unread?.hasNewComments)

  return (
    <button
      type="button"
      onClick={() => onSelect(pr)}
      aria-pressed={isSelected}
      className={`flex w-full flex-col gap-1.5 border-l-2 px-3 py-2 text-left transition-colors duration-150 ${
        isSelected ? 'border-accent bg-accent/10' : 'border-transparent hover:bg-bg/60'
      }`}
    >
      <div className="flex items-start gap-1.5">
        <StateIcon state={pr.state} isDraft={pr.isDraft} />
        {isUnseen && (
          <span
            className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-danger"
            aria-hidden
            title={t('prList.unseenChanges')}
          />
        )}
        <span
          className={`line-clamp-2 text-sm leading-snug ${
            isUnseen ? 'font-medium text-text' : 'text-text/70'
          }`}
        >
          {pr.title}
        </span>
      </div>
      <div className="flex items-center gap-2 pl-[20px] text-xs text-muted">
        <Avatar user={pr.author} size={16} />
        {showRepo && (
          <span className="flex min-w-0 items-center gap-1" title={pr.repo.fullName}>
            <ScmProviderIcon provider={pr.repo.provider} size={11} />
            <span className="max-w-[110px] truncate">
              {pr.repo.fullName.slice(pr.repo.fullName.lastIndexOf('/') + 1)}
            </span>
          </span>
        )}
        <span>#{pr.number}</span>
        <StateBadge state={pr.state} />
        <CiStatusIcon status={pr.ciStatus} size={12} />
        {pr.reviewDecision && (
          <span
            data-review={pr.reviewDecision}
            className={`h-1.5 w-1.5 rounded-full ${reviewDecisionTone(pr.reviewDecision)}`}
            title={t(reviewDecisionLabelKey(pr.reviewDecision, pr.repo.provider))}
          />
        )}
        {pr.commentCount !== null && pr.commentCount > 0 && (
          <span
            className="relative flex items-center gap-0.5"
            title={t('prList.comments', { count: pr.commentCount })}
          >
            <MessageSquare size={12} aria-hidden />
            <span>{pr.commentCount}</span>
            {hasNewComments && (
              <span
                className="absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full bg-danger"
                aria-hidden
                title={t('prList.newComments')}
              />
            )}
          </span>
        )}
        {badge ? (
          <span className="ml-auto shrink-0">{badge}</span>
        ) : (
          // Queue rows name their repo instead: the +/- would crowd it out.
          !showRepo &&
          pr.additions !== null &&
          pr.deletions !== null && (
            <span className="ml-auto flex items-center gap-1.5 font-mono text-[11px]">
              <span className="text-success">+{pr.additions}</span>
              <span className="text-danger">-{pr.deletions}</span>
            </span>
          )
        )}
      </div>
    </button>
  )
}
