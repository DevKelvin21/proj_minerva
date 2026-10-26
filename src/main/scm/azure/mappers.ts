/**
 * Pure mappers from Azure DevOps wire types (`./api-types.ts`) to
 * provider-neutral shapes. The output interfaces here are LOCAL and minimal,
 * mirroring the planned neutral types; Phase 2 adapts them to the final
 * `shared/` types once the SCM layer refactor lands.
 *
 * Paths: Azure returns repo paths with a leading `/` (`/src/a.ts`); GitHub
 * (and the renderer) use `src/a.ts`. Every path leaving this module is
 * normalized with `toRepoPath`.
 */
import {
  prKey,
  prWebUrl,
  shortRef,
  type AzureRepoRef,
  type ReviewerVote,
  type ThreadStatus,
} from '../../../shared/scm'
import type {
  AzChangeEntry,
  AzComment,
  AzGitRepository,
  AzIdentityRef,
  AzPullRequest,
  AzPullRequestStatus,
  AzReviewer,
  AzThread,
  AzThreadStatus,
} from './api-types'

export interface AzureUserLite {
  /** Unique name (usually the email); falls back to the display name. */
  login: string
  displayName: string
  id: string
  avatarUrl?: string
}

export interface AzureReviewerLite extends AzureUserLite {
  vote: ReviewerVote
  isRequired: boolean
  /** A group/team added as reviewer, not a person. */
  isGroup: boolean
}

export interface AzurePrSummaryLite {
  /** `prKey(repo, number)` */
  id: string
  number: number
  title: string
  author: { login: string; displayName: string }
  repo: AzureRepoRef
  state: 'open' | 'closed' | 'merged'
  isDraft: boolean
  createdAt: string
  updatedAt: string
  headRef: string
  baseRef: string
  /** `lastMergeSourceCommit.commitId`; `null` while Azure has not computed it. */
  headSha: string | null
  webUrl: string
  reviewers: AzureReviewerLite[]
}

export interface AzureCommentLite {
  id: number
  /** `null` for the first comment of a thread. */
  parentId: number | null
  author: AzureUserLite
  body: string
  createdAt: string
  updatedAt: string
}

export interface AzureThreadLite {
  id: number
  status: ThreadStatus
  /** Anchored to a line range (vs. file-level or PR-level). */
  isLineThread: boolean
  /** Repo-relative path; `null` for PR-level threads. */
  path: string | null
  line: number | null
  lineEnd: number | null
  /** RIGHT = head (new) side, LEFT = base (old) side. */
  side: 'LEFT' | 'RIGHT' | null
  /** Iteration pair the line numbers refer to (see Phase 2 notes on line drift). */
  iteration: { first: number; second: number } | null
  changeTrackingId: number | null
  createdAt: string
  updatedAt: string
  comments: AzureCommentLite[]
}

export type AzureFileStatus = 'added' | 'removed' | 'modified' | 'renamed'

export interface AzureChangeLite {
  path: string
  previousPath: string | null
  status: AzureFileStatus
  /** Blob ids. `null` on the missing side (add/delete). */
  baseObjectId: string | null
  headObjectId: string | null
  changeTrackingId: number
}

export function toRepoPath(path: string): string {
  return path.replace(/^\/+/, '')
}

export function mapRepo(repo: AzGitRepository, organization: string): AzureRepoRef {
  return {
    provider: 'azure',
    organization,
    project: repo.project.name,
    name: repo.name,
    repositoryId: repo.id,
    fullName: organization + '/' + repo.project.name + '/' + repo.name,
  }
}

export function mapUser(identity: AzIdentityRef | undefined | null): AzureUserLite {
  if (!identity) return { login: 'unknown', displayName: 'Unknown', id: '' }
  const user: AzureUserLite = {
    login: identity.uniqueName || identity.displayName || identity.id,
    displayName: identity.displayName || identity.uniqueName || identity.id,
    id: identity.id,
  }
  if (identity.imageUrl) user.avatarUrl = identity.imageUrl
  return user
}

/** 10 approved, 5 with suggestions, 0 none, -5 waiting for author, -10 rejected. */
export function mapVote(vote: number): ReviewerVote {
  if (vote >= 10) return 'approved'
  if (vote > 0) return 'approved_with_suggestions'
  if (vote <= -10) return 'rejected'
  if (vote < 0) return 'changes_requested'
  return 'none'
}

export function mapReviewer(reviewer: AzReviewer): AzureReviewerLite {
  return {
    ...mapUser(reviewer),
    vote: mapVote(reviewer.vote),
    isRequired: reviewer.isRequired === true,
    isGroup: reviewer.isContainer === true,
  }
}

export function mapPrState(status: AzPullRequestStatus): 'open' | 'closed' | 'merged' {
  if (status === 'completed') return 'merged'
  if (status === 'abandoned') return 'closed'
  return 'open'
}

const THREAD_STATUS_FROM_AZURE: Record<AzThreadStatus, ThreadStatus> = {
  unknown: 'active',
  active: 'active',
  pending: 'pending',
  fixed: 'resolved',
  wontFix: 'wont_fix',
  closed: 'closed',
  byDesign: 'by_design',
}

const THREAD_STATUS_TO_AZURE: Record<ThreadStatus, Exclude<AzThreadStatus, 'unknown'>> = {
  active: 'active',
  pending: 'pending',
  resolved: 'fixed',
  wont_fix: 'wontFix',
  closed: 'closed',
  by_design: 'byDesign',
}

