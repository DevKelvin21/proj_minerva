import { GitPullRequest, GitPullRequestDraft, LoaderCircle, TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { StackNode } from '../../../../shared/scm'
import { orphanExplanation } from '../../lib/stacks'
import { RetargetPanel } from './RetargetPanel'

/** Indent per level, capped so a deep stack still fits a 240px column. */
const INDENT_PX = 12
const MAX_INDENT_LEVELS = 4
/** Box-drawing elbow before a child row (decoration, not text). */
const TREE_BRANCH_GLYPH = '└'

export function StackStateIcon({
  isDraft,
  size = 14,
}: {
  isDraft: boolean
  size?: number
}): React.JSX.Element {
  const { t } = useTranslation()
  return isDraft ? (
    <GitPullRequestDraft
      size={size}
      className="shrink-0 text-muted"
      aria-label={t('stacks.tree.draft')}
    />
  ) : (
    <GitPullRequest size={size} className="shrink-0 text-accent" aria-label={t('stacks.tree.open')} />
  )
}

/** Warning chip for an orphaned PR. */
export function OrphanBadge(): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <span
      data-orphan-badge
      className="inline-flex shrink-0 items-center gap-0.5 rounded border border-warning/50 bg-warning/10 px-1 text-[10px] font-medium text-warning"
    >
      <TriangleAlert size={10} aria-hidden />
      {t('stacks.tree.orphaned')}
    </span>
  )
}

/** The orphan's explanation plus the one-click retarget, shared by the tree and the PR header. */
export function OrphanNotice({ node }: { node: StackNode }): React.JSX.Element | null {
  const { t } = useTranslation()
  const explanation = orphanExplanation(t, node)
  if (!node.orphan || !explanation) return null
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <p className="text-xs text-warning/90">{explanation}</p>
      <RetargetPanel
        // Remount when the PR or its base changes: a stale panel must not retarget.
        key={node.prKey + '\n' + node.baseRef}
        repo={node.repo}
        number={node.number}
        currentBase={node.baseRef}
        headRef={node.headRef}
        mode={{
          kind: 'orphan',
          suggestedBase: node.orphan.suggestedBase,
          parentNumber: node.orphan.parent.number,
        }}
      />
    </div>
  )
}

interface StackTreeProps {
  node: StackNode
  depth?: number
  selectedKey: string | null
  /** PRs that are in the user's PR list ("mine"). */
  mineKeys: ReadonlySet<string>
  /** PR being fetched before it can open. */
  pendingKey: string | null
  onOpen: (node: StackNode) => void
}

/**
 * One stack as a tree: each child targets its parent's branch. Each row is
 * the PR (number, title, `head → base`, draft), and an orphan gets its
 * explanation and the retarget action right under it.
 */
export function StackTree({
  node,
  depth = 0,
  selectedKey,
  mineKeys,
  pendingKey,
  onOpen,
}: StackTreeProps): React.JSX.Element {
  const { t } = useTranslation()
  const isSelected = selectedKey === node.prKey
  const indent = 8 + Math.min(depth, MAX_INDENT_LEVELS) * INDENT_PX

  return (
    <li data-stack-node={node.number} className="min-w-0">
      <button
        type="button"
        onClick={() => onOpen(node)}
        aria-pressed={isSelected}
        aria-label={'#' + node.number + ' ' + node.title}
        style={{ paddingLeft: indent }}
        className={`flex w-full min-w-0 flex-col gap-0.5 border-l-2 py-1.5 pr-2 text-left transition-colors duration-150 ${
          isSelected ? 'border-accent bg-accent/10' : 'border-transparent hover:bg-bg/60'
        }`}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          {depth > 0 && (
            <span className="shrink-0 text-muted/60" aria-hidden>
              {TREE_BRANCH_GLYPH}
            </span>
          )}
          {pendingKey === node.prKey ? (
            <LoaderCircle size={14} className="shrink-0 animate-spin text-muted" aria-hidden />
          ) : (
            <StackStateIcon isDraft={node.isDraft} />
          )}
          <span className="shrink-0 font-mono text-xs text-muted">#{node.number}</span>
          <span className="min-w-0 truncate text-sm text-text/90" title={node.title}>
            {node.title}
          </span>
          {mineKeys.has(node.prKey) && (
            <span
              className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
              title={t('stacks.tree.inYourList')}
              aria-label={t('stacks.tree.inYourList')}
            />
          )}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 pl-5 text-[11px] text-muted">
          <span className="min-w-0 truncate font-mono" title={node.headRef + ' → ' + node.baseRef}>
            {node.headRef} → {node.baseRef}
          </span>
          {node.isDraft && (
            <span className="shrink-0 rounded border border-border px-1 text-[10px]">
              {t('stacks.tree.draftChip')}
            </span>
          )}
          {node.orphan && <OrphanBadge />}
        </span>
      </button>
      {node.orphan && (
        <div style={{ paddingLeft: indent + 20 }} className="pb-2 pr-2">
          <OrphanNotice node={node} />
        </div>
      )}
      {node.children.length > 0 && (
        <ul>
          {node.children.map((child) => (
            <StackTree
              key={child.prKey}
              node={child}
              depth={depth + 1}
              selectedKey={selectedKey}
              mineKeys={mineKeys}
              pendingKey={pendingKey}
              onOpen={onOpen}
            />
          ))}
        </ul>
      )}
    </li>
  )
}
