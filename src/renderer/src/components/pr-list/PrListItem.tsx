import {
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  MessageSquare,
} from 'lucide-react'
import type {
  PullRequestState,
  PullRequestSummary,
  ReviewDecision,
} from '../../../../shared/types'
import { useAppStore } from '../../stores/app-store'
import { Avatar } from '../ui/Avatar'
import { CiStatusIcon } from '../ui/CiStatusIcon'
import { prKey } from '../../../../shared/scm'

interface PrListItemProps {
  pr: PullRequestSummary
  /** Selección (T52, F10): además de marcar el item activo, sella "visto" (`markSeen`). */
  onSelect: (pr: PullRequestSummary) => void
}

function reviewDecisionTone(decision: ReviewDecision): string {
  switch (decision) {
    case 'approved':
      return 'bg-success'
    case 'changes_requested':
      return 'bg-danger'
    case 'review_required':
      return 'bg-warning'
    default:
      return ''
  }
}

function reviewDecisionLabel(decision: ReviewDecision): string {
  switch (decision) {
    case 'approved':
      return 'Aprobado'
    case 'changes_requested':
      return 'Cambios solicitados'
    case 'review_required':
      return 'Revisión pendiente'
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
  if (isDraft) {
    return <GitPullRequestDraft size={14} className="mt-0.5 shrink-0 text-muted" aria-label="Draft" />
  }
  if (state === 'merged') {
    return <GitMerge size={14} className="mt-0.5 shrink-0 text-purple-400" aria-label="Mergeado" />
  }
  if (state === 'closed') {
    return <GitPullRequestClosed size={14} className="mt-0.5 shrink-0 text-muted" aria-label="Cerrado" />
  }
  return <GitPullRequest size={14} className="mt-0.5 shrink-0 text-accent" aria-label="Abierto" />
}

/** Chip pequeño de estado (T52, F10): solo para PRs no abiertos (closed incluye merged, con badges distintos). */
function StateBadge({ state }: { state: PullRequestState }): React.JSX.Element | null {
  if (state === 'merged') {
    return (
      <span className="rounded border border-purple-400/40 px-1 text-[10px] text-purple-400">
        merged
      </span>
    )
  }
  if (state === 'closed') {
    return (
      <span className="rounded border border-danger/40 px-1 text-[10px] text-danger/80">
        closed
      </span>
    )
  }
  return null
}

export function PrListItem({ pr, onSelect }: PrListItemProps): React.JSX.Element {
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
            title="Cambios sin ver"
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
        <span>#{pr.number}</span>
        <StateBadge state={pr.state} />
        <CiStatusIcon status={pr.ciStatus} size={12} />
        {pr.reviewDecision && (
          <span
            className={`h-1.5 w-1.5 rounded-full ${reviewDecisionTone(pr.reviewDecision)}`}
            title={reviewDecisionLabel(pr.reviewDecision)}
          />
        )}
        {pr.commentCount !== null && pr.commentCount > 0 && (
          <span className="relative flex items-center gap-0.5">
            <MessageSquare size={12} aria-hidden />
            <span>{pr.commentCount}</span>
            {hasNewComments && (
              <span
                className="absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full bg-danger"
                aria-hidden
                title="Comentarios nuevos"
              />
            )}
          </span>
        )}
        {pr.additions !== null && pr.deletions !== null && (
          <span className="ml-auto flex items-center gap-1.5 font-mono text-[11px]">
            <span className="text-success">+{pr.additions}</span>
            <span className="text-danger">-{pr.deletions}</span>
          </span>
        )}
      </div>
    </button>
  )
}
