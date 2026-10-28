import { useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  CircleSlash,
  ExternalLink,
  GitBranch,
  Layers,
  XCircle,
} from 'lucide-react'
import { prKey } from '../../../../shared/scm'
import type { PrCheck, PrMergeStatus, PullRequestDetail } from '../../../../shared/types'
import { RetargetNote } from '../stacks/RetargetNote'
import { RetargetPanel } from '../stacks/RetargetPanel'
import { StackContext, StackOrphanFlag } from '../stacks/StackContext'
import { useElementWidth } from '../../hooks/use-element-width'
import { Avatar } from '../ui/Avatar'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { REVIEWER_VOTE_TONE, reviewerVoteLabel, SCM_PROVIDER_LABEL } from '../../lib/scm-labels'
import type { ScmTone } from '../../lib/scm-labels'
import { labelStyle } from '../../lib/label-colors'

interface PrHeaderProps {
  pr: PullRequestDetail
  /** The Conversation / Files / Comments tabs, on the left of the bar. */
  tabs: ReactNode
  /** Opens the guided walkthrough; absent = no button. */
  onWalkthrough?: () => void
}

/** `clean` gets no badge: only what needs the reviewer's attention is flagged. */
const MERGE_STATUS_TONE: Record<Exclude<PrMergeStatus, 'clean'>, ScmTone> = {
  conflicts: 'danger',
  failed: 'danger',
  blocked: 'warning',
  checking: 'neutral',
}

function CheckIcon({ status }: { status: PrCheck['status'] }): React.JSX.Element {
  if (status === 'success')
    return <CheckCircle2 size={12} className="shrink-0 text-success" aria-hidden />
  if (status === 'failure')
    return <XCircle size={12} className="shrink-0 text-danger" aria-hidden />
  if (status === 'pending')
    return <CircleDashed size={12} className="shrink-0 text-warning" aria-hidden />
  return <CircleSlash size={12} className="shrink-0 text-muted" aria-hidden />
}

/**
 * Remounted per PR (`key`), so the "Change target branch…" form never
 * carries over to another PR.
 */
export function PrHeader(props: PrHeaderProps): React.JSX.Element {
  return <PrHeaderBody key={prKey(props.pr.repo, props.pr.number)} {...props} />
}

/**
 * The PR bar: the tabs on the left, a one-line status on the right (draft,
 * orphan, merge blockers, approvals, checks, branches) and everything else
 * (author, commits, the provider link, each reviewer's vote, every check,
 * work items, labels, "Change target branch…") in a "Details" popover. The
 * title lives in the title bar, so this bar is all the PR costs above the
 * content: 48px instead of ~200. The stack map and the retarget form/note
 * stay visible under it (they are navigation and fixes, not metadata).
 * The native `<details>` adds no state.
 */
