import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { CheckCircle2, ChevronDown, Clock, GitMerge } from 'lucide-react'
import type {
  MergeBlocker,
  MergeOptions,
  MergeStrategy,
  PullRequestDetail,
} from '../../../../shared/types'
import { shortRef } from '../../../../shared/scm'
import { useMergeOptions } from '../../hooks/use-merge-options'
import { describeMergeError, initialStrategy, type MergeFailure } from '../../lib/merge'
import { useAppStore } from '../../stores/app-store'
import { Avatar } from '../ui/Avatar'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Callout } from '../ui/Callout'
import { Checkbox, Radio } from '../ui/Checkbox'
import { Spinner } from '../ui/Spinner'

interface MergeControlProps {
  pr: PullRequestDetail
  /** Narrow bar: the trigger shows its icon only. */
  compact: boolean
}

type Busy = 'merge' | 'autoOn' | 'autoOff' | null

/** What the control says after a write that changed the PR. */
type Notice = { kind: 'merged'; branchDeleteFailed: boolean } | { kind: 'completing' }

/** Blockers the reviewer can't wait out: shown as errors, the rest as warnings. */
const HARD_BLOCKERS: ReadonlySet<MergeBlocker> = new Set([
  'conflicts',
  'checks_failing',
  'no_permission',
  'not_open',
])

/**
 * The Merge control at the end of the PR bar: a split button (merge now with
 * the preselected options / open the options) and a popover with the
 * strategy, branch deletion, work items and auto-complete (Azure DevOps) or
 * auto-merge (GitHub). Every write goes through main, which re-checks the PR
 * and asks with a native dialog; this control never writes on its own.
 *
 * Remounted per PR by `PrHeader` (`key`), so no state leaks to another PR.
 */
