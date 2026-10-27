import { CircleCheck, TriangleAlert, X } from 'lucide-react'
import { prKey } from '../../../../shared/scm'
import type { PullRequestSummary } from '../../../../shared/types'
import { useStacksStore } from '../../stores/stacks-store'

interface RetargetNoteProps {
  /** Only show the note when it is about this PR (`prKey`). */
  onlyFor?: string
  /** Hide it when it is about this PR (the open PR's header already shows it). */
  except?: string | null
  /** Makes the PR number a link (Stacks view: the PR may have left the stacks). */
  onOpenPr?: (pr: PullRequestSummary) => void
  className?: string
}

/**
 * The outcome of the last retarget, kept until dismissed: where the PR went
 * (and that its diff changed), or why it could not be retargeted because the
 * data on screen was stale (`CONFLICT`; the data was refreshed).
 */
export function RetargetNote({
  onlyFor,
  except,
  onOpenPr,
  className = '',
}: RetargetNoteProps): React.JSX.Element | null {
  const note = useStacksStore((s) => s.lastRetarget)
  const dismiss = useStacksStore((s) => s.dismissRetargetNote)
  if (!note) return null
  const key = note.kind === 'retargeted' ? prKey(note.pr.repo, note.pr.number) : note.prKey
  if (onlyFor !== undefined && key !== onlyFor) return null
  if (except && key === except) return null

  const dismissButton = (
    <button
      type="button"
      onClick={dismiss}
      aria-label="Dismiss"
      className="shrink-0 text-muted hover:text-text"
    >
      <X size={12} />
    </button>
  )

  if (note.kind === 'conflict') {
    return (
      <div
        role="alert"
        data-error-code="CONFLICT"
        className={'flex min-w-0 items-start gap-1.5 text-xs ' + className}
      >
        <TriangleAlert size={13} className="mt-0.5 shrink-0 text-warning" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-warning">Could not retarget #{note.number}.</p>
          <p className="text-text/80">{note.failure.explanation}</p>
          {note.failure.detail && <p className="break-words text-muted">{note.failure.detail}</p>}
        </div>
        {dismissButton}
      </div>
    )
  }

  const { pr, oldBase } = note
  return (
    <div
      role="status"
      className={'flex min-w-0 items-start gap-1.5 text-xs text-text/90 ' + className}
    >
      <CircleCheck size={13} className="mt-0.5 shrink-0 text-success" aria-hidden />
      <p className="min-w-0 flex-1">
        {onOpenPr ? (
          <button
            type="button"
            onClick={() => onOpenPr(pr)}
            className="font-medium underline decoration-dotted hover:text-text"
          >
            #{pr.number}
          </button>
        ) : (
          <span className="font-medium">#{pr.number}</span>
        )}{' '}
        now targets <span className="font-mono">{pr.baseRef}</span> (was{' '}
        <span className="font-mono">{oldBase}</span>). Its diff is now against{' '}
        <span className="font-mono">{pr.baseRef}</span>.
      </p>
      {dismissButton}
    </div>
  )
}
