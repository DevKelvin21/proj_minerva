/**
 * The provider-neutral SCM contract in main. Every provider (GitHub today,
 * Azure DevOps next) implements `ScmProvider`; IPC handlers and the AI layer
 * only talk to this interface, through `./registry.ts`.
 *
 * Rules every implementation follows:
 * - Throw `ScmError` (`./errors.ts`) with a meaningful code; never a bare string.
 * - `getPullRequestFiles` always returns a unified-diff `patch` for text files
 *   (build it in main when the provider has no native patch).
 * - `writeSnapshot` writes HOSTILE content: no symlinks, no paths outside
 *   `destDir`, size caps. It is only read by jailed AI tools, never executed.
 * - Tokens never leave main and never appear in `ScmAuthStatus`.
 * - Writes (comments, thread status, base branch) only happen on explicit
 *   user actions routed through IPC; retarget validation lives in
 *   `./retarget.ts` so it is the same for every provider.
 */
import type { FileContent, RepoRef, ScmAuthStatus, ScmProviderId } from '../../shared/scm'
import type {
  CommentThread,
  DiffFile,
  FileContentRequest,
  PostCommentRequest,
  PrComment,
  PrStateFilter,
  PullRequestDetail,
  PullRequestSummary,
  SetThreadStatusRequest,
} from '../../shared/types'
import type { StackInputPr } from './stacks'

export interface ListPullRequestsQuery {
  search?: string
  state?: PrStateFilter
}

/**
 * One OPEN PR of a provider's scope (see `ScmProvider.listScopePullRequests`):
 * the full summary (with `labels`, `reviewers`, `viewer` when known) plus what
 * only stack detection needs. `headIsFork` stays in main (it never reaches the
 * renderer: the dashboard sends `summary` only).
 */
export interface ScopePullRequest {
  summary: PullRequestSummary
  /**
   * The head branch lives in another repository (GitHub cross-repository
   * PR): its name says nothing about this repo's branches.
   */
  headIsFork?: boolean
}

export interface SnapshotRequest {
  repo: RepoRef
  headSha: string
}

export interface ScmProvider {
  readonly id: ScmProviderId
  getAuthStatus(): Promise<ScmAuthStatus>
  listPullRequests(q: ListPullRequestsQuery): Promise<PullRequestSummary[]>
  getPullRequestDetail(repo: RepoRef, number: number): Promise<PullRequestDetail>
  /** Always a unified `patch` per text file. */
  getPullRequestFiles(repo: RepoRef, number: number): Promise<DiffFile[]>
  getCommentThreads(repo: RepoRef, number: number): Promise<CommentThread[]>
  postComment(req: PostCommentRequest): Promise<PrComment>
  /**
   * Writes a copy of the repo AT `headSha` into `destDir` (already exists,
   * empty). The atomic rename and caching belong to `./snapshot-store.ts`.
   */
  writeSnapshot(req: SnapshotRequest, destDir: string): Promise<void>

  /** Sets a thread's status; answers the updated thread. Status already validated per provider. */
  setThreadStatus(req: SetThreadStatusRequest): Promise<CommentThread>
  /** File text at the PR's merge base or head (capped, see `FileContent`). */
  getFileContent(req: FileContentRequest): Promise<FileContent>

  /** Exact branch match on the remote (`refs/heads/<branch>`). */
  branchExists(repo: RepoRef, branch: string): Promise<boolean>
  /**
   * Raw base-branch change. Call it only through `retargetPullRequest`
   * (`./retarget.ts`), which re-validates first.
   */
  updatePullRequestBase(repo: RepoRef, number: number, newBase: string): Promise<PullRequestSummary>

  /**
   * Every OPEN PR of the configured scope (Azure: configured projects;
   * GitHub: repos the user has open PRs in), not only the ones that involve
   * the user, as full summaries. Feeds both stack detection (a whole chain
   * shows up) and the home dashboard; both read it through the shared
   * short-lived cache in `./scope-cache.ts`, so a cold scope fetch is paid once.
   */
  listScopePullRequests(): Promise<ScopePullRequest[]>
  /**
   * Merged PRs of `repo` whose SOURCE branch is exactly `branch` (exact
   * server-side filter, never a capped "recent" list). Feeds orphan detection.
   */
  listMergedBySourceBranch(repo: RepoRef, branch: string): Promise<StackInputPr[]>
}

/** The data half of a provider (everything but identity and auth). Handy for decorators. */
export type ScmDataSource = Omit<ScmProvider, 'id' | 'getAuthStatus'>
