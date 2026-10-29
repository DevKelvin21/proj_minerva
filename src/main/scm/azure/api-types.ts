/**
 * Minimal TypeScript shapes for the Azure DevOps REST responses Minerva uses
 * (api-version 7.1). Only the fields we read are declared; anything Azure may
 * omit is optional. These are wire types: map them to neutral shapes with
 * `./mappers.ts` before they leave the provider.
 */

/** Envelope of most list endpoints (`{ count, value }`). */
export interface AzListResponse<T> {
  count: number
  value: T[]
}

export interface AzIdentityRef {
  id: string
  displayName: string
  /** Email or `DOMAIN\\user`; for service identities a GUID-like name. */
  uniqueName?: string
  imageUrl?: string
  descriptor?: string
  /** True for groups/teams added as reviewers. */
  isContainer?: boolean
}

export interface AzReviewer extends AzIdentityRef {
  /** 10 approved, 5 approved with suggestions, 0 none, -5 waiting for author, -10 rejected. */
  vote: number
  isRequired?: boolean
  hasDeclined?: boolean
  isFlagged?: boolean
}

export interface AzProjectRef {
  id: string
  name: string
  state?: string
}

export interface AzGitRepository {
  id: string
  name: string
  url?: string
  webUrl?: string
  defaultBranch?: string
  isDisabled?: boolean
  project: AzProjectRef
}

export interface AzCommitRef {
  commitId: string
}

export type AzPullRequestStatus = 'notSet' | 'active' | 'abandoned' | 'completed' | 'all'

export type AzMergeStatus =
  'notSet' | 'queued' | 'conflicts' | 'succeeded' | 'rejectedByPolicy' | 'failure'

export interface AzPullRequest {
  pullRequestId: number
  codeReviewId?: number
  status: AzPullRequestStatus
  title: string
  description?: string
  createdBy: AzIdentityRef
  creationDate: string
  closedDate?: string
  /** `refs/heads/feature/x` */
  sourceRefName: string
  /** `refs/heads/main` */
  targetRefName: string
  isDraft?: boolean
  mergeStatus?: AzMergeStatus
  lastMergeSourceCommit?: AzCommitRef
  lastMergeTargetCommit?: AzCommitRef
  lastMergeCommit?: AzCommitRef
  reviewers?: AzReviewer[]
  repository: AzGitRepository
  labels?: { id: string; name: string; active?: boolean }[]
  /** Set when someone turned on auto-complete. */
  autoCompleteSetBy?: AzIdentityRef
  /** How the PR completes (set with auto-complete, or on completion). */
  completionOptions?: AzCompletionOptions
  url?: string
}

export type AzMergeStrategy = 'noFastForward' | 'squash' | 'rebase' | 'rebaseMerge'

export interface AzCompletionOptions {
  mergeStrategy?: AzMergeStrategy
  deleteSourceBranch?: boolean
  transitionWorkItems?: boolean
  /** Legacy flag older PRs carry instead of `mergeStrategy: 'squash'`. */
  squashMerge?: boolean
  bypassPolicy?: boolean
}

export interface AzIteration {
  id: number
  description?: string
  author?: AzIdentityRef
  createdDate: string
  updatedDate?: string
  sourceRefCommit?: AzCommitRef
  targetRefCommit?: AzCommitRef
  commonRefCommit?: AzCommitRef
  hasMoreCommits?: boolean
  /** e.g. `create`, `push`, `forcePush`, `rebase`, `retarget`. */
  reason?: string
}

/**
 * Flag-set rendered as a comma-separated string, e.g. `edit`, `add`,
 * `delete`, `rename`, `edit, rename`, `sourceRename`.
 */
export type AzChangeType = string

export interface AzChangeItem {
  path: string
  /** Blob id at the head side; absent for deletes. */
  objectId?: string
  /** Blob id at the base side; absent for adds. */
  originalObjectId?: string
  isFolder?: boolean
  gitObjectType?: string
}

export interface AzChangeEntry {
  /** Stable per-file id across iterations. Required to post a line comment. */
  changeTrackingId: number
  changeId: number
  item: AzChangeItem
  changeType: AzChangeType
  /** Previous path for renames. */
  originalPath?: string
  sourceServerItem?: string
}

