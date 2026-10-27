/**
 * Pure helpers for the stacked-PR UI (Stacks view in the sidebar and the
 * stack map in the PR header). The stacks themselves are built in main
 * (`scm:getStacks`); this only locates, groups, filters and explains them.
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

/** A set of stacks shown together: one feature split across repos, or a lone stack. */
export interface StackGroup {
  /** `groupKey` of the stacks, or a key derived from the lone stack's root. */
  key: string
  /** Display label (from the root PR titles), `null` for a lone stack. */
  label: string | null
  stacks: PrStack[]
}

const TRAILING_SEPARATORS = /[\s:\-–—|/,.([]+$/

/**
 * Label of a cross-repo group, from its root PR titles (the `groupKey` is a
 * branch name, which reads badly): the longest common word prefix
 * ("Checkout v2: order status" + "Checkout v2: client models" -> "Checkout v2"),
 * or the first root's title when the titles share nothing useful.
 */
export function groupLabel(rootTitles: readonly string[]): string {
  if (rootTitles.length === 0) return ''
  const words = rootTitles.map((title) => title.trim().split(/\s+/))
  const common: string[] = []
  for (let i = 0; i < words[0].length; i++) {
    const word = words[0][i]
    if (words.every((other) => other[i]?.toLowerCase() === word.toLowerCase())) common.push(word)
    else break
  }
  const label = common.join(' ').replace(TRAILING_SEPARATORS, '')
  return label.length >= 3 ? label : rootTitles[0].trim()
}

/**
 * Groups stacks by `groupKey` (same feature across repos), keeping the order
 * in which each group first appears. Stacks without a `groupKey` stay alone.
 */
export function groupStacks(stacks: readonly PrStack[]): StackGroup[] {
  const groups: StackGroup[] = []
  const byKey = new Map<string, StackGroup>()
  for (const stack of stacks) {
    if (!stack.groupKey) {
      groups.push({ key: 'stack:' + stack.root.prKey, label: null, stacks: [stack] })
      continue
    }
    const existing = byKey.get(stack.groupKey)
    if (existing) existing.stacks.push(stack)
    else {
      const group: StackGroup = { key: 'group:' + stack.groupKey, label: null, stacks: [stack] }
      byKey.set(stack.groupKey, group)
      groups.push(group)
    }
  }
  for (const group of groups) {
    if (group.key.startsWith('group:')) {
      group.label = groupLabel(group.stacks.map((stack) => stack.root.title))
    }
  }
  return groups
}

/** Stacks that contain at least one PR whose key is in `keys`. */
export function stacksContaining(stacks: readonly PrStack[], keys: ReadonlySet<string>): PrStack[] {
  return stacks.filter((stack) => flattenStackNodes(stack.root).some((n) => keys.has(n.prKey)))
}

/**
 * Plain-text filter for the Stacks view: keeps stacks where any PR matches
 * every word of `query` (title, number, branches, repo). Empty query = all.
 */
export function filterStacks(stacks: readonly PrStack[], query: string): PrStack[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return [...stacks]
  return stacks.filter((stack) =>
    flattenStackNodes(stack.root).some((node) => {
      const haystack = [
        node.title,
        '#' + node.number,
        node.headRef,
        node.baseRef,
        stack.repo.fullName,
      ]
        .join(' ')
        .toLowerCase()
      return words.every((word) => haystack.includes(word))
    }),
  )
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
