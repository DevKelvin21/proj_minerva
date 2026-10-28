import { useState } from 'react'
import { ArrowRight } from 'lucide-react'
import { Trans, useTranslation } from 'react-i18next'
import type { RepoRef } from '../../../../shared/scm'
import { useRetarget } from '../../hooks/use-retarget'
import { validateBranchName } from '../../lib/retarget'
import { Spinner } from '../ui/Spinner'
import { Button } from '../ui/Button'
import { Callout } from '../ui/Callout'

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
  const { t } = useTranslation()
  const branch = <span className="font-mono text-text" />
  return (
    <div className="flex min-w-0 flex-col gap-1 text-xs text-muted">
      <p className="flex min-w-0 flex-wrap items-center gap-1">
        <span>{t('stacks.retarget.targetBranch')}</span>
        <BaseChange from={from} to={to} />
      </p>
      <p>
        {parentNumber !== undefined ? (
          <Trans
            i18nKey="stacks.retarget.consequenceOrphan"
            values={{ branch: to, parent: parentNumber }}
            components={{ branch }}
          />
        ) : (
          <Trans
            i18nKey="stacks.retarget.consequenceManual"
            values={{ branch: to }}
            components={{ branch }}
          />
        )}
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
  const { t } = useTranslation()
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
        <Spinner size={12} />
        <span>
          <Trans
            i18nKey="stacks.retarget.waiting"
            values={{ branch: state.newBase }}
            components={{ branch: <span className="font-mono text-text" /> }}
          />
        </span>
      </p>
    )
  }

  if (state.phase === 'failed') {
    const { failure } = state
    return (
      <Callout tone="danger" role="alert" data-error-code={failure.code ?? 'UNKNOWN'}>
        <div className="flex flex-col gap-1.5">
          <p className="font-medium text-danger">
            {t('stacks.retarget.couldNotRetarget', { number })}
          </p>
          <p className="text-text/80">
            {t(`stacks.retarget.failures.${failure.reason}`, { branch: failure.newBase })}
          </p>
          {failure.detail && <p className="break-words text-muted">{failure.detail}</p>}
          <div className="flex gap-1.5">
            <Button size="xs" onClick={close}>
              {t('stacks.retarget.dismiss')}
            </Button>
          </div>
        </div>
      </Callout>
    )
  }

  if (mode.kind === 'orphan' && !previewing) {
    return (
      <Button size="xs" onClick={() => setPreviewing(true)} className="self-start">
        {t('stacks.retarget.retargetTo', { branch: mode.suggestedBase })}
      </Button>
    )
  }

  // No box of its own: it sits inside the orphan's warning callout (`OrphanNotice`).
  if (mode.kind === 'orphan') {
    return (
      <div className="flex min-w-0 flex-col gap-2">
        <Consequence from={currentBase} to={mode.suggestedBase} parentNumber={mode.parentNumber} />
        <div className="flex flex-wrap gap-1.5">
          <Button variant="primary" size="xs" onClick={() => void submit()}>
            {t('stacks.retarget.retargetNumber', { number })}
          </Button>
          <Button size="xs" onClick={close}>
            {t('stacks.retarget.cancel')}
          </Button>
        </div>
      </div>
    )
  }

  const problem = !target.ok
    ? t(`stacks.retarget.branchProblems.${target.reason}`)
    : isOwnHead
      ? t('stacks.retarget.ownHead')
      : null

  return (
    <form
      aria-label={t('stacks.retarget.formAriaLabel')}
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
      className="flex min-w-0 flex-col gap-2 rounded-md border border-border bg-bg/60 p-2"
    >
      <label className="flex min-w-0 flex-col gap-1 text-xs text-muted">
        {t('stacks.retarget.newTargetBranch')}
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
        <p className="text-xs text-muted">{t('stacks.retarget.typeBranch')}</p>
      )}
      <div className="flex flex-wrap gap-1.5">
        <Button type="submit" variant="primary" size="xs" disabled={!canSubmit}>
          {t('stacks.retarget.retarget')}
        </Button>
        <Button size="xs" onClick={close}>
          {t('stacks.retarget.cancel')}
        </Button>
      </div>
    </form>
  )
}
