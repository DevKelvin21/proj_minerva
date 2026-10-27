/**
 * Grouping, filtering and counting of a PR's comment threads for the Comments
 * view, plus the per-provider rule for which threads accept a status change.
 * Pure.
 */
import { isThreadOpen, SETTABLE_THREAD_STATUSES } from '../../../shared/scm'
import type { ScmProviderId, ThreadStatus } from '../../../shared/scm'
import type { CommentThread } from '../../../shared/types'

/** `open` = active or pending (the default view); `all`; or one exact status. */
export type ThreadFilter = 'open' | 'all' | ThreadStatus

export const THREAD_STATUS_ORDER: readonly ThreadStatus[] = [
  'active',
  'pending',
  'resolved',
  'wont_fix',
  'closed',
  'by_design',
]

export interface ThreadGroup {
  /** File path, or `null` for general (PR-level) threads. */
  path: string | null
  threads: CommentThread[]
}

/** General = not tied to a file (a PR-level comment). File-level threads keep their path. */
export function isGeneralThread(thread: CommentThread): boolean {
  return !thread.path
}

export function matchesThreadFilter(thread: CommentThread, filter: ThreadFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'open') return isThreadOpen(thread.status)
  return thread.status === filter
}

export function filterThreads(
  threads: readonly CommentThread[],
  filter: ThreadFilter,
): CommentThread[] {
  return threads.filter((thread) => matchesThreadFilter(thread, filter))
}

/** Count per filter value; statuses with no thread are present with 0. */
export function countThreadsByFilter(
  threads: readonly CommentThread[],
): Record<ThreadFilter, number> {
  const counts = { open: 0, all: threads.length } as Record<ThreadFilter, number>
  for (const status of THREAD_STATUS_ORDER) counts[status] = 0
  for (const thread of threads) {
    counts[thread.status] += 1
    if (isThreadOpen(thread.status)) counts.open += 1
  }
  return counts
}

/**
 * "General" first, then files alphabetically; inside a file, by line (file-level
 * threads without a line first), then by first comment date.
 */
export function groupThreadsByFile(threads: readonly CommentThread[]): ThreadGroup[] {
  const byPath = new Map<string | null, CommentThread[]>()
  for (const thread of threads) {
    const key = isGeneralThread(thread) ? null : (thread.path ?? null)
    const list = byPath.get(key) ?? []
    list.push(thread)
    byPath.set(key, list)
  }
  const firstDate = (t: CommentThread): string => t.comments[0]?.createdAt ?? ''
  const groups: ThreadGroup[] = [...byPath.entries()].map(([path, list]) => ({
    path,
    threads: [...list].sort(
      (a, b) => (a.line ?? 0) - (b.line ?? 0) || firstDate(a).localeCompare(firstDate(b)),
    ),
  }))
  return groups.sort((a, b) => {
    if (a.path === null) return -1
    if (b.path === null) return 1
    return a.path.localeCompare(b.path)
  })
}

/**
 * Statuses the user can pick for this thread, or `[]` when the thread takes no
 * status (GitHub's general comments are plain issue comments: `issue-…` ids).
 */
export function settableStatusesFor(
  provider: ScmProviderId,
  thread: Pick<CommentThread, 'id' | 'isLineThread'>,
): readonly ThreadStatus[] {
  if (provider === 'github' && (!thread.isLineThread || thread.id.startsWith('issue-'))) return []
  return SETTABLE_THREAD_STATUSES[provider]
}
