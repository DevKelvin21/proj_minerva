/**
 * Pure helpers for the stacked-PR UI (the Home stack board and the stack map
 * in the PR header). The stacks themselves are built in main
 * (`scm:getStacks`); this only locates, counts and explains them.
 */
import type { TFunction } from 'i18next'
import type { PrStack, StackNode } from '../../../shared/scm'

/** Depth-first list of a stack's nodes, root first. */
export function flattenStackNodes(node: StackNode): StackNode[] {
  return [node, ...node.children.flatMap(flattenStackNodes)]
}

/** Where a PR sits inside the stacks: its stack, the path from the root to it, and the node. */
export interface StackLocation {
  stack: PrStack
  /** Root first, the PR itself last. `path.slice(0, -1)` = what this PR is built on top of. */
  path: StackNode[]
  node: StackNode
}

function pathTo(node: StackNode, key: string): StackNode[] | null {
  if (node.prKey === key) return [node]
  for (const child of node.children) {
    const rest = pathTo(child, key)
    if (rest) return [node, ...rest]
  }
  return null
}

/** Locates the PR with `prKey === key` in `stacks`, or `null` when it is in none. */
export function locatePrInStacks(stacks: readonly PrStack[], key: string): StackLocation | null {
  for (const stack of stacks) {
    const path = pathTo(stack.root, key)
    if (path) return { stack, path, node: path[path.length - 1] }
  }
  return null
}

/** Every node below `node` (children, grandchildren…), nearest first. */
export function descendantsOf(node: StackNode): StackNode[] {
  return flattenStackNodes(node).slice(1)
}

/** Number of orphaned PRs across `stacks` (only roots can be orphaned). */
export function countOrphans(stacks: readonly PrStack[]): number {
  return stacks.filter((stack) => stack.root.orphan).length
}

/**
 * One-line explanation of an orphan, written to teach what happened:
 * "Parent #100 was completed into main, but this PR still targets feature/x."
 */
export function orphanExplanation(t: TFunction, node: StackNode): string | null {
  const orphan = node.orphan
  if (!orphan) return null
  const values = {
    parent: orphan.parent.number,
    mergedInto: orphan.parent.mergedInto,
    base: node.baseRef,
  }
  return orphan.targetBranchExists
    ? t('stacks.tree.orphanExplanation', values)
    : t('stacks.tree.orphanBranchGone', values)
}
