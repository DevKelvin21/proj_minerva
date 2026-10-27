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
import { mt } from '../i18n'
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
    throw new ScmError('CONFLICT', mt('scm.retarget.notOpen', { number: req.number }))
  }
  const currentBase = shortRef(pr.baseRef)
  if (currentBase !== expected) {
    throw new ScmError(
      'CONFLICT',
      mt('scm.retarget.baseMoved', { number: req.number, current: currentBase, expected }),
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
    throw new ScmError('CONFLICT', mt('scm.retarget.alreadyTargets', { branch: newBase }))
  }

  const pr = await provider.getPullRequestDetail(req.repo, req.number)
  const currentBase = assertStillRetargetable(pr, req, expected)
  if (newBase === shortRef(pr.headRef)) {
    throw new ScmError('CONFLICT', mt('scm.retarget.ownSource'))
  }
  if (!(await provider.branchExists(req.repo, newBase))) {
    throw new ScmError(
      'NOT_FOUND',
      mt('scm.retarget.branchMissing', { branch: newBase, repo: req.repo.fullName }),
    )
  }
  return { pr, currentBase, newBase }
}

/** The dialog text for a plan (only facts main read itself). */
export function retargetConfirmRequest(plan: RetargetPlan): Parameters<ConfirmFn>[0] {
  return {
    message: mt('dialogs.retarget.message', { number: plan.pr.number }),
    detail: mt('dialogs.retarget.detail', {
      repo: dialogText(plan.pr.repo.fullName),
      title: dialogText(plan.pr.title),
      from: dialogText(plan.currentBase),
      to: dialogText(plan.newBase),
    }),
    confirmLabel: mt('dialogs.retarget.confirm'),
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
