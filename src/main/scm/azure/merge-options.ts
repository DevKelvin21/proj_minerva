/**
 * Azure DevOps completion facts -> provider-neutral `MergeOptions` (pure,
 * unit tested), plus the strategy mapping both ways.
 *
 * - Allowed merge types come from the "Require a merge strategy" branch
 *   policy (its evaluation carries the configuration's `allow*` settings);
 *   no such policy = every type allowed.
 * - What blocks completion: draft, `mergeStatus` (conflicts / still queued /
 *   failed), then each enabled BLOCKING policy that has not approved: build
 *   and status policies are checks (failing or pending), everything else
 *   (reviewers, comments, work items) is "approvals missing".
 * - Auto-complete is always on offer for an active PR: Azure DevOps lets it be
 *   set at any time, it completes as soon as the policies pass.
 */
import type {
  AutoMergeState,
  MergeBlocker,
  MergeOptions,
  MergeStrategy,
} from '../../../shared/types'
import type {
  AzCompletionOptions,
  AzMergeStrategy,
  AzPolicyEvaluation,
  AzPullRequest,
} from './api-types'
import { mapUser } from './mappers'

/** Well-known policy type ids. */
export const MERGE_STRATEGY_POLICY_TYPE = 'fa4e907d-c16b-4a4c-9dfa-4916e5d171ab'
const BUILD_POLICY_TYPE = '0609b952-1397-4640-95ec-e00a01b2c241'
const STATUS_POLICY_TYPE = 'cbdc66da-9728-4af8-aada-9a5a32e4a226'

const TO_AZURE: Record<MergeStrategy, AzMergeStrategy> = {
  merge: 'noFastForward',
  squash: 'squash',
  rebase: 'rebase',
  rebase_merge: 'rebaseMerge',
}

export function azureMergeStrategy(strategy: MergeStrategy): AzMergeStrategy {
  return TO_AZURE[strategy]
}

export function strategyFromAzure(options: AzCompletionOptions | undefined): MergeStrategy | null {
  switch (options?.mergeStrategy) {
    case 'noFastForward':
      return 'merge'
    case 'squash':
      return 'squash'
    case 'rebase':
      return 'rebase'
    case 'rebaseMerge':
      return 'rebase_merge'
    default:
      return options?.squashMerge ? 'squash' : options ? 'merge' : null
  }
}

/** The auto-complete set on an active PR, with its completion options. */
export function mapAutoComplete(pr: AzPullRequest): AutoMergeState | null {
  if (pr.status !== 'active' || !pr.autoCompleteSetBy) return null
  const options = pr.completionOptions
  const state: AutoMergeState = {
    setBy: mapUser(pr.autoCompleteSetBy),
    strategy: strategyFromAzure(options),
  }
  if (options?.deleteSourceBranch !== undefined) state.deleteSourceBranch = options.deleteSourceBranch
  if (options?.transitionWorkItems !== undefined) {
    state.transitionWorkItems = options.transitionWorkItems
  }
  return state
}

function isMergeStrategyPolicy(evaluation: AzPolicyEvaluation): boolean {
  const type = evaluation.configuration.type
  return type.id === MERGE_STRATEGY_POLICY_TYPE || /merge strategy/i.test(type.displayName)
}

function isCheckPolicy(evaluation: AzPolicyEvaluation): boolean {
  const type = evaluation.configuration.type
  return (
    type.id === BUILD_POLICY_TYPE ||
    type.id === STATUS_POLICY_TYPE ||
    /build|status/i.test(type.displayName)
  )
}

/** Allowed types from the enabled, blocking merge-strategy policy (all allowed without one). */
export function allowedStrategies(evaluations: AzPolicyEvaluation[]): MergeOptions['strategies'] {
  const policy = evaluations.find(
    (evaluation) =>
      evaluation.configuration.isEnabled &&
      evaluation.configuration.isBlocking &&
      isMergeStrategyPolicy(evaluation),
  )
  const settings = policy?.configuration.settings
  const allow = (flag: boolean | undefined): boolean => !policy || flag === true
  return [
    { strategy: 'merge', allowed: allow(settings?.allowNoFastForward) },
    { strategy: 'squash', allowed: allow(settings?.allowSquash) },
    { strategy: 'rebase', allowed: allow(settings?.allowRebase) },
    { strategy: 'rebase_merge', allowed: allow(settings?.allowRebaseMerge) },
  ]
}

function isFailing(evaluation: AzPolicyEvaluation): boolean {
  return evaluation.status === 'rejected' || evaluation.status === 'broken'
}

function isPending(evaluation: AzPolicyEvaluation): boolean {
  return evaluation.status === 'queued' || evaluation.status === 'running'
}

/** What stops completion now (worst first). */
export function azureBlocker(
  pr: AzPullRequest,
  evaluations: AzPolicyEvaluation[],
): MergeBlocker | null {
  if (pr.status !== 'active') return 'not_open'
  if (pr.isDraft) return 'draft'
  if (pr.mergeStatus === 'conflicts') return 'conflicts'
  const blocking = evaluations.filter(
    (evaluation) =>
      evaluation.configuration.isEnabled &&
      evaluation.configuration.isBlocking &&
      !isMergeStrategyPolicy(evaluation),
  )
  const checks = blocking.filter(isCheckPolicy)
  const others = blocking.filter((evaluation) => !isCheckPolicy(evaluation))
  if (checks.some(isFailing)) return 'checks_failing'
  if (others.some((evaluation) => isFailing(evaluation) || isPending(evaluation))) {
    return 'approvals_missing'
  }
  if (checks.some(isPending)) return 'checks_pending'
  if (pr.mergeStatus === 'queued' || pr.mergeStatus === 'notSet' || !pr.mergeStatus) {
    return 'checking'
  }
  if (pr.mergeStatus === 'rejectedByPolicy' || pr.mergeStatus === 'failure') return 'blocked'
  return null
}

/** Optional (non-blocking) checks still running or failing. */
function optionalChecksWarning(evaluations: AzPolicyEvaluation[]): MergeOptions['checksWarning'] {
  const optional = evaluations.filter(
    (evaluation) =>
      evaluation.configuration.isEnabled &&
      !evaluation.configuration.isBlocking &&
      isCheckPolicy(evaluation),
  )
  if (optional.some(isFailing)) return 'failing'
  if (optional.some(isPending)) return 'pending'
  return null
}

export function mapAzureMergeOptions(
  pr: AzPullRequest,
  evaluations: AzPolicyEvaluation[],
  workItems: number,
): MergeOptions {
  const blocker = azureBlocker(pr, evaluations)
  return {
    headSha: pr.lastMergeSourceCommit?.commitId ?? '',
    strategies: allowedStrategies(evaluations),
    blocker,
    checksWarning: blocker === null ? optionalChecksWarning(evaluations) : null,
    deleteSourceBranch: 'option',
    deleteBranchWithAutoMerge: true,
    workItems,
    autoMerge:
      pr.status === 'active' ? { available: true } : { available: false, reason: 'not_open' },
    current: mapAutoComplete(pr),
  }
}
