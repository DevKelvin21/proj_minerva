import { useState } from 'react'
import { ArrowRight, LoaderCircle } from 'lucide-react'
import type { RepoRef } from '../../../../shared/scm'
import { useRetarget } from '../../hooks/use-retarget'
import { validateBranchName } from '../../lib/retarget'

/**
 * - `orphan`: one-click fix to the suggested base (the completed parent's own
 *   target). Shows the consequence first, then asks main to retarget.
 * - `manual`: free-text "Change target branch…", prefilled with the current
 *   base and validated as a branch name.
 */
export type RetargetMode =
  { kind: 'orphan'; suggestedBase: string; parentNumber: number } | { kind: 'manual' }

interface RetargetPanelProps {
  repo: RepoRef
  number: number
  /** The base the UI shows now; sent as `expectedCurrentBase` (main refuses if it moved). */
  currentBase: string
  /** The PR's own source branch: it can never be its target. */
  headRef: string
  mode: RetargetMode
  /** Manual mode: called when the user closes the form (Cancel, or after `cancelled`). */
  onClose?: () => void
  /** Called after main confirmed the retarget (before the refreshed data arrives). */
  onRetargeted?: () => void
}

const buttonBase =
  'rounded-md px-2.5 py-1 text-xs font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50'
const primaryButton =
  buttonBase + ' border border-warning/50 bg-warning/15 text-warning hover:bg-warning/25'
const accentButton =
  buttonBase + ' border border-accent/50 bg-accent/15 text-accent hover:bg-accent/25'
const ghostButton =
  buttonBase + ' border border-border text-muted hover:border-accent hover:text-text'

/** `old → new`, monospace, wraps on narrow panels instead of overflowing. */
function BaseChange({ from, to }: { from: string; to: string }): React.JSX.Element {
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-1 font-mono text-[11px]">
      <span className="break-all text-muted line-through decoration-muted/60">{from}</span>
      <ArrowRight size={11} className="shrink-0 text-muted" aria-hidden />
      <span className="break-all text-text">{to}</span>
    </span>
  )
}

/** What will happen, said before anything is written. */
function Consequence({
  from,
  to,
  parentNumber,
}: {
  from: string
  to: string
  parentNumber?: number
}): React.JSX.Element {
  return (
    <div className="flex min-w-0 flex-col gap-1 text-xs text-muted">
      <p className="flex min-w-0 flex-wrap items-center gap-1">
        <span>Target branch:</span>
        <BaseChange from={from} to={to} />
      </p>
      <p>
        The diff will be recomputed against <span className="font-mono text-text">{to}</span>
        {parentNumber !== undefined
          ? ', so the changes that already landed through #' +
            parentNumber +
            ' drop out and only this PR’s own work is left.'
          : '. Files and line comments may shift.'}{' '}
        Minerva asks you to confirm before writing.
      </p>
    </div>
  )
}

/**
 * Change a PR's target branch, with the consequence spelled out first. The
 * write and its confirmation dialog live in main (`scm:retarget`); this panel
 * shows the state of that request. After a success the parent re-renders from
 * the refreshed data (and the note in `stacks-store`), so this panel only
 * needs to say "done" briefly.
 */
export function RetargetPanel({
  repo,
  number,
  currentBase,
  headRef,
  mode,
  onClose,
  onRetargeted,
}: RetargetPanelProps): React.JSX.Element {
  const { state, retarget, reset } = useRetarget(repo, number)
  const [previewing, setPreviewing] = useState(mode.kind === 'manual')
  const [draft, setDraft] = useState(currentBase)

  const target =
    mode.kind === 'orphan'
      ? ({ ok: true, branch: mode.suggestedBase } as const)
      : validateBranchName(draft)
  const sameAsCurrent = target.ok && target.branch === currentBase
  const isOwnHead = target.ok && target.branch === headRef
  const canSubmit = target.ok && !sameAsCurrent && !isOwnHead && state.phase !== 'pending'

  const close = (): void => {
    reset()
    setPreviewing(mode.kind === 'manual')
    if (mode.kind === 'manual') onClose?.()
  }

  const submit = async (): Promise<void> => {
    if (!target.ok || !canSubmit) return
    const outcome = await retarget(currentBase, target.branch)
    // Declined, or stale (the note explains): back to where the user started.
    if ((outcome === 'cancelled' || outcome === 'conflict') && mode.kind === 'orphan') {
      setPreviewing(false)
    }
    if (outcome === 'retargeted') onRetargeted?.()
  }

  if (state.phase === 'pending') {
    return (
      <p role="status" className="flex items-center gap-1.5 text-xs text-muted">
        <LoaderCircle size={12} className="animate-spin" aria-hidden />
        Waiting for your confirmation… then retargeting to{' '}
        <span className="font-mono text-text">{state.newBase}</span>
      </p>
    )
  }

  if (state.phase === 'failed') {
    const { failure } = state
    return (
      <div
        role="alert"
        data-error-code={failure.code ?? 'UNKNOWN'}
        className="flex min-w-0 flex-col gap-1.5 rounded-md border border-danger/40 bg-danger/10 p-2 text-xs"
      >
        <p className="font-medium text-danger">Could not retarget #{number}.</p>
        <p className="text-text/80">{failure.explanation}</p>
        {failure.detail && <p className="break-words text-muted">{failure.detail}</p>}
        <div className="flex gap-1.5">
          <button type="button" onClick={close} className={ghostButton}>
            Dismiss
          </button>
        </div>
      </div>
    )
  }

  if (mode.kind === 'orphan' && !previewing) {
    return (
      <button
        type="button"
        onClick={() => setPreviewing(true)}
        className={primaryButton + ' self-start'}
      >
        Retarget to {mode.suggestedBase}
      </button>
    )
  }

  if (mode.kind === 'orphan') {
    return (
      <div className="flex min-w-0 flex-col gap-2 rounded-md border border-warning/40 bg-warning/5 p-2">
        <Consequence from={currentBase} to={mode.suggestedBase} parentNumber={mode.parentNumber} />
        <div className="flex flex-wrap gap-1.5">
          <button type="button" onClick={() => void submit()} className={primaryButton}>
            Retarget #{number}
          </button>
          <button type="button" onClick={close} className={ghostButton}>
            Cancel
          </button>
        </div>
      </div>
    )
  }

  const problem = !target.ok
    ? target.reason
    : isOwnHead
      ? 'A pull request cannot target its own source branch.'
      : null

  return (
    <form
      aria-label="Change target branch"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
      className="flex min-w-0 flex-col gap-2 rounded-md border border-border bg-bg/60 p-2"
    >
      <label className="flex min-w-0 flex-col gap-1 text-xs text-muted">
        New target branch
        <input
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation()
              close()
            }
          }}
          spellCheck={false}
          aria-invalid={problem !== null}
          className="w-full min-w-0 rounded border border-border bg-bg px-2 py-1 font-mono text-xs text-text outline-none focus:border-accent"
        />
      </label>
      {problem ? (
        <p className="text-xs text-danger">{problem}</p>
      ) : target.ok && !sameAsCurrent ? (
        <Consequence from={currentBase} to={target.branch} />
      ) : (
        <p className="text-xs text-muted">Type the branch this PR should merge into.</p>
      )}
      <div className="flex flex-wrap gap-1.5">
        <button type="submit" disabled={!canSubmit} className={accentButton}>
          Retarget
        </button>
        <button type="button" onClick={close} className={ghostButton}>
          Cancel
        </button>
      </div>
    </form>
  )
}
