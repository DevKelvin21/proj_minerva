/**
 * Submit a review: approve, request changes (Azure DevOps also: approve with
 * suggestions, reject) or a plain comment. A vote can unblock a merge, so it
 * follows the same steps as `./merge.ts` and `./retarget.ts`:
 *
 * 1. Validate (`validateReview`):
 *    - the verdict is one this provider knows (`REVIEW_VERDICTS`) and the
 *      summary is there when the verdict needs one;
 *    - the PR is still open;
 *    - its head is STILL `expectedHeadSha` (the commit the user reviewed);
 *      new commits since then are a `CONFLICT` (nothing is written);
 *    - GitHub: the user is not the author (GitHub refuses a vote on your own
 *      PR; a plain comment is fine).
 * 2. Confirm: a vote gets main's native dialog ("Approve PR #N?") with the
 *    facts main read itself. A plain comment does not (it is no more than
 *    `scm:postComment`, which has no dialog either).
 * 3. Re-check: the dialog may stay open for minutes (still open, head unchanged).
 * 4. Write (`submitReview`), with the head commit passed on (GitHub pins the
 *    review to it).
 *
 * Never automatic: the IPC call only asks.
 */
import {
  REVIEW_VERDICTS,
  reviewVerdictNeedsBody,
  shortRef,
  type ReviewVerdict,
} from '../../shared/scm'
import type { PullRequestDetail, SubmitReviewRequest, SubmitReviewResult } from '../../shared/types'
import { dialogText, type ConfirmFn } from './confirm'
import { ScmError } from './errors'
import { shortSha } from './merge'
import { mt } from '../i18n'
import type { ScmProvider } from './provider'

export type ReviewCapable = Pick<ScmProvider, 'getPullRequestDetail' | 'submitReview'>

/** How much of the summary the dialog quotes. */
const DIALOG_SUMMARY_CHARS = 160

function sameSha(a: string, b: string): boolean {
  return a.length > 0 && a.toLowerCase() === b.toLowerCase()
}

/** Open, and its head still the commit the user saw; `CONFLICT` otherwise. */
function assertStillReviewable(
  pr: PullRequestDetail,
  number: number,
  expectedHeadSha: string,
): void {
  if (pr.state !== 'open') {
    throw new ScmError('CONFLICT', mt('scm.review.notOpen', { number }))
  }
  if (!sameSha(pr.headSha, expectedHeadSha)) {
    throw new ScmError(
      'CONFLICT',
      mt('scm.review.headMoved', {
        number,
        current: shortSha(pr.headSha),
        expected: shortSha(expectedHeadSha),
      }),
    )
  }
}

/** Step 1: every pre-check, no write. Answers the PR as main just read it. */
export async function validateReview(
  provider: ReviewCapable,
  req: SubmitReviewRequest,
): Promise<PullRequestDetail> {
  const provId = req.repo.provider
  if (!REVIEW_VERDICTS[provId].includes(req.verdict)) {
    throw new ScmError('CONFLICT', mt('scm.review.verdictNotAllowed'))
  }
  if (reviewVerdictNeedsBody(provId, req.verdict) && req.body.trim().length === 0) {
    throw new ScmError('CONFLICT', mt('scm.review.bodyRequired'))
  }
  const pr = await provider.getPullRequestDetail(req.repo, req.number)
  assertStillReviewable(pr, req.number, req.expectedHeadSha)
  if (provId === 'github' && req.verdict !== 'comment' && pr.viewer?.isAuthor === true) {
    throw new ScmError('FORBIDDEN', mt('scm.review.ownPullRequest'))
  }
  return pr
}

/** The message / button key of a vote: Azure's -5 reads "Wait for author". */
function voteKey(
  verdict: Exclude<ReviewVerdict, 'comment'>,
  azure: boolean,
): Exclude<ReviewVerdict, 'comment'> | 'changes_requestedAzure' {
  return verdict === 'changes_requested' && azure ? 'changes_requestedAzure' : verdict
}

/** The dialog for a vote (only facts main read itself, untrusted parts sanitized). */
export function reviewConfirmRequest(
  pr: PullRequestDetail,
  req: SubmitReviewRequest & { verdict: Exclude<ReviewVerdict, 'comment'> },
): Parameters<ConfirmFn>[0] {
  const key = voteKey(req.verdict, pr.repo.provider === 'azure')
  const summary = dialogText(req.body, DIALOG_SUMMARY_CHARS)
  return {
    message: mt(`dialogs.review.message.${key}`, { number: pr.number }),
    detail: [
      dialogText(pr.repo.fullName),
      dialogText(pr.title),
      mt('dialogs.merge.branches', {
        from: dialogText(shortRef(pr.headRef)),
        to: dialogText(shortRef(pr.baseRef)),
      }),
      mt('dialogs.review.headLine', { sha: shortSha(pr.headSha) }),
      // The full length too: the dialog quotes only the start of a long summary.
      summary
        ? mt('dialogs.review.summary', { summary, count: req.body.trim().length })
        : mt('dialogs.review.noSummary'),
    ].join('\n'),
    confirmLabel: mt(`dialogs.review.confirm.${key}`),
  }
}

/** Steps 3 and 4: re-read the PR, then write. */
export async function applyReview(
  provider: ReviewCapable,
  req: SubmitReviewRequest,
): Promise<SubmitReviewResult> {
  const fresh = await provider.getPullRequestDetail(req.repo, req.number)
  assertStillReviewable(fresh, req.number, req.expectedHeadSha)
  const written = await provider.submitReview({
    repo: req.repo,
    number: req.number,
    headSha: fresh.headSha,
    verdict: req.verdict,
    body: req.body.trim(),
  })
  // The review landed: a failed read now must not look like a failed review
  // (the user would submit it twice). Without `pr` the renderer refetches.
  const pr = await provider.getPullRequestDetail(req.repo, req.number).catch(() => null)
  return {
    outcome: 'submitted',
    ...(pr ? { pr } : {}),
    ...(written.summaryFailed ? { summaryFailed: true } : {}),
  }
}

/** Validate -> confirm (votes only) -> re-check -> write. */
export async function submitReview(
  provider: ReviewCapable,
  req: SubmitReviewRequest,
  confirm: ConfirmFn,
): Promise<SubmitReviewResult> {
  const pr = await validateReview(provider, req)
  if (req.verdict !== 'comment') {
    const asked = reviewConfirmRequest(pr, { ...req, verdict: req.verdict })
    if (!(await confirm(asked))) return { outcome: 'cancelled' }
  }
  return applyReview(provider, req)
}
