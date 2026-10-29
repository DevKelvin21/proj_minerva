/**
 * Merge (GitHub) / complete (Azure DevOps) a PR, and turn auto-merge /
 * auto-complete on or off. Writes on a PR, so main re-checks everything the UI
 * showed and asks the user itself (native dialog, `./confirm.ts`), the same
 * way for every provider and the same way as `./retarget.ts`:
 *
 * 1. Validate (`validateMerge` / `validateAutoMerge`):
 *    - the PR is still open;
 *    - its head is STILL `expectedHeadSha` (the commit the user reviewed); new
 *      commits since then are a `CONFLICT` (nothing is written);
 *    - the strategy is one the repository / branch policies allow;
 *    - merge now: nothing blocks it (`MERGE_CONFLICT`, `CHECKS_FAILING`,
 *      `MERGE_BLOCKED`, `FORBIDDEN`);
 *    - auto-merge: the provider offers it for this PR.
 * 2. Confirm: main shows "Merge PR #N?" with the facts it just read (repo,
 *    title, head -> base, strategy, head commit). Cancel => `cancelled`.
 * 3. Re-check: the dialog may stay open for minutes, so the PR is read again
 *    (still open, head unchanged).
 * 4. Write (`mergePullRequest` / `setAutoMerge`), with the head commit passed
 *    on so the server refuses a moved head as well.
 *
 * Never automatic: the IPC call only asks; the user's click in main's dialog
 * is the confirmation.
 */
import { shortRef } from '../../shared/scm'
import type {
  MergeBlocker,
  MergeOptions,
  MergeRequest,
  MergeResult,
  MergeStrategy,
  PullRequestDetail,
  SetAutoMergeRequest,
  SetAutoMergeResult,
} from '../../shared/types'
import { dialogText, type ConfirmFn } from './confirm'
import { ScmError } from './errors'
import { mt } from '../i18n'
import type { ScmProvider } from './provider'

export type MergeCapable = Pick<
  ScmProvider,
  'getPullRequestDetail' | 'getMergeOptions' | 'mergePullRequest' | 'setAutoMerge'
>

/** What validation established; what the dialog shows. */
export interface MergePlan {
  pr: PullRequestDetail
  options: MergeOptions
}

/** Short commit id for messages and dialogs. */
export function shortSha(sha: string): string {
  return sha.slice(0, 7)
}

function sameSha(a: string, b: string): boolean {
  return a.length > 0 && a.toLowerCase() === b.toLowerCase()
}

/** Open, and its head still the commit the user saw; `CONFLICT` otherwise. */
function assertStillMergeable(pr: PullRequestDetail, number: number, expectedHeadSha: string): void {
  if (pr.state !== 'open') {
    throw new ScmError('CONFLICT', mt('scm.merge.notOpen', { number }))
  }
  if (!sameSha(pr.headSha, expectedHeadSha)) {
    throw new ScmError(
      'CONFLICT',
      mt('scm.merge.headMoved', {
        number,
        current: shortSha(pr.headSha),
        expected: shortSha(expectedHeadSha),
      }),
    )
  }
}

/** The typed error for what stops a merge now. */
export function blockerError(blocker: MergeBlocker, pr: PullRequestDetail): ScmError {
  const vars = { number: pr.number, branch: shortRef(pr.baseRef) }
  switch (blocker) {
    case 'not_open':
      return new ScmError('CONFLICT', mt('scm.merge.notOpen', vars))
    case 'no_permission':
      return new ScmError('FORBIDDEN', mt('scm.merge.noPermission', vars))
    case 'conflicts':
      return new ScmError('MERGE_CONFLICT', mt('scm.merge.conflicts', vars))
    case 'checks_failing':
      return new ScmError('CHECKS_FAILING', mt('scm.merge.checksFailing', vars))
    case 'checks_pending':
      return new ScmError('CHECKS_FAILING', mt('scm.merge.checksPending', vars))
    case 'approvals_missing':
      return new ScmError('MERGE_BLOCKED', mt('scm.merge.approvalsMissing', vars))
    case 'draft':
      return new ScmError('MERGE_BLOCKED', mt('scm.merge.draft', vars))
    case 'behind':
      return new ScmError('MERGE_BLOCKED', mt('scm.merge.behind', vars))
    case 'checking':
      return new ScmError('MERGE_BLOCKED', mt('scm.merge.checking', vars))
    case 'blocked':
      return new ScmError('MERGE_BLOCKED', mt('scm.merge.blocked', vars))
  }
}

function assertStrategyAllowed(options: MergeOptions, strategy: MergeStrategy): void {
  const entry = options.strategies.find((item) => item.strategy === strategy)
  if (!entry?.allowed) {
    throw new ScmError(
      'MERGE_BLOCKED',
      mt('scm.merge.strategyNotAllowed', { strategy: mt(`scm.merge.strategy.${strategy}`) }),
    )
  }
}

