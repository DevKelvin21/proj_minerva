/**
 * Pure mappers from Azure DevOps wire types (`./api-types.ts`) to the
 * provider-neutral shapes of `shared/types.ts`.
 *
 * Paths: Azure returns repo paths with a leading `/` (`/src/a.ts`); GitHub
 * (and the renderer) use `src/a.ts`. Every path leaving this module is
 * normalized with `toRepoPath`; `toAzurePath` goes the other way.
 */
import {
  isThreadOpen,
  prKey,
  prWebUrl,
  shortRef,
  type AzureRepoRef,
  type ReviewerVote,
  type ThreadStatus,
} from '../../../shared/scm'
import type {
  CiStatus,
  CommentThread,
  PrCheck,
  PrMergeStatus,
  PrComment,
  PrReviewer,
  PullRequestState,
  PullRequestSummary,
  ReviewDecision,
  UserRef,
} from '../../../shared/types'
import type {
  AzChangeEntry,
  AzComment,
  AzGitRepository,
  AzIdentityRef,
  AzMergeStatus,
  AzPolicyEvaluation,
  AzPullRequest,
  AzPullRequestStatus,
  AzPullRequestStatusEntry,
  AzReviewer,
  AzThread,
  AzThreadStatus,
} from './api-types'

export type AzureFileStatus = 'added' | 'removed' | 'modified' | 'renamed'

/** One changed file of an iteration, with the blob ids the patch is built from (provider-internal). */
export interface AzureChange {
  path: string
  previousPath: string | null
  status: AzureFileStatus
  /** Blob ids. `null` on the missing side (add/delete). */
  baseObjectId: string | null
  headObjectId: string | null
  /** Stable per-file id across iterations; required to post a line comment. */
  changeTrackingId: number
}

/**
 * Where a thread is anchored, beyond what `CommentThread` exposes. Used by the
 * provider to decide `isOutdated` (see `isThreadOutdated`).
 */
export interface AzureThreadAnchor {
  /** Iteration pair the thread was created against (`null` for PR-level threads). */
  iteration: { first: number; second: number } | null
  changeTrackingId: number | null
  /**
   * True when the server re-tracked the thread's position onto the iteration
   * we asked for (`threads?$iteration=N` answers `trackingCriteria`).
   */
  tracked: boolean
}

export function toRepoPath(path: string): string {
  return path.replace(/^\/+/, '')
}

