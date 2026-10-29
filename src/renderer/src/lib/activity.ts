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
 * Conversation tab; an orphan (its header offers the fix), a vote or a
 * review request on the PR itself.
 */
export function activityTarget(item: ActivityItem): PrFocusTarget {
  if (item.kind !== 'comment') return { kind: 'overview' }
  if (item.isLineThread && item.path && item.line !== undefined) {
    return { kind: 'line', path: item.path, line: item.line, threadId: item.threadId }
  }
  return { kind: 'conversation', threadId: item.threadId }
}

/**
 * `true` when every word of `query` is in the PR (title, repo, #number) or one
 * of its items, as the rows show them: people by display name as well as
 * login, an orphan's parent and branches.
 */
export function matchesActivityQuery(group: ActivityGroup, query: string): boolean {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return true
  const parts = [group.prTitle, group.repo.fullName, '#' + group.number]
  for (const item of group.items) {
    if (item.kind === 'comment') {
      parts.push(item.author.login, item.author.displayName ?? '', item.excerpt, item.path ?? '')
    }
    if (item.kind === 'review') parts.push(item.reviewer.login, item.reviewer.displayName ?? '')
    if (item.kind === 'orphan') {
      parts.push('#' + item.parent.number, item.parent.mergedInto, item.suggestedBase)
    }
  }
  const haystack = parts.join('\n').toLowerCase()
  return tokens.every((token) => haystack.includes(token))
}

/** `src/billing/hook.ts` → `hook.ts` (the full path goes in the tooltip). */
export function fileName(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash >= 0 ? path.slice(slash + 1) : path
}

/** The Inbox's Unread / All switch. */
export type InboxFilter = 'unread' | 'all'

export const INBOX_FILTERS: readonly InboxFilter[] = ['unread', 'all']

/** A remembered choice (localStorage), anything unexpected = the default, Unread. */
export function parseInboxFilter(raw: string | null): InboxFilter {
  return raw === 'all' ? 'all' : 'unread'
}

/**
 * What the Inbox lists: never the items hidden by a pending "Done"; under
 * Unread only unread items, plus the ones `kept` (read while this view was
 * open, so the list does not jump under the pointer).
 */
export function visibleInboxItems(
  items: readonly ActivityItem[],
  filter: InboxFilter,
  kept: ReadonlySet<string>,
  hidden: ReadonlySet<string>,
): ActivityItem[] {
  return items.filter(
    (item) => !hidden.has(item.id) && (filter === 'all' || !item.read || kept.has(item.id)),
  )
}

/**
 * Where focus goes once `removed` leave a list shown in `order`: the first
 * remaining id after the first removed one, else the last remaining one
 * before it; `null` when nothing is left (or nothing in `order` was removed).
 */
export function focusAfterRemoval(
  order: readonly string[],
  removed: ReadonlySet<string>,
): string | null {
  const first = order.findIndex((id) => removed.has(id))
  if (first < 0) return null
  const after = order.slice(first).find((id) => !removed.has(id))
  if (after !== undefined) return after
  const before = order.slice(0, first).filter((id) => !removed.has(id))
  return before.length > 0 ? before[before.length - 1] : null
}
