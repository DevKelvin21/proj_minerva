/**
 * Pure helpers of the activity inbox (sidebar Inbox view): grouping items by
 * PR, where an item lands in the review, the local search filter.
 */
import type { ActivityItem } from '../../../shared/activity'
import type { RepoRef } from '../../../shared/scm'
import type { PrFocusTarget } from '../stores/app-store'

export interface ActivityGroup {
  prKey: string
  repo: RepoRef
  number: number
  prTitle: string
  /** Newest first (the order main sends). */
  items: ActivityItem[]
  unreadCount: number
}

/** Items grouped by PR; groups ordered by their newest item, items keep their order. */
export function groupActivity(items: readonly ActivityItem[]): ActivityGroup[] {
  const groups = new Map<string, ActivityGroup>()
  for (const item of items) {
    let group = groups.get(item.prKey)
    if (!group) {
      group = {
        prKey: item.prKey,
        repo: item.repo,
        number: item.number,
        prTitle: item.prTitle,
        items: [],
        unreadCount: 0,
      }
      groups.set(item.prKey, group)
    }
    group.items.push(item)
    if (!item.read) group.unreadCount++
  }
  return [...groups.values()]
}

/**
 * Where an item opens: a line comment at its line in the Files tab, any
 * other comment (conversation, file-level, outdated) highlighted in the
 * Conversation tab, an orphan on the PR itself (its header offers the fix).
 */
export function activityTarget(item: ActivityItem): PrFocusTarget {
  if (item.kind === 'orphan') return { kind: 'overview' }
  if (item.isLineThread && item.path && item.line !== undefined) {
    return { kind: 'line', path: item.path, line: item.line, threadId: item.threadId }
  }
  return { kind: 'conversation', threadId: item.threadId }
}

/** `true` when every word of `query` is in the PR (title, repo, #number) or one of its items. */
export function matchesActivityQuery(group: ActivityGroup, query: string): boolean {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return true
  const parts = [group.prTitle, group.repo.fullName, '#' + group.number]
  for (const item of group.items) {
    if (item.kind === 'comment') parts.push(item.author.login, item.excerpt, item.path ?? '')
  }
  const haystack = parts.join('\n').toLowerCase()
  return tokens.every((token) => haystack.includes(token))
}

/** `src/billing/hook.ts` → `hook.ts` (the full path goes in the tooltip). */
export function fileName(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash >= 0 ? path.slice(slash + 1) : path
}