/** GitHub has no "complete work items"; a request asking for it is refused, not ignored. */
function assertWorkItemsOption(pr: PullRequestDetail, transitionWorkItems: boolean): void {
  if (transitionWorkItems && pr.repo.provider !== 'azure') {
    throw new ScmError('CONFLICT', mt('scm.merge.noWorkItems'))
  }
}

async function readPlan(
  provider: MergeCapable,
  repo: MergeRequest['repo'],
  number: number,
): Promise<MergePlan> {
  const [pr, options] = await Promise.all([
    provider.getPullRequestDetail(repo, number),
    provider.getMergeOptions(repo, number),
  ])
  return { pr, options }
}

// ---------------------------------------------------------------------------
// Merge now
// ---------------------------------------------------------------------------

/** Step 1: every pre-check, no write. */
export async function validateMerge(provider: MergeCapable, req: MergeRequest): Promise<MergePlan> {
  const plan = await readPlan(provider, req.repo, req.number)
  assertStillMergeable(plan.pr, req.number, req.expectedHeadSha)
  assertWorkItemsOption(plan.pr, req.transitionWorkItems)
  assertStrategyAllowed(plan.options, req.strategy)
  if (plan.options.blocker !== null) throw blockerError(plan.options.blocker, plan.pr)
  return plan
}

/** Work items are completed only when the dialog can name them (some were read). */
function completesWorkItems(plan: MergePlan, asked: boolean): boolean {
  return asked && (plan.options.workItems ?? 0) > 0
}

/** Whether the merge will delete the source branch (the repository may do it by itself). */
function deletesBranch(options: MergeOptions, asked: boolean): boolean {
  return options.deleteSourceBranch === 'repo' || (options.deleteSourceBranch === 'option' && asked)
}

/** The facts under the question: repo, title, branches, strategy, head, side effects. */
function planDetail(
  plan: MergePlan,
  strategy: MergeStrategy,
  deleteBranch: boolean,
  transitionWorkItems: boolean,
): string {
  const { pr } = plan
  const lines = [
    dialogText(pr.repo.fullName),
    dialogText(pr.title),
    mt('dialogs.merge.branches', {
      from: dialogText(shortRef(pr.headRef)),
      to: dialogText(shortRef(pr.baseRef)),
    }),
    mt('dialogs.merge.strategyLine', {
      strategy: mt(`scm.merge.strategy.${strategy}`),
      sha: shortSha(pr.headSha),
    }),
  ]
  if (deleteBranch) {
    lines.push(mt('dialogs.merge.deletesBranch', { branch: dialogText(shortRef(pr.headRef)) }))
  }
  if (completesWorkItems(plan, transitionWorkItems)) {
    lines.push(mt('dialogs.merge.completesWorkItems', { count: plan.options.workItems ?? 0 }))
  }
  return lines.join('\n')
}

/** The dialog text for a merge plan (only facts main read itself). */
export function mergeConfirmRequest(plan: MergePlan, req: MergeRequest): Parameters<ConfirmFn>[0] {
  const azure = plan.pr.repo.provider === 'azure'
  return {
    message: mt(azure ? 'dialogs.merge.messageComplete' : 'dialogs.merge.message', {
      number: plan.pr.number,
    }),
    detail: planDetail(
      plan,
      req.strategy,
      deletesBranch(plan.options, req.deleteSourceBranch),
      req.transitionWorkItems,
    ),
    confirmLabel: mt(azure ? 'dialogs.merge.confirmComplete' : 'dialogs.merge.confirm'),
  }
}

/** Steps 3 and 4: re-read the PR, then write. */
export async function applyMerge(
  provider: MergeCapable,
  req: MergeRequest,
  plan: MergePlan,
): Promise<MergeResult> {
  const fresh = await provider.getPullRequestDetail(req.repo, req.number)
  assertStillMergeable(fresh, req.number, req.expectedHeadSha)
  const written = await provider.mergePullRequest({
    repo: req.repo,
    number: req.number,
    headSha: fresh.headSha,
    sourceBranch: shortRef(fresh.headRef),
    strategy: req.strategy,
    // `repo`: the repository deletes it by itself; asking again would fail.
    deleteSourceBranch: plan.options.deleteSourceBranch === 'option' && req.deleteSourceBranch,
    // Only what the dialog said: no work items read = none completed.
    transitionWorkItems: completesWorkItems(plan, req.transitionWorkItems),
  })
  const pr = await provider.getPullRequestDetail(req.repo, req.number)
  if (!written.completed && pr.state === 'open') return { outcome: 'completing', pr }
  return written.branchDeleteFailed
    ? { outcome: 'merged', pr, branchDeleteFailed: true }
    : { outcome: 'merged', pr }
}

/** Validate -> confirm -> re-check -> write. */
export async function mergePullRequest(
  provider: MergeCapable,
  req: MergeRequest,
  confirm: ConfirmFn,
): Promise<MergeResult> {
  const plan = await validateMerge(provider, req)
  if (!(await confirm(mergeConfirmRequest(plan, req)))) return { outcome: 'cancelled' }
  return applyMerge(provider, req, plan)
}

