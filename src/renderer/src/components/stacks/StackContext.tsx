import { ChevronRight, Layers } from 'lucide-react'
import { prKey, shortRef, type StackNode } from '../../../../shared/scm'
import type { PullRequestDetail } from '../../../../shared/types'
import { useOpenPr } from '../../hooks/use-open-pr'
import { useStacks } from '../../hooks/use-stacks'
import { descendantsOf, locatePrInStacks } from '../../lib/stacks'
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
  const label = (
    <>
      <StackStateIcon isDraft={node.isDraft} size={12} />
      <span className="shrink-0 font-mono">#{node.number}</span>
      <span className="min-w-0 truncate">{current ? 'This PR' : node.title}</span>
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

/** "#101, #110 and #104": a compact list of PR numbers. */
function numbersList(nodes: StackNode[]): string {
  const numbers = nodes.map((node) => '#' + node.number)
  if (numbers.length <= 1) return numbers.join('')
  return numbers.slice(0, -1).join(', ') + ' and ' + numbers[numbers.length - 1]
}

/**
 * Where the open PR sits in its stack: ancestors → this PR → children, each
 * clickable, plus one sentence on what that means for the review ("built on
 * top of #101: this diff starts where that one ends"), the same feature in
 * other repos, and the orphan warning with its retarget. Renders nothing
 * when the PR is in no stack (or stacks are not loaded yet).
 */
export function StackContext({ pr }: { pr: PullRequestDetail }): React.JSX.Element | null {
  const { stacks } = useStacks()
  const { open, pendingKey, error } = useOpenPr()
  if (!stacks) return null

  const key = prKey(pr.repo, pr.number)
  const location = locatePrInStacks(stacks, key)
  if (!location) return null

  const { stack, path, node } = location
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
      aria-label="Stack"
      className="flex min-w-0 flex-col gap-1.5 rounded-md border border-border bg-bg/40 px-2.5 py-2"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="flex shrink-0 items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
          <Layers size={12} aria-hidden />
          Stack
          <span className="font-normal normal-case">
            · {path.length} of {path.length + descendants.length}
          </span>
        </span>
        {orphanIsCurrent && <OrphanBadge />}
      </div>
      <ol aria-label="Stack map" className="flex min-w-0 flex-wrap items-center gap-1">
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
          <>
            Built on top of #{parent.number} (<span className="font-mono">{parent.headRef}</span>):
            this diff only shows what this PR adds on top of it.
          </>
        ) : orphanIsCurrent ? null : (
          <>
            First in the stack: it targets <span className="font-mono">{node.baseRef}</span>{' '}
            directly.
          </>
        )}
        {descendants.length > 0 && (
          <>
            {' '}
            {numbersList(descendants)} {descendants.length === 1 ? 'builds' : 'build'} on top of
            this one; changes here flow up to {descendants.length === 1 ? 'it' : 'them'}.
          </>
        )}
      </p>
      {related.length > 0 && (
        <p className="text-xs text-muted">
          Same feature in{' '}
          {related.map((other, index) => (
            <span key={other.root.prKey}>
              {index > 0 && ', '}
              <span className="text-text/80">{other.repo.name}</span> (
              {numbersList([other.root, ...descendantsOf(other.root)])})
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
