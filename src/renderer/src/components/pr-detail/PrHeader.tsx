import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ExternalLink, GitBranch } from 'lucide-react'
import { prKey } from '../../../../shared/scm'
import type { PullRequestDetail } from '../../../../shared/types'
import { RetargetNote } from '../stacks/RetargetNote'
import { RetargetPanel } from '../stacks/RetargetPanel'
import { StackContext, StackOrphanFlag } from '../stacks/StackContext'
import { useLayoutTier } from '../../hooks/use-layout-tier'
import { Avatar } from '../ui/Avatar'
import { Badge } from '../ui/Badge'
import { SCM_PROVIDER_LABEL } from '../../lib/scm-labels'
import { labelStyle } from '../../lib/label-colors'
import { REVIEWER_VOTE_TONE, reviewerVoteLabel } from '../../lib/scm-labels'

interface PrHeaderProps {
  pr: PullRequestDetail
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
  // requested / rejected / no vote yet), provider-neutral.
  const reviewers = pr.reviewers.length > 0 && (
    <ul aria-label={t('prDetail.header.reviewers')} className="flex flex-wrap gap-1.5">
      {pr.reviewers.map((reviewer) => {
        return (
          <li key={reviewer.user.login} data-vote={reviewer.vote}>
            <Badge tone={REVIEWER_VOTE_TONE[reviewer.vote]}>
              <Avatar user={reviewer.user} size={14} />
              <span>{reviewer.user.displayName ?? reviewer.user.login}</span>
              <span className="font-normal opacity-80">
                · {reviewerVoteLabel(reviewer.vote, t)}
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

  const labels = pr.labels.length > 0 && (
    <div className="flex flex-wrap gap-1.5">
      {pr.labels.map((label) => {
        const style = labelStyle(label.color)
        return (
          <span
            key={label.name}
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
            {reviewers}
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
      {reviewers}
      {workItems}
      {labels}
    </header>
  )
}