// ---------------------------------------------------------------------------
// Auto-complete / auto-merge
// ---------------------------------------------------------------------------

/** Step 1 for auto-merge: on needs an offer and an allowed strategy; off needs it set. */
export async function validateAutoMerge(
  provider: MergeCapable,
  req: SetAutoMergeRequest,
): Promise<MergePlan> {
  const plan = await readPlan(provider, req.repo, req.number)
  const { pr, options } = plan
  if (pr.state !== 'open') {
    throw new ScmError('CONFLICT', mt('scm.merge.notOpen', { number: req.number }))
  }
  if (!req.enable) {
    if (options.current === null) {
      throw new ScmError('CONFLICT', mt('scm.merge.autoMergeAlreadyOff', { number: req.number }))
    }
    return plan
  }
  assertStillMergeable(pr, req.number, req.expectedHeadSha)
  assertWorkItemsOption(pr, req.transitionWorkItems)
  if (!options.autoMerge.available) {
    const reason = options.autoMerge.reason
    if (reason === 'no_permission') {
      throw new ScmError(
        'FORBIDDEN',
        mt('scm.merge.noPermission', { number: pr.number, branch: shortRef(pr.baseRef) }),
      )
    }
    if (reason === 'not_open') {
      throw new ScmError('CONFLICT', mt('scm.merge.notOpen', { number: req.number }))
    }
    throw new ScmError(
      'MERGE_BLOCKED',
      mt(reason === 'repo_disabled' ? 'scm.merge.autoMergeOff' : 'scm.merge.nothingToWaitFor', {
        repo: pr.repo.fullName,
      }),
    )
  }
  assertStrategyAllowed(options, req.strategy)
  return plan
}

/** The dialog text for turning auto-merge on or off. */
export function autoMergeConfirmRequest(
  plan: MergePlan,
  req: SetAutoMergeRequest,
): Parameters<ConfirmFn>[0] {
  const azure = plan.pr.repo.provider === 'azure'
  const kind = azure ? 'autoComplete' : 'autoMerge'
  const number = plan.pr.number
  if (!req.enable) {
    const current = plan.options.current
    const lines = [dialogText(plan.pr.repo.fullName), dialogText(plan.pr.title)]
    if (current) {
      lines.push(
        mt('dialogs.merge.setBy', {
          name: dialogText(current.setBy.displayName ?? current.setBy.login),
        }),
      )
    }
    return {
      message: mt(`dialogs.${kind}.offMessage`, { number }),
      detail: lines.join('\n'),
      confirmLabel: mt(`dialogs.${kind}.offConfirm`),
    }
  }
  const deleteBranch =
    plan.options.deleteBranchWithAutoMerge && deletesBranch(plan.options, req.deleteSourceBranch)
  return {
    message: mt(`dialogs.${kind}.onMessage`, { number }),
    detail:
      planDetail(plan, req.strategy, deleteBranch, req.transitionWorkItems) +
      '\n' +
      mt(`dialogs.${kind}.onExplain`),
    confirmLabel: mt(`dialogs.${kind}.onConfirm`),
  }
}

/** Steps 3 and 4 for auto-merge. */
export async function applyAutoMerge(
  provider: MergeCapable,
  req: SetAutoMergeRequest,
  plan: MergePlan,
): Promise<SetAutoMergeResult> {
  const fresh = await provider.getPullRequestDetail(req.repo, req.number)
  if (!req.enable) {
    if (fresh.state !== 'open') {
      throw new ScmError('CONFLICT', mt('scm.merge.notOpen', { number: req.number }))
    }
    await provider.setAutoMerge({ repo: req.repo, number: req.number, enable: false })
    return { outcome: 'disabled', pr: await provider.getPullRequestDetail(req.repo, req.number) }
  }
  assertStillMergeable(fresh, req.number, req.expectedHeadSha)
  await provider.setAutoMerge({
    repo: req.repo,
    number: req.number,
    enable: true,
    headSha: fresh.headSha,
    strategy: req.strategy,
    deleteSourceBranch:
      plan.options.deleteBranchWithAutoMerge &&
      plan.options.deleteSourceBranch === 'option' &&
      req.deleteSourceBranch,
    transitionWorkItems: completesWorkItems(plan, req.transitionWorkItems),
  })
  return { outcome: 'enabled', pr: await provider.getPullRequestDetail(req.repo, req.number) }
}

/** Validate -> confirm -> re-check -> write. */
export async function setAutoMerge(
  provider: MergeCapable,
  req: SetAutoMergeRequest,
  confirm: ConfirmFn,
): Promise<SetAutoMergeResult> {
  const plan = await validateAutoMerge(provider, req)
  if (!(await confirm(autoMergeConfirmRequest(plan, req)))) return { outcome: 'cancelled' }
  return applyAutoMerge(provider, req, plan)
}
