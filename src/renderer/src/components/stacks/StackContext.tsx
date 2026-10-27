import { ChevronLeft, ChevronRight, Layers } from 'lucide-react'
import { Trans, useTranslation } from 'react-i18next'
import { prKey, shortRef, type StackNode } from '../../../../shared/scm'
import type { PullRequestDetail } from '../../../../shared/types'
import type { AppLocale } from '../../../../shared/locale'
import { useLocale } from '../../i18n/use-locale'
import { useOpenPr } from '../../hooks/use-open-pr'
import { useHomeOpenPr } from '../../hooks/use-home-open-pr'
import { useStacks } from '../../hooks/use-stacks'
import { descendantsOf, flattenStackNodes as flattenStack, locatePrInStacks } from '../../lib/stacks'
import { stackPosition } from '../../lib/dashboard'
import { useAppStore } from '../../stores/app-store'
import { useDashboardStore } from '../../stores/dashboard-store'
import { IconButton } from '../ui/IconButton'
import { OrphanBadge, OrphanNotice, StackStateIcon } from './StackTree'

function NodeChip({
  node,
  current,
  pending,
  onOpen,
}: {
  node: StackNode
  current: boolean
  pending: boolean
  onOpen: (node: StackNode) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const label = (
    <>
      <StackStateIcon isDraft={node.isDraft} size={12} />
      <span className="shrink-0 font-mono">#{node.number}</span>
      <span className="min-w-0 truncate">{current ? t('stacks.context.thisPr') : node.title}</span>
    </>
  )
  if (current) {
    return (
      <li
        aria-current="true"
        className="flex min-w-0 max-w-full items-center gap-1 rounded-full border border-accent/60 bg-accent/15 px-2 py-0.5 text-[11px] font-medium text-accent"
      >
        {label}
      </li>
    )
  }
  return (
    <li className="min-w-0 max-w-full">
      <button
        type="button"
        onClick={() => onOpen(node)}
        disabled={pending}
        title={'#' + node.number + ' ' + node.title + ' (' + node.headRef + ')'}
        className="flex min-w-0 max-w-[16rem] items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted transition-colors duration-150 hover:border-accent hover:text-text disabled:opacity-60"
      >
        {label}
      </button>
    </li>
  )
}

function Separator(): React.JSX.Element {
  return (
    <li aria-hidden className="flex items-center text-muted/60">
      <ChevronRight size={12} />
    </li>
  )
}

/** "#101, #110 and #104" (or "#101, #110 y #104"): a compact list of PR numbers. */
function numbersList(locale: AppLocale, nodes: StackNode[]): string {
  const numbers = nodes.map((node) => '#' + node.number)
  return new Intl.ListFormat(locale, { type: 'conjunction' }).format(numbers)
}

/**
 * Where the open PR sits in its stack: ancestors → this PR → children, each
 * clickable, plus one sentence on what that means for the review ("built on
 * top of #101: this diff starts where that one ends"), the same feature in
 * other repos, and the orphan warning with its retarget. Renders nothing
 * when the PR is in no stack (or stacks are not loaded yet).
 */
export function StackContext({ pr }: { pr: PullRequestDetail }): React.JSX.Element | null {
  const { t } = useTranslation()
  const { locale } = useLocale()
  const { stacks } = useStacks()
  // Chips open like the sidebar does; Previous/Next go through the dashboard's
  // open path (marks seen in the cached answer, re-arms the navigator from the
  // live stack).
  const known = useDashboardStore((s) => s.result?.pullRequests)
  const { open, pendingKey: chipPending, error: chipError } = useOpenPr(known)
  const { openNode, pendingKey: navPending, error: navError } = useHomeOpenPr()
  const pendingKey = chipPending ?? navPending
  const error = chipError ?? navError
  const stackNav = useAppStore((s) => s.stackNav)
  if (!stacks) return null

  const key = prKey(pr.repo, pr.number)
  const location = locatePrInStacks(stacks, key)
  if (!location) return null

  const { stack, path, node } = location
  // Opened from the dashboard's stack board ("Review stack" / a card): walk
  // the stack root-first, depth-first with Previous / Next.
  const nav = stackNav?.rootKey === stack.root.prKey ? stackPosition(stack, key) : null
  const openKey = (target: string | null): void => {
    const targetNode = target ? flattenStack(stack.root).find((n) => n.prKey === target) : undefined
    if (targetNode) openNode(targetNode, stack)
  }
  const ancestors = path.slice(0, -1)
  const descendants = descendantsOf(node)
  const directChildren = node.children
  const parent = ancestors[ancestors.length - 1]
  // Same feature in other repos (shared `groupKey`), excluding this stack.
  const related = stack.groupKey
    ? stacks.filter((other) => other.groupKey === stack.groupKey && other !== stack)
    : []
  // Stale stacks (e.g. right after a retarget) must not offer a retarget.
  const orphanIsCurrent = node.orphan !== undefined && node.baseRef === shortRef(pr.baseRef)
  const onOpen = (target: StackNode): void => open(target.repo, target.number)

  return (
    <section
      aria-label={t('stacks.context.ariaLabel')}
      className="flex min-w-0 flex-col gap-1.5 rounded-md border border-border bg-bg/40 px-2.5 py-2"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="flex shrink-0 items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
          <Layers size={12} aria-hidden />
          {t('stacks.context.title')}
          <span className="font-normal normal-case">
            {t('stacks.context.position', {
              position: path.length,
              total: path.length + descendants.length,
            })}
          </span>
        </span>
        {orphanIsCurrent && <OrphanBadge />}
        {nav && (
          <span
            role="group"
            aria-label={t('stacks.context.navAriaLabel')}
            data-testid="stack-nav"
            title={t('stacks.context.reviewOrder')}
            className="ml-auto inline-flex items-center gap-0.5 rounded-md border border-border bg-panel px-1 text-[11px] text-muted"
          >
            <IconButton
              icon={<ChevronLeft size={14} />}
              label={t('stacks.context.previous')}
              onClick={() => openKey(nav.previous)}
              disabled={nav.previous === null || pendingKey !== null}
              data-testid="stack-nav-prev"
              className="h-6 w-6"
            />
            <span className="px-1 font-medium tabular-nums text-text/80" data-testid="stack-nav-position">
              {t('stacks.context.navPosition', { index: nav.index, total: nav.total })}
            </span>
            <IconButton
              icon={<ChevronRight size={14} />}
              label={t('stacks.context.next')}
              onClick={() => openKey(nav.next)}
              disabled={nav.next === null || pendingKey !== null}
              data-testid="stack-nav-next"
              className="h-6 w-6"
            />
          </span>
        )}
      </div>
      <ol aria-label={t('stacks.context.mapAriaLabel')} className="flex min-w-0 flex-wrap items-center gap-1">
        {ancestors.map((ancestor) => (
          <StackMapItem
            key={ancestor.prKey}
            node={ancestor}
            pendingKey={pendingKey}
            onOpen={onOpen}
          />
        ))}
        <NodeChip node={node} current pending={false} onOpen={onOpen} />
        {directChildren.length > 0 && <Separator />}
        {directChildren.map((child) => (
          <NodeChip
            key={child.prKey}
            node={child}
            current={false}
            pending={pendingKey === child.prKey}
            onOpen={onOpen}
          />
        ))}
      </ol>
      <p className="text-xs text-muted">
        {parent ? (
          <Trans
            i18nKey="stacks.context.builtOnTop"
            values={{ number: parent.number, branch: parent.headRef }}
            components={{ branch: <span className="font-mono" /> }}
          />
        ) : orphanIsCurrent ? null : (
          <Trans
            i18nKey="stacks.context.firstInStack"
            values={{ base: node.baseRef }}
            components={{ branch: <span className="font-mono" /> }}
          />
        )}
        {descendants.length > 0 && (
          <>
            {' '}
            {t('stacks.context.descendants', {
              count: descendants.length,
              numbers: numbersList(locale, descendants),
            })}
          </>
        )}
      </p>
      {related.length > 0 && (
        <p className="text-xs text-muted">
          {t('stacks.context.sameFeatureIn')}{' '}
          {related.map((other, index) => (
            <span key={other.root.prKey}>
              {index > 0 && t('stacks.context.listSeparator')}
              <span className="text-text/80">{other.repo.name}</span>{' '}
              {t('stacks.context.relatedNumbers', {
                numbers: numbersList(locale, [other.root, ...descendantsOf(other.root)]),
              })}
            </span>
          ))}
          .
        </p>
      )}
      {orphanIsCurrent && <OrphanNotice node={node} />}
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </section>
  )
}

function StackMapItem({
  node,
  pendingKey,
  onOpen,
}: {
  node: StackNode
  pendingKey: string | null
  onOpen: (node: StackNode) => void
}): React.JSX.Element {
  return (
    <>
      <NodeChip node={node} current={false} pending={pendingKey === node.prKey} onOpen={onOpen} />
      <Separator />
    </>
  )
}

/**
 * Orphan chip for the one-line (short window) header, where the full stack
 * map lives behind "Detalles".
 */
export function StackOrphanFlag({ pr }: { pr: PullRequestDetail }): React.JSX.Element | null {
  const { stacks } = useStacks()
  const node = stacks ? locatePrInStacks(stacks, prKey(pr.repo, pr.number))?.node : undefined
  if (!node?.orphan || node.baseRef !== shortRef(pr.baseRef)) return null
  return <OrphanBadge />
}
