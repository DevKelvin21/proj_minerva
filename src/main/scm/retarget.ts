/**
 * Retarget = change a PR's base branch. The only write on a PR itself, so
 * main re-checks everything the UI showed the user and asks the user itself
 * (native dialog, `./confirm.ts`), the same way for every provider:
 *
 * 1. Validate (`validateRetarget`):
 *    - `newBase` differs from the expected current base;
 *    - the PR is still open;
 *    - its base is STILL `expectedCurrentBase`; if someone retargeted it in
 *      the meantime the write is refused with `CONFLICT` (no lost update);
 *    - `newBase` is not the PR's own head branch;
 *    - `newBase` exists on the remote (`NOT_FOUND` otherwise).
 * 2. Confirm: main shows "Retarget PR #N?" with the facts it just read
 *    (repo, title, old base -> new base). Cancel => `{ outcome: 'cancelled' }`.
 * 3. Re-check: the dialog may stay open for minutes, so the PR is read again
 *    (still open, base still the expected one).
 * 4. Write (`updatePullRequestBase`).
 *
 * Never automatic: the IPC call only asks; the user's click in main's dialog
 * is the confirmation.
 */
import { shortRef } from '../../shared/scm'
import type { PullRequestDetail, RetargetRequest, RetargetResult } from '../../shared/types'
import { dialogText, type ConfirmFn } from './confirm'
import { ScmError } from './errors'
import type { ScmProvider } from './provider'

export type RetargetCapable = Pick<
  ScmProvider,
  'getPullRequestDetail' | 'branchExists' | 'updatePullRequestBase'
>

/** What validation established; what the dialog shows. */
export interface RetargetPlan {
  pr: PullRequestDetail
  currentBase: string
  newBase: string
}

/** Open, and still based on `expected`; `CONFLICT` otherwise. */
function assertStillRetargetable(
  pr: PullRequestDetail,
  req: RetargetRequest,
  expected: string,
): string {
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
  return currentBase
}

/** Step 1: every pre-check, no write. */
export async function validateRetarget(
  provider: RetargetCapable,
  req: RetargetRequest,
): Promise<RetargetPlan> {
  const expected = shortRef(req.expectedCurrentBase)
  const newBase = shortRef(req.newBase)
  if (newBase === expected) {
    throw new ScmError('CONFLICT', 'The pull request already targets ' + newBase + '.')
  }

  const pr = await provider.getPullRequestDetail(req.repo, req.number)
  const currentBase = assertStillRetargetable(pr, req, expected)
  if (newBase === shortRef(pr.headRef)) {
    throw new ScmError('CONFLICT', 'A pull request cannot target its own source branch.')
  }
  if (!(await provider.branchExists(req.repo, newBase))) {
    throw new ScmError(
      'NOT_FOUND',
      'Branch ' + newBase + ' does not exist in ' + req.repo.fullName + '.',
    )
  }
  return { pr, currentBase, newBase }
}

/** The dialog text for a plan (only facts main read itself). */
export function retargetConfirmRequest(plan: RetargetPlan): Parameters<ConfirmFn>[0] {
  return {
    message: 'Retarget PR #' + plan.pr.number + '?',
    detail:
      'Repository: ' +
      dialogText(plan.pr.repo.fullName) +
      '\nTitle: ' +
      dialogText(plan.pr.title) +
      '\n\nBase branch: ' +
      dialogText(plan.currentBase) +
      ' → ' +
      dialogText(plan.newBase),
    confirmLabel: 'Retarget',
  }
}

/** Steps 3 and 4: re-read the PR, then write. */
export async function applyRetarget(
  provider: RetargetCapable,
  req: RetargetRequest,
  plan: RetargetPlan,
): Promise<RetargetResult> {
  const fresh = await provider.getPullRequestDetail(req.repo, req.number)
  assertStillRetargetable(fresh, req, plan.currentBase)
  const pr = await provider.updatePullRequestBase(req.repo, req.number, plan.newBase)
  return { outcome: 'retargeted', pr }
}

/** Validate -> confirm -> re-check -> write. */
export async function retargetPullRequest(
  provider: RetargetCapable,
  req: RetargetRequest,
  confirm: ConfirmFn,
): Promise<RetargetResult> {
  const plan = await validateRetarget(provider, req)
  if (!(await confirm(retargetConfirmRequest(plan)))) return { outcome: 'cancelled' }
  return applyRetarget(provider, req, plan)
}