/** `src/a.ts` -> `/src/a.ts` (what Azure expects in `threadContext.filePath` and `items?path=`). */
export function toAzurePath(path: string): string {
  return '/' + toRepoPath(path)
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

/**
 * No `avatarUrl`: Azure's `imageUrl` needs the credential, and the renderer
 * must never get one, so the UI falls back to initials.
 */
export function mapUser(identity: AzIdentityRef | undefined | null): UserRef {
  if (!identity) return { login: 'unknown', displayName: 'Unknown' }
  return {
    login: identity.uniqueName || identity.displayName || identity.id,
    displayName: identity.displayName || identity.uniqueName || identity.id,
  }
}

/** 10 approved, 5 with suggestions, 0 none, -5 waiting for author, -10 rejected. */
export function mapVote(vote: number): ReviewerVote {
  if (vote >= 10) return 'approved'
  if (vote > 0) return 'approved_with_suggestions'
  if (vote <= -10) return 'rejected'
  if (vote < 0) return 'changes_requested'
  return 'none'
}

export function mapReviewer(reviewer: AzReviewer): PrReviewer {
  return {
    user: mapUser(reviewer),
    vote: mapVote(reviewer.vote),
    isRequired: reviewer.isRequired === true,
  }
}

/**
 * Overall review decision from the votes (Azure has no single field):
 * any "rejected" vote -> `rejected`; any "waiting for author" vote ->
 * `changes_requested`; a required reviewer without an approval ->
 * `review_required`; at least one approval -> `approved`; no votes -> `null`.
 */
export function mapReviewDecision(reviewers: AzReviewer[] | undefined): ReviewDecision {
  const list = reviewers ?? []
  if (list.some((reviewer) => reviewer.vote <= -10)) return 'rejected'
  if (list.some((reviewer) => reviewer.vote < 0)) return 'changes_requested'
  if (list.some((reviewer) => reviewer.isRequired === true && reviewer.vote <= 0)) {
    return 'review_required'
  }
  if (list.some((reviewer) => reviewer.vote > 0)) return 'approved'
  return null
}

export function mapPrState(status: AzPullRequestStatus): PullRequestState {
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

/** Latest of a set of ISO dates, normalized to `toISOString()` (`''` if none parses). */
export function latestDate(dates: (string | undefined | null)[]): string {
  let bestTime = -Infinity
  for (const date of dates) {
    if (!date) continue
    const t = Date.parse(date)
    if (Number.isFinite(t) && t > bestTime) bestTime = t
  }
  return Number.isFinite(bestTime) ? new Date(bestTime).toISOString() : ''
}

/**
 * @param activityDates extra timestamps known to the caller (latest
 *   iteration `createdDate`, the time a change was observed): Azure's PR
 *   object has no `updatedAt`, so it is derived as the max of everything we
 *   know. Always normalized ISO, so the seen-store's string compare is sound.
 */
export function mapPullRequestSummary(
  pr: AzPullRequest,
  organization: string,
  activityDates: (string | undefined | null)[] = [],
): PullRequestSummary {
  const repo = mapRepo(pr.repository, organization)
  const createdAt = latestDate([pr.creationDate]) || pr.creationDate
  return {
    // `prKey`: globally unique even across organizations (a bare number is not).
    id: prKey(repo, pr.pullRequestId),
    number: pr.pullRequestId,
    title: pr.title,
    author: mapUser(pr.createdBy),
    repo,
    state: mapPrState(pr.status),
    isDraft: pr.isDraft === true,
    createdAt,
    updatedAt: latestDate([pr.creationDate, pr.closedDate, ...activityDates]) || createdAt,
    headRef: shortRef(pr.sourceRefName),
    baseRef: shortRef(pr.targetRefName),
    headSha: pr.lastMergeSourceCommit?.commitId ?? '',
    webUrl: prWebUrl(repo, pr.pullRequestId),
    commentCount: null,
    reviewDecision: mapReviewDecision(pr.reviewers),
    ciStatus: null,
    additions: null,
    deletions: null,
    changedFiles: null,
  }
}

/** PR statuses keep their history: only the latest entry per context counts. */
function latestStatusPerContext(statuses: AzPullRequestStatusEntry[]): AzPullRequestStatusEntry[] {
  const latestByContext = new Map<string, AzPullRequestStatusEntry>()
  for (const status of statuses) {
    const key = (status.context.genre ?? '') + '/' + status.context.name
    const current = latestByContext.get(key)
    const time = Date.parse(status.updatedDate ?? status.creationDate ?? '') || 0
    const currentTime = current
      ? Date.parse(current.updatedDate ?? current.creationDate ?? '') || 0
      : -1
    if (!current || time > currentTime || (time === currentTime && status.id > current.id)) {
      latestByContext.set(key, status)
    }
  }
  return [...latestByContext.values()]
}

/**
 * CI status from PR statuses (latest per context) and policy evaluations
 * (blocking + enabled only; "required reviewers" style policies are not CI
 * and are skipped by type name). Failure beats pending beats success.
 */
export function mapCiStatus(
  statuses: AzPullRequestStatusEntry[],
  evaluations: AzPolicyEvaluation[],
): CiStatus {
  const states: ('success' | 'failure' | 'pending')[] = []

  for (const status of latestStatusPerContext(statuses)) {
    if (status.state === 'succeeded') states.push('success')
    else if (status.state === 'failed' || status.state === 'error') states.push('failure')
    else if (status.state === 'pending') states.push('pending')
  }

  for (const evaluation of evaluations) {
    const config = evaluation.configuration
    if (!config.isEnabled || !config.isBlocking) continue
    const typeName = config.type.displayName.toLowerCase()
    if (!/build|status/.test(typeName)) continue
    if (evaluation.status === 'approved') states.push('success')
    else if (evaluation.status === 'rejected' || evaluation.status === 'broken')
      states.push('failure')
    else if (evaluation.status === 'queued' || evaluation.status === 'running')
      states.push('pending')
  }

  if (states.includes('failure')) return 'failure'
  if (states.includes('pending')) return 'pending'
  if (states.includes('success')) return 'success'
  return null
}

/** `mergeStatus` of the PR; `notSet` / absent = unknown (the UI shows nothing). */
export function mapMergeStatus(status: AzMergeStatus | undefined): PrMergeStatus | undefined {
  switch (status) {
    case 'succeeded':
      return 'clean'
    case 'conflicts':
      return 'conflicts'
    case 'queued':
      return 'checking'
    case 'rejectedByPolicy':
      return 'blocked'
    case 'failure':
      return 'failed'
    default:
      return undefined
  }
}

const POLICY_CHECK_STATUS: Record<AzPolicyEvaluation['status'], PrCheck['status']> = {
  approved: 'success',
  rejected: 'failure',
  broken: 'failure',
  queued: 'pending',
  running: 'pending',
  notApplicable: 'not_applicable',
}

/**
 * Branch policies (enabled ones) and the latest status per context, as a
 * provider-neutral checklist. Blocking policies first, then optional ones,
 * then statuses; names are trimmed and capped (they come from the org).
 */
export function mapChecks(
  statuses: AzPullRequestStatusEntry[],
  evaluations: AzPolicyEvaluation[],
): PrCheck[] {
  const clip = (name: string): string => name.trim().slice(0, 120)
  const policies: PrCheck[] = evaluations
    .filter((evaluation) => evaluation.configuration.isEnabled)
    .map((evaluation) => {
      const config = evaluation.configuration
      const own = config.settings?.displayName
      const name = typeof own === 'string' && own.trim() ? own : config.type.displayName
      return {
        name: clip(name),
        status: POLICY_CHECK_STATUS[evaluation.status] ?? 'pending',
        isBlocking: config.isBlocking,
        kind: 'policy' as const,
      }
    })
    .sort((a, b) => Number(b.isBlocking) - Number(a.isBlocking))

  const posted: PrCheck[] = latestStatusPerContext(statuses).map((status) => ({
    name: clip((status.context.genre ? status.context.genre + '/' : '') + status.context.name),
    status:
      status.state === 'succeeded'
        ? 'success'
        : status.state === 'failed' || status.state === 'error'
          ? 'failure'
          : status.state === 'notApplicable'
            ? 'not_applicable'
            : 'pending',
    isBlocking: false,
    kind: 'status' as const,
  }))
  return [...policies, ...posted]
}

function isUserComment(comment: AzComment): boolean {
  return (
    comment.isDeleted !== true &&
    comment.commentType !== 'system' &&
    Boolean(comment.content?.trim())
  )
}

/** Azure comment ids are per thread (1, 2, ...): the neutral id carries both. */
export function commentKey(threadId: number, commentId: number): string {
  return threadId + '/' + commentId
}

/** Web URL of a thread (Azure deep-links a discussion with `?discussionId=`). */
export function threadWebUrl(repo: AzureRepoRef, prNumber: number, threadId: number): string {
  return prWebUrl(repo, prNumber) + '?discussionId=' + threadId
}

export function mapComment(
  comment: AzComment,
  threadId: number,
  repo: AzureRepoRef,
  prNumber: number,
): PrComment {
  return {
    id: commentKey(threadId, comment.id),
    author: mapUser(comment.author),
    bodyMarkdown: comment.content ?? '',
    createdAt: latestDate([comment.publishedDate]) || comment.publishedDate,
    isMinimized: false,
    htmlUrl: threadWebUrl(repo, prNumber, threadId),
  }
}

export function threadAnchor(thread: AzThread): AzureThreadAnchor {
  const prContext = thread.pullRequestThreadContext ?? null
  return {
    iteration: prContext?.iterationContext
      ? {
          first: prContext.iterationContext.firstComparingIteration,
          second: prContext.iterationContext.secondComparingIteration,
        }
      : null,
    changeTrackingId: prContext?.changeTrackingId ?? null,
    tracked: Boolean(prContext?.trackingCriteria),
  }
}

/**
 * Outdated rule (Azure has no `isOutdated` flag). A LINE thread is outdated
 * when BOTH hold:
 * 1. it was created against an older iteration than the latest one
 *    (`iterationContext.secondComparingIteration < latestIteration`), and
 * 2. its line can't be trusted on the latest diff: the server did NOT
 *    re-track it (we read threads with `$iteration=latest`, and Azure answers
 *    `trackingCriteria` when it moved the anchor onto that iteration), or the
 *    file is no longer part of the latest changes.
 * File-level and PR-level threads are never outdated.
 */
export function isThreadOutdated(
  thread: CommentThread,
  anchor: AzureThreadAnchor,
  latestIteration: number | null,
  latestPaths: ReadonlySet<string> | null,
): boolean {
  if (!thread.isLineThread || !anchor.iteration || latestIteration === null) return false
  if (anchor.iteration.second >= latestIteration) return false
  if (latestPaths && thread.path && !latestPaths.has(thread.path)) return true
  return !anchor.tracked
}

/**
 * Maps one thread, or returns `null` for what a reviewer should not see as a
 * conversation: deleted threads, and system threads (vote changes, pushes,
 * policy updates) which only carry `commentType: 'system'` comments.
 * `isOutdated` is left to the caller (it needs the latest iteration).
 */
export function mapThread(
  thread: AzThread,
  repo: AzureRepoRef,
  prNumber: number,
): CommentThread | null {
  if (thread.isDeleted) return null
  const comments = thread.comments
    .filter(isUserComment)
    .map((comment) => mapComment(comment, thread.id, repo, prNumber))
  if (comments.length === 0) return null

  const context = thread.threadContext ?? null
  let side: 'LEFT' | 'RIGHT' | undefined
  let line: number | undefined
  let lineEnd: number | undefined
  if (context?.rightFileStart) {
    side = 'RIGHT'
    line = context.rightFileStart.line
    lineEnd = context.rightFileEnd?.line ?? line
  } else if (context?.leftFileStart) {
    side = 'LEFT'
    line = context.leftFileStart.line
    lineEnd = context.leftFileEnd?.line ?? line
  }

  const status = mapThreadStatus(thread.status)
  const mapped: CommentThread = {
    id: String(thread.id),
    status,
    isResolved: !isThreadOpen(status),
    isLineThread: line !== undefined,
    comments,
  }
  if (context?.filePath) mapped.path = toRepoPath(context.filePath)
  if (line !== undefined) {
    mapped.line = line
    mapped.side = side
    if (lineEnd !== undefined && lineEnd !== line) mapped.lineEnd = lineEnd
  }
  return mapped
}

export function mapThreads(
  threads: AzThread[],
  repo: AzureRepoRef,
  prNumber: number,
): CommentThread[] {
  return threads
    .map((thread) => mapThread(thread, repo, prNumber))
    .filter((thread): thread is CommentThread => thread !== null)
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
export function mapChangeEntry(entry: AzChangeEntry): AzureChange | null {
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
