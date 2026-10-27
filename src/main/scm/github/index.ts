/**
 * The GitHub `ScmProvider`.
 *
 * Data: mock with `MINERVA_MOCK=1` (`./mock-service.ts`), otherwise Octokit
 * (`./real-service.ts`) wrapped with the 401 retry (`./gh-retry.ts`). The real
 * service reads the token per call from the `gh` token bridge, so it never has
 * to learn about account switches.
 *
 * Auth: always the real `gh` probe (`./gh-cli-auth.ts`), even with mock data —
 * the Settings screen still shows what `gh` reports on this machine — unless
 * `MINERVA_MOCK_GH_AUTH` forces a state (mock mode only, see `mockAuthOverride`).
 */

/** Login the mock reports when `MINERVA_MOCK_GH_AUTH=signed_in`. */
const MOCK_GH_LOGIN = 'mgarcia'

function mockGhStatus(override: MockAuthOverride): ScmAuthStatus {
  if (override === 'signed_in') {
    return { provider: 'github', state: 'signed_in', user: { login: MOCK_GH_LOGIN } }
  }
  if (override === 'cli_unavailable') {
    return { provider: 'github', state: 'cli_unavailable', detail: mt('github.cliNotFound') }
  }
  return { provider: 'github', state: 'cli_unauthenticated', detail: mt('github.noSession') }
}

/** A forced signed-out mock lists nothing, like the real provider without a session. */
function mockGhListError(override: MockAuthOverride): ScmError | null {
  if (override === 'cli_unavailable')
    return new ScmError('CLI_UNAVAILABLE', mt('github.cliNotFound'))
  if (override === 'unauthenticated') return new ScmError('UNAUTHENTICATED', mt('github.noSession'))
  return null
}
import type { ScmAuthStatus } from '../../../shared/scm'
import { ScmError } from '../errors'
import { mt } from '../../i18n'
import { isMockScmMode, mockAuthOverride, type MockAuthOverride } from '../mock-mode'
import type { ScmDataSource, ScmProvider } from '../provider'
import { ghCliAuth } from './gh-cli-auth'
import { withGhCliTokenRetry } from './gh-retry'
import { MockGithubService } from './mock-service'
import { RealGithubService } from './real-service'

export function createGithubProvider(): ScmProvider {
  const data: ScmDataSource = isMockScmMode()
    ? new MockGithubService()
    : withGhCliTokenRetry(new RealGithubService(() => ghCliAuth.getTokenSync()))
  const override = mockAuthOverride('MINERVA_MOCK_GH_AUTH')
  const listError = override ? mockGhListError(override) : null
  return {
    id: 'github',
    getAuthStatus: () =>
      override ? Promise.resolve(mockGhStatus(override)) : ghCliAuth.getStatus(),
    listPullRequests: (q) => (listError ? Promise.reject(listError) : data.listPullRequests(q)),
    getPullRequestDetail: (repo, number) => data.getPullRequestDetail(repo, number),
    getPullRequestFiles: (repo, number) => data.getPullRequestFiles(repo, number),
    getCommentThreads: (repo, number) => data.getCommentThreads(repo, number),
    postComment: (req) => data.postComment(req),
    writeSnapshot: (req, destDir) => data.writeSnapshot(req, destDir),
    setThreadStatus: (req) => data.setThreadStatus(req),
    getFileContent: (req) => data.getFileContent(req),
    branchExists: (repo, branch) => data.branchExists(repo, branch),
    updatePullRequestBase: (repo, number, newBase) =>
      data.updatePullRequestBase(repo, number, newBase),
    listStackCandidates: () => data.listStackCandidates(),
    listMergedBySourceBranch: (repo, branch) => data.listMergedBySourceBranch(repo, branch),
  }
}
