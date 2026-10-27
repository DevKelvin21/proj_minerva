import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CheckCircle2,
  CircleDashed,
  CircleSlash,
  ExternalLink,
  GitBranch,
  XCircle,
} from 'lucide-react'
import { prKey } from '../../../../shared/scm'
import type { PrCheck, PrMergeStatus, PullRequestDetail } from '../../../../shared/types'
import { RetargetNote } from '../stacks/RetargetNote'
import { RetargetPanel } from '../stacks/RetargetPanel'
import { StackContext, StackOrphanFlag } from '../stacks/StackContext'
import { useLayoutTier } from '../../hooks/use-layout-tier'
import { Avatar } from '../ui/Avatar'
import { Badge } from '../ui/Badge'
import { REVIEWER_VOTE_TONE, reviewerVoteLabel, SCM_PROVIDER_LABEL } from '../../lib/scm-labels'
import type { ScmTone } from '../../lib/scm-labels'
import { labelStyle } from '../../lib/label-colors'

interface PrHeaderProps {
  pr: PullRequestDetail
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
export function PrHeader({ pr }: PrHeaderProps): React.JSX.Element {
  return <PrHeaderBody key={prKey(pr.repo, pr.number)} pr={pr} />
}

/**
 * Cabecera del PR. Con la ventana baja (`short`/`xshort`, p. ej. una mitad
 * horizontal de 1920x540) pasa a UNA línea y manda autor/rama/commits/labels a
 * un `<details>` "Detalles" (F16/T84): en el layout completo esta cabecera come
 * ~110px de los ~490px útiles, y lo que el usuario vino a leer está debajo.
 * El `<details>` nativo evita sumar estado y cierra con Esc por sí solo.
 */
function PrHeaderBody({ pr }: PrHeaderProps): React.JSX.Element {
  const { t } = useTranslation()
  const tier = useLayoutTier()
  const [editingBase, setEditingBase] = useState(false)

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
        <button
          type="button"
          onClick={() => setEditingBase(true)}
          className="underline decoration-dotted transition-colors hover:text-text"
        >
          {t('prDetail.header.changeTargetBranch')}
        </button>
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

  if (tier.h !== 'tall') {
    return (
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-1.5">
        <h1 className="min-w-0 truncate text-sm font-semibold text-text">
          {pr.title} <span className="font-normal text-muted">#{pr.number}</span>
        </h1>
        {pr.isDraft && <Badge tone="neutral">{t('prDetail.header.draft')}</Badge>}
        <StackOrphanFlag pr={pr} />
        <details className="relative ml-auto shrink-0">
          <summary className="cursor-pointer list-none rounded border border-border px-2 py-0.5 text-xs text-muted transition-colors hover:border-accent hover:text-text">
            {t('prDetail.header.details')}
          </summary>
          <div className="absolute right-0 z-20 mt-1 flex max-h-[70vh] w-80 max-w-[calc(100vw-2rem)] flex-col gap-2 overflow-y-auto rounded-md border border-border bg-panel p-3 shadow-xl">
            {meta}
            {branchContext}
            {mergeBadges}
            {reviewers}
            {checks}
            {workItems}
            {labels}
          </div>
        </details>
      </header>
    )
  }

  return (
    <header className="flex shrink-0 flex-col gap-2 border-b border-border px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <h1 className="text-base font-semibold text-text">
          {pr.title} <span className="font-normal text-muted">#{pr.number}</span>
        </h1>
        {pr.isDraft && <Badge tone="neutral">{t('prDetail.header.draft')}</Badge>}
      </div>

      {meta}
      {branchContext}
      {mergeBadges}
      {reviewers}
      {checks}
      {workItems}
      {labels}
    </header>
  )
}