export function mapThreadStatus(status: AzThreadStatus | undefined): ThreadStatus {
  return status ? (THREAD_STATUS_FROM_AZURE[status] ?? 'active') : 'active'
}

/** For `PATCH …/threads/{id}` `{ status }`. */
export function threadStatusToAzure(status: ThreadStatus): Exclude<AzThreadStatus, 'unknown'> {
  return THREAD_STATUS_TO_AZURE[status]
}

function latest(dates: (string | undefined | null)[]): string {
  let best = ''
  let bestTime = -Infinity
  for (const date of dates) {
    if (!date) continue
    const t = Date.parse(date)
    if (Number.isFinite(t) && t > bestTime) {
      best = date
      bestTime = t
    }
  }
  return best
}

/**
 * @param activityDates extra timestamps known to the caller (latest
 *   iteration `createdDate`, threads' `lastUpdatedDate`): Azure's PR object
 *   has no `updatedAt`, so it is derived as the max of everything we know.
 */
export function mapPullRequestSummary(
  pr: AzPullRequest,
  organization: string,
  activityDates: (string | undefined | null)[] = [],
): AzurePrSummaryLite {
  const repo = mapRepo(pr.repository, organization)
  const author = mapUser(pr.createdBy)
  return {
    id: prKey(repo, pr.pullRequestId),
    number: pr.pullRequestId,
    title: pr.title,
    author: { login: author.login, displayName: author.displayName },
    repo,
    state: mapPrState(pr.status),
    isDraft: pr.isDraft === true,
    createdAt: pr.creationDate,
    updatedAt: latest([pr.creationDate, pr.closedDate, ...activityDates]) || pr.creationDate,
    headRef: shortRef(pr.sourceRefName),
    baseRef: shortRef(pr.targetRefName),
    headSha: pr.lastMergeSourceCommit?.commitId ?? null,
    webUrl: prWebUrl(repo, pr.pullRequestId),
    reviewers: (pr.reviewers ?? []).map(mapReviewer),
  }
}

function isUserComment(comment: AzComment): boolean {
  return (
    comment.isDeleted !== true &&
    comment.commentType !== 'system' &&
    Boolean(comment.content?.trim())
  )
}

function mapComment(comment: AzComment): AzureCommentLite {
  return {
    id: comment.id,
    parentId: comment.parentCommentId > 0 ? comment.parentCommentId : null,
    author: mapUser(comment.author),
    body: comment.content ?? '',
    createdAt: comment.publishedDate,
    updatedAt: comment.lastContentUpdatedDate || comment.lastUpdatedDate || comment.publishedDate,
  }
}

/**
 * Maps one thread, or returns `null` for what a reviewer should not see as a
 * conversation: deleted threads, and system threads (vote changes, pushes,
 * policy updates) which only carry `commentType: 'system'` comments.
 */
export function mapThread(thread: AzThread): AzureThreadLite | null {
  if (thread.isDeleted) return null
  const comments = thread.comments.filter(isUserComment).map(mapComment)
  if (comments.length === 0) return null

  const context = thread.threadContext ?? null
  let side: AzureThreadLite['side'] = null
  let line: number | null = null
  let lineEnd: number | null = null
  if (context?.rightFileStart) {
    side = 'RIGHT'
    line = context.rightFileStart.line
    lineEnd = context.rightFileEnd?.line ?? line
  } else if (context?.leftFileStart) {
    side = 'LEFT'
    line = context.leftFileStart.line
    lineEnd = context.leftFileEnd?.line ?? line
  }

  const prContext = thread.pullRequestThreadContext ?? null
  const iteration = prContext?.iterationContext
    ? {
        first: prContext.iterationContext.firstComparingIteration,
        second: prContext.iterationContext.secondComparingIteration,
      }
    : null

  return {
    id: thread.id,
    status: mapThreadStatus(thread.status),
    isLineThread: line !== null,
    path: context?.filePath ? toRepoPath(context.filePath) : null,
    line,
    lineEnd,
    side,
    iteration,
    changeTrackingId: prContext?.changeTrackingId ?? null,
    createdAt: thread.publishedDate,
    updatedAt: thread.lastUpdatedDate || thread.publishedDate,
    comments,
  }
}

export function mapThreads(threads: AzThread[]): AzureThreadLite[] {
  return threads.map(mapThread).filter((thread): thread is AzureThreadLite => thread !== null)
}

/** `changeType` is a flag set such as `edit, rename`. */
export function mapChangeStatus(changeType: string): AzureFileStatus {
  const flags = changeType.split(',').map((flag) => flag.trim().toLowerCase())
  if (flags.includes('add')) return 'added'
  if (flags.includes('delete')) return 'removed'
  if (flags.some((flag) => flag === 'rename' || flag === 'sourcerename')) return 'renamed'
  return 'modified'
}

/** Folder entries are dropped; they have no content to diff. */
export function mapChangeEntry(entry: AzChangeEntry): AzureChangeLite | null {
  if (entry.item.isFolder || entry.item.gitObjectType === 'tree') return null
  const status = mapChangeStatus(entry.changeType)
  return {
    path: toRepoPath(entry.item.path),
    previousPath: entry.originalPath ? toRepoPath(entry.originalPath) : null,
    status,
    baseObjectId:
      status === 'added'
        ? null
        : (entry.item.originalObjectId ??
          (status === 'removed' ? entry.item.objectId : undefined) ??
          null),
    headObjectId: status === 'removed' ? null : (entry.item.objectId ?? null),
    changeTrackingId: entry.changeTrackingId,
  }
}
