import { GitBranch, Play } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { PrStack, StackNode } from '../../../../shared/scm'
import type { PullRequestSummary } from '../../../../shared/types'
import { useElementWidth } from '../../hooks/use-element-width'
import {
  findPullRequest,
  matchesViewerFilter,
  type ViewerFilter,
  type ViewerIdentity,
} from '../../lib/dashboard'
import { OrphanNotice, StackStateIcon } from '../stacks/StackTree'
import { Badge } from '../ui/Badge'
import { Card } from '../ui/Card'
import { SelectableCard } from '../ui/SelectableCard'
import { PrCard } from './PrCard'

/**
 * Below this board width the chains run top-to-bottom instead of left-to-right
 * (a 700px-wide tiled window leaves the board ~670px: under three cards).
 */
const VERTICAL_BELOW_PX = 720
const CARD_WIDTH_CLASS = 'w-60'

type Orientation = 'horizontal' | 'vertical'

interface BoardContext {
  pullRequests: readonly PullRequestSummary[]
  identity: ViewerIdentity
  filter: ViewerFilter
  pendingKey: string | null
  orientation: Orientation
  onOpenNode: (node: StackNode, stack: PrStack) => void
}

/** A node the dashboard did not list (rare): the stack still shows it, from what the stack knows. */
function NodeFallbackCard({
  node,
  pending,
  onOpen,
}: {
  node: StackNode
  pending: boolean
  onOpen: () => void
}): React.JSX.Element {
  return (
    <SelectableCard
      data-testid="stack-card"
      data-pr-key={node.prKey}
      onClick={onOpen}
      disabled={pending}
      title={'#' + node.number + ' ' + node.title}
    >
      <span className="flex min-w-0 items-start gap-1.5">
        <span className="mt-0.5">
          <StackStateIcon isDraft={node.isDraft} />
        </span>
        <span className="shrink-0 font-mono text-xs text-muted">#{node.number}</span>
        <span className="line-clamp-2 min-w-0 text-sm leading-snug text-text/80">{node.title}</span>
      </span>
      <span className="truncate pl-5 font-mono text-[10px] text-muted">{node.headRef}</span>
    </SelectableCard>
  )
}

/** The `──` / `│` lines between a card and what builds on it. */
function Connector({ orientation }: { orientation: Orientation }): React.JSX.Element {
  return orientation === 'horizontal' ? (
    <span aria-hidden className="mt-5 h-px w-6 shrink-0 bg-border" />
  ) : (
    <span aria-hidden className="ml-6 h-4 w-px shrink-0 bg-border" />
  )
}

/**
 * One PR and everything built on top of it. A single child continues the
 * chain; two or more fan out into parallel rows (horizontal) or an indented
 * column (vertical), each joined to the parent by a rail.
 */
function ChainNode({
  node,
  stack,
  ctx,
}: {
  node: StackNode
  stack: PrStack
  ctx: BoardContext
}): React.JSX.Element {
  const summary = findPullRequest(ctx.pullRequests, node.prKey)
  const matches = summary ? matchesViewerFilter(summary, ctx.filter) : ctx.filter === 'all'
  const pending = ctx.pendingKey === node.prKey
  const isOrphan = node.orphan !== undefined
  const horizontal = ctx.orientation === 'horizontal'

  const card = (
    <div className={`${horizontal ? CARD_WIDTH_CLASS : 'w-full'} shrink-0`}>
      {summary ? (
        <PrCard
          pr={summary}
          identity={ctx.identity}
          dimmed={!matches}
          pending={pending}
          orphan={isOrphan}
          onOpen={() => ctx.onOpenNode(node, stack)}
          testId="stack-card"
        />
      ) : (
        <NodeFallbackCard node={node} pending={pending} onOpen={() => ctx.onOpenNode(node, stack)} />
      )}
    </div>
  )

  if (node.children.length === 0) return card

  const children = node.children.map((child, index) => {
    const last = index === node.children.length - 1
    return (
      <div
        key={child.prKey}
        className={`relative ${horizontal ? 'flex items-start' : 'flex flex-col'}`}
      >
        {/* Stub from the rail to this child, plus the rail segment down to the next one. */}
        {node.children.length > 1 && (
          <span
            aria-hidden
            className={
              horizontal
                ? `absolute -left-6 top-5 w-6 border-t border-border ${
                    last ? '' : 'h-[calc(100%+0.75rem)] border-l'
                  }`
                : `absolute -left-6 top-0 h-5 w-6 border-b border-l border-border ${
                    last ? '' : 'after:absolute after:-left-px after:top-5 after:h-[calc(100%+0.75rem)] after:border-l after:border-border'
                  }`
            }
          />
        )}
        <ChainNode node={child} stack={stack} ctx={ctx} />
      </div>
    )
  })

  return (
    <div className={horizontal ? 'flex items-start' : 'flex flex-col'}>
      {card}
      <Connector orientation={ctx.orientation} />
      <div
        className={
          node.children.length > 1
            ? horizontal
              ? 'flex flex-col gap-3 pl-6'
              : 'flex flex-col gap-3 pl-12'
            : horizontal
              ? 'flex items-start'
              : 'flex flex-col'
        }
      >
        {children}
      </div>
    </div>
  )
}