function PrHeaderBody({ pr, tabs, onWalkthrough }: PrHeaderProps): React.JSX.Element {
  const { t } = useTranslation()
  const [editingBase, setEditingBase] = useState(false)
  const detailsRef = useRef<HTMLDetailsElement>(null)
  const { ref: barRef, width: measuredBarWidth } = useElementWidth<HTMLDivElement>()

  const meta = (
    <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
      <span className="flex items-center gap-1.5">
        <Avatar user={pr.author} size={18} />
        {pr.author.displayName ?? pr.author.login}
      </span>
      <span className="flex items-center gap-1 font-mono">
        <GitBranch size={12} />
        <span data-testid="pr-branches">
          {pr.headRef} → {pr.baseRef}
        </span>
      </span>
      {pr.state === 'open' && !editingBase && (
        <Button
          variant="link"
          size="xs"
          onClick={() => {
            if (detailsRef.current) detailsRef.current.open = false
            setEditingBase(true)
          }}
        >
          {t('prDetail.header.changeTargetBranch')}
        </Button>
      )}
      <span>{t('prDetail.header.commitCount', { count: pr.commits })}</span>
      <a
        href={pr.webUrl}
        target="_blank"
        rel="noreferrer"
        className="flex items-center gap-1 underline decoration-dotted transition-colors hover:text-text"
      >
        <ExternalLink size={12} aria-hidden />
        {t('prDetail.header.openIn', { provider: SCM_PROVIDER_LABEL[pr.repo.provider] })}
      </a>
    </div>
  )

  // Stack map + orphan warning, the "Change target branch…" form and the
  // note after a retarget: what this PR is built on, and fixing it.
  const branchContext = (
    <>
      <RetargetNote onlyFor={prKey(pr.repo, pr.number)} />
      {editingBase && (
        <RetargetPanel
          key={pr.baseRef}
          repo={pr.repo}
          number={pr.number}
          currentBase={pr.baseRef}
          headRef={pr.headRef}
          mode={{ kind: 'manual' }}
          onClose={() => setEditingBase(false)}
          onRetargeted={() => setEditingBase(false)}
        />
      )}
      <StackContext pr={pr} />
    </>
  )

  // Reviewer chips with their vote (approved / with suggestions / changes
  // requested or, on Azure, waiting for author / rejected / no vote yet).
  // Required reviewers first: they gate the merge.
  const sortedReviewers = [...pr.reviewers].sort(
    (a, b) => Number(b.isRequired) - Number(a.isRequired),
  )
  const reviewers = pr.reviewers.length > 0 && (
    <ul aria-label={t('prDetail.header.reviewers')} className="flex flex-wrap gap-1.5">
      {sortedReviewers.map((reviewer) => {
        return (
          <li
            key={reviewer.user.login}
            data-vote={reviewer.vote}
            data-required={reviewer.isRequired}
          >
            <Badge tone={REVIEWER_VOTE_TONE[reviewer.vote]}>
              <Avatar user={reviewer.user} size={14} />
              <span>{reviewer.user.displayName ?? reviewer.user.login}</span>
              <span className="font-normal opacity-80">
                · {reviewerVoteLabel(reviewer.vote, t, pr.repo.provider)}
              </span>
              {reviewer.isRequired && (
                <span className="font-normal opacity-80">· {t('prDetail.header.required')}</span>
              )}
            </Badge>
          </li>
        )
      })}
    </ul>
  )

  // Merge readiness the provider computed (Azure: `mergeStatus`, auto-complete).
  const mergeStatus = pr.mergeStatus && pr.mergeStatus !== 'clean' ? pr.mergeStatus : null
  const mergeBadges = (mergeStatus !== null || pr.autoComplete) && (
    <div className="flex flex-wrap items-center gap-1.5">
      {mergeStatus !== null && (
        <span data-merge-status={mergeStatus}>
          <Badge tone={MERGE_STATUS_TONE[mergeStatus]}>
            {t(`prDetail.header.mergeStatus.${mergeStatus}`)}
          </Badge>
        </span>
      )}
      {pr.autoComplete && (
        <span data-auto-complete title={t('prDetail.header.autoCompleteTitle')}>
          <Badge tone="accent">
            {t('prDetail.header.autoComplete', {
              name: pr.autoComplete.setBy.displayName ?? pr.autoComplete.setBy.login,
            })}
          </Badge>
        </span>
      )}
    </div>
  )

  // Azure branch policies (and statuses posted on the PR): what still blocks completion.
  const checksLabel =
    pr.repo.provider === 'azure' ? t('prDetail.header.branchPolicies') : t('prDetail.header.checks')
  const checks = (pr.checks?.length ?? 0) > 0 && (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
      <span className="font-semibold uppercase tracking-wide text-[10px]">{checksLabel}</span>
      <ul aria-label={checksLabel} className="flex min-w-0 flex-wrap gap-x-3 gap-y-1">
        {pr.checks?.map((check, index) => (
          <li
            key={check.kind + ':' + check.name + ':' + index}
            data-check-status={check.status}
            className="flex min-w-0 items-center gap-1"
            title={t(`prDetail.header.checkStatus.${check.status}`)}
          >
            <CheckIcon status={check.status} />
            <span className="truncate text-text/80">{check.name}</span>
            {check.kind === 'policy' && !check.isBlocking && (
              <span className="opacity-70">· {t('prDetail.header.optional')}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )

  const labels = pr.labels.length > 0 && (
    <div
      role="list"
      aria-label={
        pr.repo.provider === 'azure' ? t('prDetail.header.tags') : t('prDetail.header.labels')
      }
      className="flex flex-wrap gap-1.5"
    >
      {pr.labels.map((label) => {
        const style = labelStyle(label.color)
        return (
          <span
            key={label.name}
            role="listitem"
            className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
              style ? '' : 'bg-border/60 text-muted'
            }`}
            style={style ?? undefined}
          >
            {label.name}
          </span>
        )
      })}
    </div>
  )

  // Linked work items (Azure DevOps). The URL is built in main from the
  // organization/project and a numeric id.
  const workItems = (pr.workItems?.length ?? 0) > 0 && (
    <ul
      aria-label={t('prDetail.header.workItems')}
      className="flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-xs text-muted"
    >
      {pr.workItems?.map((item) => (
        <li key={item.id} className="min-w-0 truncate">
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer"
            className="underline decoration-dotted transition-colors hover:text-text"
          >
            {(item.type ? item.type + ' ' : '') + '#' + item.id}
          </a>{' '}
          {item.title}
          {item.state ? ' · ' + item.state : ''}
        </li>
      ))}
    </ul>
  )

  // One-line status: who approved, how the checks went, what blocks the merge.
  const approvals = pr.reviewers.filter(
    (reviewer) => reviewer.vote === 'approved' || reviewer.vote === 'approved_with_suggestions',
  ).length
  const blockingVote = pr.reviewers.some(
    (reviewer) => reviewer.vote === 'rejected' || reviewer.vote === 'changes_requested',
  )
  const checkCounts = { success: 0, failure: 0, pending: 0 }
  for (const check of pr.checks ?? []) {
    if (check.status === 'success' || check.status === 'failure' || check.status === 'pending')
      checkCounts[check.status] += 1
  }
  const checkSummary: { status: PrCheck['status']; text: string } | null =
    (pr.checks?.length ?? 0) === 0
      ? null
      : checkCounts.failure > 0
        ? { status: 'failure', text: t('prDetail.header.summary.checksFailing', { count: checkCounts.failure }) }
        : checkCounts.pending > 0
          ? { status: 'pending', text: t('prDetail.header.summary.checksPending', { count: checkCounts.pending }) }
          : { status: 'success', text: t('prDetail.header.summary.checksPassed', { count: checkCounts.success }) }
  // Sized by the bar itself, not the window: with the PR list and the
  // didactic panel docked, a wide window can still leave a narrow center.
  const barWidth = measuredBarWidth ?? 0
  const showSummaryText = barWidth >= 860
  const showBranches = barWidth >= 1040

  const summary = (
    <div className="flex min-w-0 items-center gap-3 overflow-hidden text-xs text-muted">
      {pr.isDraft && <Badge tone="neutral">{t('prDetail.header.draft')}</Badge>}
      <StackOrphanFlag pr={pr} />
      {mergeStatus !== null && (
        <Badge tone={MERGE_STATUS_TONE[mergeStatus]}>
          {t(`prDetail.header.mergeStatus.${mergeStatus}`)}
        </Badge>
      )}
      {pr.reviewers.length > 0 && (
        <span
          className="flex shrink-0 items-center gap-1.5"
          title={t('prDetail.header.summary.approvals', {
            approved: approvals,
            count: pr.reviewers.length,
          })}
        >
          <span className="flex" aria-hidden>
            {sortedReviewers.slice(0, 3).map((reviewer, index) => (
              <span
                key={reviewer.user.login}
                className={`rounded-full ring-2 ring-panel ${index > 0 ? '-ml-1.5' : ''}`}
              >
                <Avatar user={reviewer.user} size={20} />
              </span>
            ))}
          </span>
          {showSummaryText && (
            <span
              className={`whitespace-nowrap ${blockingVote ? 'text-warning' : approvals > 0 ? 'text-success' : ''}`}
            >
              {t('prDetail.header.summary.approvals', {
                approved: approvals,
                count: pr.reviewers.length,
              })}
            </span>
          )}
        </span>
      )}
      {checkSummary && (
        <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap" title={checkSummary.text}>
          <CheckIcon status={checkSummary.status} />
          {showSummaryText && checkSummary.text}
        </span>
      )}
      {showBranches && (
        <span className="flex min-w-0 items-center gap-1 font-mono" title={pr.headRef + ' → ' + pr.baseRef}>
          <GitBranch size={12} className="shrink-0" aria-hidden />
          <span className="truncate">
            {pr.headRef} → {pr.baseRef}
          </span>
        </span>
      )}
    </div>
  )

  return (
    <header className="flex shrink-0 flex-col border-b border-border bg-panel">
      {/* The title is in the title bar; the page still has its heading. */}
      <h1 className="sr-only">
        {pr.title} #{pr.number}
      </h1>
      <div ref={barRef} className="flex h-12 min-w-0 items-center gap-3 pl-3 pr-3">
        <div className="flex h-full min-w-0 shrink-0 items-stretch">{tabs}</div>
        <div className="ml-auto flex min-w-0 items-center justify-end gap-3">
          {summary}
          <details ref={detailsRef} className="relative shrink-0" data-testid="pr-details">
            <summary className="flex cursor-pointer list-none items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted transition-colors duration-150 hover:bg-border/60 hover:text-text">
              {t('prDetail.header.details')}
              <ChevronDown size={14} aria-hidden />
            </summary>
            <div className="absolute right-0 z-30 mt-2 flex max-h-[70vh] w-96 max-w-[calc(100vw-2rem)] flex-col gap-3 overflow-y-auto rounded-lg border border-border bg-panel p-4 shadow-2xl">
              <p className="text-sm font-semibold text-text">
                {pr.title} <span className="font-normal text-muted">#{pr.number}</span>
              </p>
              {meta}
              {mergeBadges}
              {reviewers}
              {checks}
              {workItems}
              {labels}
            </div>
          </details>
          {onWalkthrough && (
            <Button
              onClick={onWalkthrough}
              // Narrow: icon only, so the label moves to the name and the tooltip.
              aria-label={barWidth < 560 ? t('prDetail.header.walkthrough') : undefined}
              title={barWidth < 560 ? t('prDetail.header.walkthrough') : undefined}
              icon={<Layers size={14} aria-hidden />}
            >
              {barWidth >= 560 && t('prDetail.header.walkthrough')}
            </Button>
          )}
        </div>
      </div>
      {/* Stack map, retarget form and note: navigation and fixes, never hidden. */}
      <div className="flex flex-col gap-2 px-4 pb-2 empty:hidden">{branchContext}</div>
    </header>
  )
}
