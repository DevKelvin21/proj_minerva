/**
 * The GitHub `ScmProvider`.
 *
 * Data: mock with `MINERVA_MOCK=1` (`./mock-service.ts`), otherwise Octokit
 * (`./real-service.ts`) wrapped with the 401 retry (`./gh-retry.ts`). The real
 * service reads the token per call from the `gh` token bridge, so it never has
 * to learn about account switches.
 *
 * Auth: always the real `gh` probe (`./gh-cli-auth.ts`), even with mock data —
 * the Settings screen still shows what `gh` reports on this machine.
 */
import { isMockScmMode } from '../mock-mode'
import type { ScmDataSource, ScmProvider } from '../provider'
import { ghCliAuth } from './gh-cli-auth'
import { withGhCliTokenRetry } from './gh-retry'
import { MockGithubService } from './mock-service'
import { RealGithubService } from './real-service'

export function createGithubProvider(): ScmProvider {
  const data: ScmDataSource = isMockScmMode()
    ? new MockGithubService()
    : withGhCliTokenRetry(new RealGithubService(() => ghCliAuth.getTokenSync()))
  return {
    id: 'github',
    getAuthStatus: () => ghCliAuth.getStatus(),
    listPullRequests: (q) => data.listPullRequests(q),
    getPullRequestDetail: (repo, number) => data.getPullRequestDetail(repo, number),
    getPullRequestFiles: (repo, number) => data.getPullRequestFiles(repo, number),
    getCommentThreads: (repo, number) => data.getCommentThreads(repo, number),
    postComment: (req) => data.postComment(req),
    writeSnapshot: (req, destDir) => data.writeSnapshot(req, destDir),
  }
}