function StackRow({
  stack,
  ctx,
  onReviewStack,
}: {
  stack: PrStack
  ctx: BoardContext
  onReviewStack: (stack: PrStack) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const horizontal = ctx.orientation === 'horizontal'
  const orphan = stack.root.orphan !== undefined
  return (
    <Card
      as="section"
      tone="inset"
      aria-label={t('home.stackBoard.stackAriaLabel', { number: stack.root.number })}
      data-stack-root={stack.root.prKey}
    >
      <header className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted">
        <span className="font-semibold uppercase tracking-wide text-[10px]">
          {t('home.stackBoard.prCount', { count: stack.size })}
        </span>
        {orphan && (
          <Badge tone="warning" size="sm">
            {t('home.stackBoard.orphaned')}
          </Badge>
        )}
        <button
          type="button"
          onClick={() => onReviewStack(stack)}
          disabled={ctx.pendingKey === stack.root.prKey}
          title={t('home.stackBoard.reviewStackTitle')}
          className="ml-auto inline-flex items-center gap-1 rounded-md border border-accent/50 bg-accent/10 px-2 py-1 text-xs font-medium text-accent transition-colors duration-150 hover:bg-accent/20 disabled:opacity-60"
        >
          <Play size={12} aria-hidden />
          {t('home.stackBoard.reviewStack')}
        </button>
      </header>
      <div className={horizontal ? 'overflow-x-auto pb-1' : ''}>
        <div className={horizontal ? 'flex w-max items-start' : 'flex flex-col'}>
          <span
            data-testid="stack-base"
            title={t('home.stackBoard.base', { branch: stack.root.baseRef })}
            className={`inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-panel px-2 py-0.5 font-mono text-[11px] text-muted ${
              horizontal ? 'mt-3.5' : 'ml-3 self-start'
            } ${orphan ? 'border-warning/50 text-warning' : ''}`}
          >
            <GitBranch size={11} aria-hidden />
            {stack.root.baseRef}
          </span>
          <Connector orientation={ctx.orientation} />
          <ChainNode node={stack.root} stack={stack} ctx={ctx} />
        </div>
      </div>
      {orphan && (
        <div className="max-w-xl">
          <OrphanNotice node={stack.root} />
        </div>
      )}
    </Card>
  )
}

interface StackBoardProps {
  stacks: readonly PrStack[]
  pullRequests: readonly PullRequestSummary[]
  identity: ViewerIdentity
  filter: ViewerFilter
  pendingKey: string | null
  onOpenNode: (node: StackNode, stack: PrStack) => void
  onReviewStack: (stack: PrStack) => void
}

/**
 * The stacks of one repo drawn as chains: base branch -> root PR -> what
 * builds on it, left to right (top to bottom in a narrow pane). Clicking a
 * card opens that PR with the stack navigator armed; "Review stack" starts
 * at the root. PRs outside the active filter are faded, not removed, so the
 * chain keeps its shape.
 */
export function StackBoard({
  stacks,
  pullRequests,
  identity,
  filter,
  pendingKey,
  onOpenNode,
  onReviewStack,
}: StackBoardProps): React.JSX.Element {
  const { t } = useTranslation()
  const { ref, width } = useElementWidth<HTMLDivElement>()
  // Unmeasured = assume wide (no flash to the vertical layout on first paint).
  const orientation: Orientation =
    width !== null && width < VERTICAL_BELOW_PX ? 'vertical' : 'horizontal'
  const ctx: BoardContext = { pullRequests, identity, filter, pendingKey, orientation, onOpenNode }
  return (
    <div
      ref={ref}
      data-testid="stack-board"
      data-orientation={orientation}
      aria-label={t('home.stackBoard.ariaLabel')}
      className="flex min-w-0 flex-col gap-3"
    >
      {stacks.map((stack) => (
        <StackRow key={stack.root.prKey} stack={stack} ctx={ctx} onReviewStack={onReviewStack} />
      ))}
    </div>
  )
}
