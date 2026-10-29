import { describe, expect, it } from 'vitest'
import type { AzPolicyEvaluation, AzPullRequest } from './api-types'
import {
  MERGE_STRATEGY_POLICY_TYPE,
  allowedStrategies,
  azureBlocker,
  azureMergeStrategy,
  mapAutoComplete,
  strategyFromAzure,
} from './merge-options'

function pr(overrides: Partial<AzPullRequest> = {}): AzPullRequest {
  return {
    pullRequestId: 1,
    status: 'active',
    title: 'x',
    createdBy: { id: 'u1', displayName: 'Ada' },
    creationDate: '2026-10-01T00:00:00Z',
    sourceRefName: 'refs/heads/feature/x',
    targetRefName: 'refs/heads/main',
    mergeStatus: 'succeeded',
    repository: { id: 'r', name: 'r', project: { id: 'p', name: 'p' } },
    ...overrides,
  }
}

function policy(
  typeName: string,
  status: AzPolicyEvaluation['status'],
  isBlocking = true,
  extra: Partial<AzPolicyEvaluation['configuration']> = {},
): AzPolicyEvaluation {
  return {
    evaluationId: typeName,
    status,
    configuration: {
      id: 1,
      isBlocking,
      isEnabled: true,
      type: { id: 'type-' + typeName, displayName: typeName },
      ...extra,
    },
  }
}

describe('azureBlocker', () => {
  it('nothing pending and a clean merge status: ready', () => {
    expect(azureBlocker(pr(), [policy('Build', 'approved')])).toBeNull()
  })

  it.each([
    [pr({ status: 'completed' }), [], 'not_open'],
    [pr({ isDraft: true }), [], 'draft'],
    [pr({ mergeStatus: 'conflicts' }), [], 'conflicts'],
    [pr(), [policy('Build', 'rejected')], 'checks_failing'],
    [pr(), [policy('Build', 'running')], 'checks_pending'],
    [pr(), [policy('Minimum number of reviewers', 'rejected')], 'approvals_missing'],
    [pr(), [policy('Required reviewers', 'running'), policy('Build', 'queued')], 'approvals_missing'],
    [pr({ mergeStatus: 'queued' }), [], 'checking'],
    [pr({ mergeStatus: 'rejectedByPolicy' }), [], 'blocked'],
  ] as const)('%#: %s', (request, evaluations, expected) => {
    expect(azureBlocker(request, [...evaluations])).toBe(expected)
  })

  it('optional (non-blocking) policies never block', () => {
    expect(azureBlocker(pr(), [policy('Build', 'rejected', false)])).toBeNull()
  })
})

describe('allowedStrategies', () => {
  it('every type without a merge-strategy policy', () => {
    expect(allowedStrategies([]).every((item) => item.allowed)).toBe(true)
  })

  it("the policy's allow* settings, by type id", () => {
    const evaluation = policy('anything', 'approved', true, {
      type: { id: MERGE_STRATEGY_POLICY_TYPE, displayName: 'Require a merge strategy' },
      settings: { allowSquash: true, allowRebaseMerge: true },
    })
    expect(allowedStrategies([evaluation])).toEqual([
      { strategy: 'merge', allowed: false },
      { strategy: 'squash', allowed: true },
      { strategy: 'rebase', allowed: false },
      { strategy: 'rebase_merge', allowed: true },
    ])
  })
})

describe('strategy mapping', () => {
  it('round-trips every strategy, and reads the legacy squashMerge flag', () => {
    for (const strategy of ['merge', 'squash', 'rebase', 'rebase_merge'] as const) {
      expect(strategyFromAzure({ mergeStrategy: azureMergeStrategy(strategy) })).toBe(strategy)
    }
    expect(strategyFromAzure({ squashMerge: true })).toBe('squash')
    expect(strategyFromAzure(undefined)).toBeNull()
  })

  it('auto-complete only on an active PR, with its completion options', () => {
    const setBy = { id: 'u1', displayName: 'Ada', uniqueName: 'ada@x' }
    expect(
      mapAutoComplete(
        pr({
          autoCompleteSetBy: setBy,
          completionOptions: { mergeStrategy: 'rebaseMerge', deleteSourceBranch: false },
        }),
      ),
    ).toEqual({
      setBy: { login: 'ada@x', displayName: 'Ada' },
      strategy: 'rebase_merge',
      deleteSourceBranch: false,
    })
    expect(mapAutoComplete(pr({ status: 'completed', autoCompleteSetBy: setBy }))).toBeNull()
  })
})
