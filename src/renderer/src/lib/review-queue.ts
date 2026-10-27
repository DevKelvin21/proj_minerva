import type { PullRequestSummary } from '../../../shared/types'
import { needsMyReview, type ViewerIdentity } from './dashboard'

/**
 * The sidebar's Queue view: the open PRs in scope sorted by what they need
 * from the signed-in user. Every PR lands in exactly one section, first
 * match wins: needs your review › updated since you looked › yours › your
 * review is optional › the rest. Built from the dashboard answer, whose
 * `viewer` (author / reviewer + own vote) and `unread` main already resolved
 * by identity. "Needs your review" is Home's own rule (`needsMyReview`:
 * required reviewer, no vote yet), so the counts never disagree.
 */
export type QueueSection = 'needsReview' | 'updated' | 'mine' | 'optional' | 'rest'

export const QUEUE_SECTIONS: readonly QueueSection[] = [
  'needsReview',
  'updated',
  'mine',
  'optional',
  'rest',
]

/** The one status worth showing on a queue row (`null` = nothing to add). */
export type QueueStatus =
  | 'optional'
  | 'newComments'
  | 'newCommits'
  | 'draft'
  | 'ciFailing'
  | 'changesRequested'
  | 'approved'
  | 'waiting'
  | null

export interface QueueEntry {
  pr: PullRequestSummary
  status: QueueStatus
}

export type ReviewQueue = Record<QueueSection, QueueEntry[]>

/** `true` when every word of `query` is in the PR's title, repo, number, branch or author. */
export function matchesQueueQuery(pr: PullRequestSummary, query: string): boolean {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return true
  const haystack = [pr.title, pr.repo.fullName, '#' + pr.number, pr.headRef, pr.author.login]
    .join('\n')
    .toLowerCase()
  return tokens.every((token) => haystack.includes(token))
}

/** Optional reviewer who has not voted yet. */
function optionalReview(pr: PullRequestSummary): boolean {
  if (pr.viewer?.reviewer !== 'optional' || pr.viewer.isAuthor) return false
  return pr.viewer.vote === undefined || pr.viewer.vote === 'none'
}

function involved(pr: PullRequestSummary): boolean {
  return Boolean(pr.viewer && (pr.viewer.isAuthor || pr.viewer.reviewer !== null))
}

/** New comments or commits since the user last looked. A PR never opened is not "updated". */
function unreadStatus(pr: PullRequestSummary): QueueStatus {
  if (pr.unread?.hasNewComments) return 'newComments'
  if (pr.unread?.hasUpdates) return 'newCommits'
  return null
}

/** The status of one of the user's own PRs: what stands between it and the merge. */
function authoredStatus(pr: PullRequestSummary): QueueStatus {
  if (pr.isDraft) return 'draft'
  if (pr.ciStatus === 'failure') return 'ciFailing'
  if (pr.reviewDecision === 'changes_requested' || pr.reviewDecision === 'rejected')
    return 'changesRequested'
  if (pr.reviewDecision === 'approved') return 'approved'
  return 'waiting'
}

const byNewest = (a: QueueEntry, b: QueueEntry): number =>
  b.pr.updatedAt.localeCompare(a.pr.updatedAt)

export function buildReviewQueue(
  pullRequests: readonly PullRequestSummary[],
  identity: ViewerIdentity,
  query = '',
): ReviewQueue {
  const queue: ReviewQueue = { needsReview: [], updated: [], mine: [], optional: [], rest: [] }
  for (const pr of pullRequests) {
    if (!matchesQueueQuery(pr, query)) continue
    if (needsMyReview(pr, identity)) {
      queue.needsReview.push({ pr, status: pr.isDraft ? 'draft' : null })
      continue
    }
    const unread = unreadStatus(pr)
    if (unread && involved(pr)) {
      queue.updated.push({ pr, status: unread })
      continue
    }
    if (pr.viewer?.isAuthor) {
      queue.mine.push({ pr, status: authoredStatus(pr) })
      continue
    }
    if (optionalReview(pr)) {
      queue.optional.push({ pr, status: 'optional' })
      continue
    }
    queue.rest.push({ pr, status: null })
  }
  // Reviews: the oldest first, it has waited longest.
  const byOldest = (a: QueueEntry, b: QueueEntry): number =>
    a.pr.createdAt.localeCompare(b.pr.createdAt)
  queue.needsReview.sort(byOldest)
  queue.optional.sort(byOldest)
  queue.updated.sort(byNewest)
  queue.mine.sort(byNewest)
  queue.rest.sort(byNewest)
  return queue
}