/** Body of `…/iterations/{n}/changes`: paged with `$top`/`$skip`, NOT a continuation header. */
export interface AzIterationChanges {
  changeEntries: AzChangeEntry[]
  nextSkip?: number
  nextTop?: number
}

export interface AzFilePosition {
  line: number
  offset: number
}

export interface AzThreadContext {
  filePath: string
  rightFileStart?: AzFilePosition | null
  rightFileEnd?: AzFilePosition | null
  leftFileStart?: AzFilePosition | null
  leftFileEnd?: AzFilePosition | null
}

export interface AzPullRequestThreadContext {
  changeTrackingId?: number
  iterationContext?: {
    firstComparingIteration: number
    secondComparingIteration: number
  }
  trackingCriteria?: {
    firstComparingIteration?: number
    secondComparingIteration?: number
    origRightFileStart?: AzFilePosition
    origRightFileEnd?: AzFilePosition
    origLeftFileStart?: AzFilePosition
    origLeftFileEnd?: AzFilePosition
    origFilePath?: string
  }
}

export type AzThreadStatus =
  'unknown' | 'active' | 'fixed' | 'wontFix' | 'closed' | 'byDesign' | 'pending'

export type AzCommentType = 'unknown' | 'text' | 'codeChange' | 'system'

export interface AzComment {
  id: number
  /** 0 for the thread's first comment. */
  parentCommentId: number
  author: AzIdentityRef
  content?: string
  publishedDate: string
  lastUpdatedDate?: string
  lastContentUpdatedDate?: string
  commentType: AzCommentType
  isDeleted?: boolean
  usersLiked?: AzIdentityRef[]
}

export interface AzThread {
  id: number
  publishedDate: string
  lastUpdatedDate?: string
  /** Absent on system threads (votes, pushes, policy updates). */
  status?: AzThreadStatus
  /** `null` for PR-level (non-file) threads. */
  threadContext?: AzThreadContext | null
  pullRequestThreadContext?: AzPullRequestThreadContext | null
  comments: AzComment[]
  isDeleted?: boolean
}

/** `GET {org}/_apis/connectionData` */
export interface AzConnectionData {
  authenticatedUser: {
    id: string
    providerDisplayName?: string
    /** Usually carries `Account.$value` = the sign-in email. */
    properties?: Record<string, { $type?: string; $value?: string } | undefined>
  }
  instanceId?: string
}

/** `GET https://vssps.dev.azure.com/{org}/_apis/profile/profiles/me` */
export interface AzProfile {
  id: string
  displayName?: string
  emailAddress?: string
  publicAlias?: string
}

/** `GET git/repositories/{repo}/refs?filter=heads/x` */
export interface AzGitRef {
  /** `refs/heads/x` */
  name: string
  objectId: string
}

export type AzStatusState =
  'notSet' | 'pending' | 'succeeded' | 'failed' | 'error' | 'notApplicable'

/** `GET …/pullRequests/{id}/statuses` */
export interface AzPullRequestStatusEntry {
  id: number
  state: AzStatusState
  description?: string
  context: { name: string; genre?: string }
  targetUrl?: string
  creationDate?: string
  updatedDate?: string
  iterationId?: number
}

export type AzPolicyEvaluationStatus =
  'queued' | 'running' | 'approved' | 'rejected' | 'notApplicable' | 'broken'

/** `GET {org}/{project}/_apis/policy/evaluations?artifactId=…` (7.1-preview) */
export interface AzPolicyEvaluation {
  evaluationId: string
  status: AzPolicyEvaluationStatus
  startedDate?: string
  completedDate?: string
  configuration: {
    id: number
    isBlocking: boolean
    isEnabled: boolean
    type: { id: string; displayName: string }
    /**
     * Build / status policies carry their own display name here; the
     * "Require a merge strategy" policy its allowed types (`allow*`).
     */
    settings?: {
      displayName?: string | null
      allowNoFastForward?: boolean
      allowSquash?: boolean
      allowRebase?: boolean
      allowRebaseMerge?: boolean
    }
  }
}

/** Body of `POST …/pullRequests/{id}/threads` for a new line comment. */
export interface AzCreateThreadBody {
  comments: { parentCommentId: 0; content: string; commentType: 1 }[]
  status: 1
  threadContext?: AzThreadContext
  pullRequestThreadContext?: {
    changeTrackingId: number
    iterationContext: { firstComparingIteration: number; secondComparingIteration: number }
  }
}
