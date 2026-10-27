/**
 * Retarget = change a PR's base branch. The only write on a PR itself, so
 * main re-checks everything the UI showed the user right before writing,
 * the same way for every provider:
 *
 * 1. `newBase` differs from the expected current base.
 * 2. The PR is still open.
 * 3. Its base is STILL `expectedCurrentBase`; if someone retargeted it in the
 *    meantime the write is refused with `CONFLICT` (no lost update).
 * 4. `newBase` is not the PR's own head branch.
 * 5. `newBase` exists on the remote (`NOT_FOUND` otherwise).
 *
 * Only then `updatePullRequestBase` runs. Never automatic: the IPC channel is
 * the user's confirmation.
 */
import { shortRef } from '../../shared/scm'
import type { PullRequestSummary, RetargetRequest } from '../../shared/types'
import { ScmError } from './errors'
import type { ScmProvider } from './provider'

export type RetargetCapable = Pick<
  ScmProvider,
  'getPullRequestDetail' | 'branchExists' | 'updatePullRequestBase'
>

export async function retargetPullRequest(
  provider: RetargetCapable,
  req: RetargetRequest,
): Promise<PullRequestSummary> {
  const expected = shortRef(req.expectedCurrentBase)
  const newBase = shortRef(req.newBase)
  if (newBase === expected) {
    throw new ScmError('CONFLICT', 'The pull request already targets ' + newBase + '.')
  }

  const pr = await provider.getPullRequestDetail(req.repo, req.number)
  if (pr.state !== 'open') {
    throw new ScmError('CONFLICT', 'Pull request #' + req.number + ' is no longer open.')
  }
  const currentBase = shortRef(pr.baseRef)
  if (currentBase !== expected) {
    throw new ScmError(
      'CONFLICT',
      'Pull request #' +
        req.number +
        ' now targets ' +
        currentBase +
        ', not ' +
        expected +
        '. Refresh and try again.',
    )
  }
  if (newBase === shortRef(pr.headRef)) {
    throw new ScmError('CONFLICT', 'A pull request cannot target its own source branch.')
  }
  if (!(await provider.branchExists(req.repo, newBase))) {
    throw new ScmError(
      'NOT_FOUND',
      'Branch ' + newBase + ' does not exist in ' + req.repo.fullName + '.',
    )
  }
  return provider.updatePullRequestBase(req.repo, req.number, newBase)
}