export function MergeControl({ pr, compact }: MergeControlProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const isOpen = pr.state === 'open'
  const { options, loading, error, reload } = useMergeOptions(pr.repo, pr.number, pr.headSha, isOpen)
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [busy, setBusy] = useState<Busy>(null)
  const [failure, setFailure] = useState<MergeFailure | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const bumpScmData = useAppStore((s) => s.bumpScmData)
  const replaceSelectedPr = useAppStore((s) => s.replaceSelectedPr)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverId = useId()
  const azure = pr.repo.provider === 'azure'

  // Outside click and Escape close the popover (focus back on the trigger for Escape).
  useEffect(() => {
    if (!popoverOpen) return
    const onPointerDown = (event: PointerEvent): void => {
      if (!wrapperRef.current?.contains(event.target as Node)) setPopoverOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      setPopoverOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [popoverOpen])

  if (!isOpen) {
    if (!notice || notice.kind !== 'merged') return null
    return (
      <span role="status" className="flex shrink-0 items-center gap-1.5 text-xs" data-testid="merge-notice">
        <Badge tone="merged">{t('prDetail.merge.merged')}</Badge>
        {notice.branchDeleteFailed && (
          <span className="text-warning">{t('prDetail.merge.branchNotDeleted')}</span>
        )}
      </span>
    )
  }

  function openPopover(): void {
    setPopoverOpen(true)
    reload()
  }

  async function run(kind: Exclude<Busy, null>, choice: Choice | null): Promise<void> {
    setBusy(kind)
    setFailure(null)
    try {
      if (kind === 'merge' && choice) {
        const result = await window.minerva.scm.merge({
          repo: pr.repo,
          number: pr.number,
          expectedHeadSha: pr.headSha,
          ...choice,
        })
        if (result.outcome === 'cancelled') return
        setPopoverOpen(false)
        setNotice(
          result.outcome === 'merged'
            ? { kind: 'merged', branchDeleteFailed: result.branchDeleteFailed === true }
            : { kind: 'completing' },
        )
        replaceSelectedPr(result.pr)
      } else {
        const result =
          kind === 'autoOn' && choice
            ? await window.minerva.scm.setAutoMerge({
                repo: pr.repo,
                number: pr.number,
                enable: true,
                expectedHeadSha: pr.headSha,
                ...choice,
              })
            : await window.minerva.scm.setAutoMerge({ repo: pr.repo, number: pr.number, enable: false })
        if (result.outcome === 'cancelled') return
        // The trigger now says the new state; the popover has done its job.
        setPopoverOpen(false)
        replaceSelectedPr(result.pr)
      }
      bumpScmData()
    } catch (err: unknown) {
      const described = describeMergeError(err)
      setFailure(described)
      setPopoverOpen(true)
      if (described.shouldRefresh) bumpScmData()
    } finally {
      setBusy(null)
    }
  }

  const readyChoice = options ? defaultChoice(options) : null
  // The main half merges right away (main still asks) only when nothing blocks it.
  const canQuickMerge =
    options !== null && options.blocker === null && readyChoice !== null && busy === null
  const mergeLabel = azure ? t('prDetail.merge.complete') : t('prDetail.merge.merge')

  const trigger = pr.autoComplete ? (
    <Button
      ref={triggerRef}
      variant="secondary"
      className="border-accent/60 text-accent"
      aria-haspopup="dialog"
      aria-expanded={popoverOpen}
      aria-controls={popoverOpen ? popoverId : undefined}
      onClick={() => (popoverOpen ? setPopoverOpen(false) : openPopover())}
      data-testid="merge-trigger"
      icon={<Clock size={14} aria-hidden />}
      aria-label={compact ? autoMergeOnLabel(t, azure, pr.autoComplete.strategy) : undefined}
      title={autoMergeOnLabel(t, azure, pr.autoComplete.strategy)}
    >
      {!compact && autoMergeOnLabel(t, azure, pr.autoComplete.strategy)}
      <ChevronDown size={14} aria-hidden />
    </Button>
  ) : (
    <div className="flex shrink-0 items-stretch" role="group" aria-label={mergeLabel}>
      <Button
        variant="primary"
        className="rounded-r-none"
        disabled={busy !== null}
        onClick={() => {
          if (canQuickMerge && readyChoice) void run('merge', readyChoice)
          else openPopover()
        }}
        data-testid="merge-primary"
        icon={busy === 'merge' ? <Spinner size={12} /> : <GitMerge size={14} aria-hidden />}
        aria-label={compact ? mergeLabel : undefined}
        title={
          canQuickMerge && readyChoice
            ? t('prDetail.merge.quickTitle', {
                strategy: t(`prDetail.merge.strategy.${readyChoice.strategy}`),
              })
            : mergeLabel
        }
      >
        {!compact && mergeLabel}
      </Button>
      <Button
        ref={triggerRef}
        variant="primary"
        className="rounded-l-none border-l border-accent-fg/25 px-1.5"
        aria-label={t('prDetail.merge.options')}
        title={t('prDetail.merge.options')}
        aria-haspopup="dialog"
        aria-expanded={popoverOpen}
        aria-controls={popoverOpen ? popoverId : undefined}
        onClick={() => (popoverOpen ? setPopoverOpen(false) : openPopover())}
        data-testid="merge-trigger"
      >
        <ChevronDown size={14} aria-hidden />
      </Button>
    </div>
  )

  return (
    <div ref={wrapperRef} className="relative shrink-0" data-no-drag>
      {notice?.kind === 'completing' ? (
        <span role="status" className="flex items-center gap-1.5 text-xs text-muted">
          <Spinner size={12} />
          {t('prDetail.merge.completing')}
        </span>
      ) : (
        trigger
      )}
      {popoverOpen && (
        <div
          id={popoverId}
          role="dialog"
          aria-label={azure ? t('prDetail.merge.titleComplete', { number: pr.number }) : t('prDetail.merge.title', { number: pr.number })}
          className="absolute right-0 z-30 mt-2 flex max-h-[75vh] w-[23rem] max-w-[calc(100vw-2rem)] flex-col gap-3 overflow-y-auto rounded-lg border border-border bg-panel p-4 text-left shadow-2xl"
          data-testid="merge-popover"
        >
          <MergePanel
            // Remounted when the options of another head arrive: the choices restart from them.
            key={options?.headSha ?? 'loading'}
            pr={pr}
            options={options}
            loading={loading}
            error={error}
            busy={busy}
            failure={failure}
            onRetry={reload}
            onMerge={(choice) => void run('merge', choice)}
            onAutoOn={(choice) => void run('autoOn', choice)}
            onAutoOff={() => void run('autoOff', null)}
          />
        </div>
      )}
    </div>
  )
}

interface Choice {
  strategy: MergeStrategy
  deleteSourceBranch: boolean
  transitionWorkItems: boolean
}

/** What the main half of the split button uses: the auto-complete's options, else the repository defaults. */
function defaultChoice(options: MergeOptions): Choice | null {
  const strategy = initialStrategy(options)
  if (!strategy) return null
  return {
    strategy,
    deleteSourceBranch:
      options.deleteSourceBranch === 'option' && (options.current?.deleteSourceBranch ?? false),
    transitionWorkItems:
      options.workItems !== null && options.workItems > 0
        ? (options.current?.transitionWorkItems ?? true)
        : false,
  }
}

function autoMergeOnLabel(
  t: TFunction,
  azure: boolean,
  strategy: MergeStrategy | null,
): string {
  const name = azure ? t('prDetail.merge.autoComplete') : t('prDetail.merge.autoMerge')
  return strategy ? `${name} · ${t(`prDetail.merge.strategy.${strategy}`)}` : name
}

interface MergePanelProps {
  pr: PullRequestDetail
  options: MergeOptions | null
  loading: boolean
  error: string | null
  busy: Busy
  failure: MergeFailure | null
  onRetry: () => void
  onMerge: (choice: Choice) => void
  onAutoOn: (choice: Choice) => void
  onAutoOff: () => void
}

function MergePanel({
  pr,
  options,
  loading,
  error,
  busy,
  failure,
  onRetry,
  onMerge,
  onAutoOn,
  onAutoOff,
}: MergePanelProps): React.JSX.Element {
  const { t } = useTranslation()
  const azure = pr.repo.provider === 'azure'
  const initial = options ? defaultChoice(options) : null
  const [strategy, setStrategy] = useState<MergeStrategy | null>(initial?.strategy ?? null)
  const [deleteBranch, setDeleteBranch] = useState(initial?.deleteSourceBranch ?? false)
  const [workItems, setWorkItems] = useState(initial?.transitionWorkItems ?? false)
  const groupName = useId()

  const heading = (
    <div className="flex min-w-0 flex-col gap-0.5">
      <p className="text-sm font-semibold text-text">
        {azure
          ? t('prDetail.merge.titleComplete', { number: pr.number })
          : t('prDetail.merge.title', { number: pr.number })}
      </p>
      <p className="break-all font-mono text-[11px] text-muted">
        {t('prDetail.merge.branches', {
          from: shortRef(pr.headRef),
          to: shortRef(pr.baseRef),
          sha: pr.headSha.slice(0, 7),
        })}
      </p>
    </div>
  )

  const failureCallout = failure && (
    <Callout tone="danger" role="alert" data-testid="merge-failure" data-reason={failure.reason}>
      <p className="font-medium">{t(`prDetail.merge.failures.${failure.reason}`)}</p>
      <p className="text-muted">{failure.detail}</p>
    </Callout>
  )

  if (!options) {
    return (
      <>
        {heading}
        {failureCallout}
        {error ? (
          <Callout
            tone="danger"
            role="alert"
            action={
              <Button size="xs" onClick={onRetry}>
                {t('prDetail.merge.retry')}
              </Button>
            }
          >
            {t('prDetail.merge.loadFailed', { error })}
          </Callout>
        ) : (
          <p className="flex items-center gap-2 text-xs text-muted" role="status">
            <Spinner size={12} />
            {t('prDetail.merge.loading')}
          </p>
        )}
      </>
    )
  }

  const choice: Choice | null = strategy
    ? { strategy, deleteSourceBranch: deleteBranch, transitionWorkItems: workItems }
    : null
  const current = options.current
  const blocker = options.blocker

  const readiness =
    blocker !== null ? (
      <Callout
        tone={HARD_BLOCKERS.has(blocker) ? 'danger' : 'warning'}
        data-testid="merge-blocker"
        data-blocker={blocker}
      >
        {t(`prDetail.merge.blockers.${blocker === 'approvals_missing' && azure ? 'policies_missing' : blocker}`, {
          branch: shortRef(pr.baseRef),
        })}
      </Callout>
    ) : options.checksWarning ? (
      <Callout tone="warning" data-testid="merge-ready" data-warning={options.checksWarning}>
        {t(`prDetail.merge.checksWarning.${options.checksWarning}`)}
      </Callout>
    ) : (
      <p
        className="flex items-center gap-2 rounded-md bg-success/10 px-2.5 py-2 text-xs text-success"
        data-testid="merge-ready"
      >
        <CheckCircle2 size={14} className="shrink-0" aria-hidden />
        {azure ? t('prDetail.merge.readyAzure') : t('prDetail.merge.ready')}
      </p>
    )

  const autoName = azure ? t('prDetail.merge.autoComplete') : t('prDetail.merge.autoMerge')

  const currentState = current && (
    <section
      className="flex flex-col gap-2 rounded-md border border-accent/40 bg-accent/5 p-2.5 text-xs"
      data-testid="auto-merge-state"
    >
      <p className="flex items-center gap-2 font-semibold text-text">
        <Clock size={14} className="text-accent" aria-hidden />
        {azure ? t('prDetail.merge.autoCompleteOn') : t('prDetail.merge.autoMergeOn')}
      </p>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-muted">
        <dt>{t('prDetail.merge.setBy')}</dt>
        <dd className="flex min-w-0 items-center gap-1.5 text-text">
          <Avatar user={current.setBy} size={16} />
          <span className="truncate">{current.setBy.displayName ?? current.setBy.login}</span>
        </dd>
        {current.strategy && (
          <>
            <dt>{t('prDetail.merge.strategyLabel')}</dt>
            <dd className="text-text">{t(`prDetail.merge.strategy.${current.strategy}`)}</dd>
          </>
        )}
        {current.deleteSourceBranch !== undefined && (
          <>
            <dt>{t('prDetail.merge.sourceBranch')}</dt>
            <dd className="text-text">
              {current.deleteSourceBranch
                ? t('prDetail.merge.deletedAfter')
                : t('prDetail.merge.kept')}
            </dd>
          </>
        )}
        {current.transitionWorkItems !== undefined && (
          <>
            <dt>{t('prDetail.merge.workItemsLabel')}</dt>
            <dd className="text-text">
              {current.transitionWorkItems
                ? t('prDetail.merge.workItemsCompleted')
                : t('prDetail.merge.workItemsLeft')}
            </dd>
          </>
        )}
      </dl>
      <div className="flex justify-end">
        <Button
          size="xs"
          variant="danger"
          disabled={busy !== null}
          onClick={onAutoOff}
          icon={busy === 'autoOff' ? <Spinner size={12} /> : undefined}
          data-testid="auto-merge-off"
        >
          {azure ? t('prDetail.merge.cancelAutoComplete') : t('prDetail.merge.disableAutoMerge')}
        </Button>
      </div>
    </section>
  )

  const notAllowedHint = azure
    ? t('prDetail.merge.notAllowedAzure')
    : t('prDetail.merge.notAllowedGithub')

  const strategies = (
    <fieldset className="flex flex-col gap-1.5" disabled={busy !== null}>
      <legend className="pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
        {t('prDetail.merge.strategyLabel')}
      </legend>
      {options.strategies.map((item) => (
        <Radio
          key={item.strategy}
          name={groupName}
          value={item.strategy}
          checked={strategy === item.strategy}
          disabled={!item.allowed}
          onChange={() => setStrategy(item.strategy)}
          label={t(`prDetail.merge.strategy.${item.strategy}`)}
          hint={item.allowed ? undefined : notAllowedHint}
          data-strategy={item.strategy}
        />
      ))}
    </fieldset>
  )

  const sourceBranch = shortRef(pr.headRef)
  const extras = (options.deleteSourceBranch !== 'none' ||
    (options.workItems !== null && options.workItems > 0)) && (
    <div className="flex flex-col gap-1.5 border-t border-border pt-2.5">
      {options.deleteSourceBranch === 'option' && (
        <Checkbox
          checked={deleteBranch}
          disabled={busy !== null}
          onChange={(event) => setDeleteBranch(event.target.checked)}
          label={t('prDetail.merge.deleteBranch', { branch: sourceBranch })}
          data-testid="merge-delete-branch"
        />
      )}
      {options.deleteSourceBranch === 'repo' && (
        <Checkbox
          checked
          disabled
          readOnly
          label={t('prDetail.merge.deleteBranch', { branch: sourceBranch })}
          hint={t('prDetail.merge.repoDeletes')}
        />
      )}
      {options.workItems !== null && options.workItems > 0 && (
        <Checkbox
          checked={workItems}
          disabled={busy !== null}
          onChange={(event) => setWorkItems(event.target.checked)}
          label={t('prDetail.merge.completeWorkItems', { count: options.workItems })}
          data-testid="merge-work-items"
        />
      )}
    </div>
  )

  const autoUnavailable = options.autoMerge.available ? null : options.autoMerge.reason
  const autoReason =
    autoUnavailable === 'repo_disabled'
      ? t('prDetail.merge.autoUnavailable.repo_disabled')
      : autoUnavailable === 'nothing_to_wait_for'
        ? t('prDetail.merge.autoUnavailable.nothing_to_wait_for')
        : autoUnavailable === 'no_permission'
          ? t('prDetail.merge.autoUnavailable.no_permission')
          : null
  const autoKeepsBranch =
    !current &&
    options.autoMerge.available &&
    !options.deleteBranchWithAutoMerge &&
    options.deleteSourceBranch === 'option' &&
    deleteBranch

  const mergeLabel = azure ? t('prDetail.merge.completeNow') : t('prDetail.merge.mergeNow')

  return (
    <>
      {heading}
      {failureCallout}
      {readiness}
      {currentState}
      {strategies}
      {extras}
      <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
        {!current && autoUnavailable !== 'not_open' && (
          <Button
            variant="secondary"
            disabled={!options.autoMerge.available || !choice || busy !== null}
            title={autoReason ?? undefined}
            onClick={() => choice && onAutoOn(choice)}
            icon={busy === 'autoOn' ? <Spinner size={12} /> : <Clock size={14} aria-hidden />}
            data-testid="auto-merge-on"
          >
            {azure ? t('prDetail.merge.setAutoComplete') : t('prDetail.merge.enableAutoMerge')}
          </Button>
        )}
        <Button
          variant="primary"
          disabled={blocker !== null || !choice || busy !== null}
          onClick={() => choice && onMerge(choice)}
          icon={busy === 'merge' ? <Spinner size={12} /> : <GitMerge size={14} aria-hidden />}
          data-testid="merge-now"
        >
          {mergeLabel}
        </Button>
      </div>
      {!current && autoReason && (
        <p className="text-[11px] text-muted" data-testid="auto-merge-unavailable">
          {autoReason}
        </p>
      )}
      {autoKeepsBranch && (
        <p className="text-[11px] text-muted">{t('prDetail.merge.autoKeepsBranch', { name: autoName })}</p>
      )}
      {loading && (
        <p className="sr-only" role="status">
          {t('prDetail.merge.loading')}
        </p>
      )}
      <p className="text-[11px] text-muted">{t('prDetail.merge.confirmNote')}</p>
    </>
  )
}
