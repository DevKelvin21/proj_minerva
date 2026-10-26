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
 */
import type { RepoRef, ScmAuthStatus, ScmProviderId } from '../../shared/scm'
import type {
  CommentThread,
  DiffFile,
  PostCommentRequest,
  PrComment,
  PrStateFilter,
  PullRequestDetail,
  PullRequestSummary,
} from '../../shared/types'

export interface ListPullRequestsQuery {
  search?: string
  state?: PrStateFilter
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
}

/** The data half of a provider (everything but identity and auth). Handy for decorators. */
export type ScmDataSource = Omit<ScmProvider, 'id' | 'getAuthStatus'>
