/**
 * Retry-once on 401 for the GitHub data path.
 *
 * The token bridge (`./gh-cli-auth.ts`) validates `gh`'s token in its probe,
 * but the token can go stale between a cached `getStatus()` (TTL 5s) and the
 * next real GitHub call — or startup may have warmed the probe before the user
 * finished `gh auth login`. This decorator wraps any GitHub data source so
 * that, ONLY on an `ScmError` with code `UNAUTHENTICATED`, it re-fetches the
 * token from `gh` (`ghCliAuth.refetchTokenAfter401()`) and retries ONCE.
 */
import { ScmError, isScmError } from '../errors'
import { mt } from '../../i18n'
import type { ScmDataSource } from '../provider'
import { ghCliAuth } from './gh-cli-auth'

function isAuthError(error: unknown): boolean {
  return isScmError(error) && error.code === 'UNAUTHENTICATED'
}

async function guarded<Result>(fn: () => Promise<Result>): Promise<Result> {
  try {
    return await fn()
  } catch (error) {
    if (!isAuthError(error)) throw error

    const refreshedToken = await ghCliAuth.refetchTokenAfter401()
    if (refreshedToken === null) {
      throw new ScmError('UNAUTHENTICATED', mt('github.reauth'), { cause: error })
    }

    try {
      return await fn()
    } catch (retryError) {
      // Single retry: a second auth failure (token revoked mid-way, or `gh`
      // points at another account) surfaces as the actionable gh message.
      if (isAuthError(retryError)) {
        throw new ScmError('UNAUTHENTICATED', mt('github.reauth'), { cause: retryError })
      }
      throw retryError
    }
  }
}

/** Wraps every method of `inner` with `guarded()`. */
export function withGhCliTokenRetry(inner: ScmDataSource): ScmDataSource {
  return {
    listPullRequests: (q) => guarded(() => inner.listPullRequests(q)),
    getPullRequestDetail: (repo, number) => guarded(() => inner.getPullRequestDetail(repo, number)),
    getPullRequestFiles: (repo, number) => guarded(() => inner.getPullRequestFiles(repo, number)),
    getCommentThreads: (repo, number) => guarded(() => inner.getCommentThreads(repo, number)),
    postComment: (req) => guarded(() => inner.postComment(req)),
    writeSnapshot: (req, destDir) => guarded(() => inner.writeSnapshot(req, destDir)),
    setThreadStatus: (req) => guarded(() => inner.setThreadStatus(req)),
    getFileContent: (req) => guarded(() => inner.getFileContent(req)),
    branchExists: (repo, branch) => guarded(() => inner.branchExists(repo, branch)),
    updatePullRequestBase: (repo, number, newBase) =>
      guarded(() => inner.updatePullRequestBase(repo, number, newBase)),
    getMergeOptions: (repo, number) => guarded(() => inner.getMergeOptions(repo, number)),
    mergePullRequest: (req) => guarded(() => inner.mergePullRequest(req)),
    setAutoMerge: (req) => guarded(() => inner.setAutoMerge(req)),
    listScopePullRequests: () => guarded(() => inner.listScopePullRequests()),
    listMergedBySourceBranch: (repo, branch) =>
      guarded(() => inner.listMergedBySourceBranch(repo, branch)),
  }
}
