import { describe, expect, it } from 'vitest'
import type { MergeOptions } from '../../../shared/types'
import { describeMergeError, initialStrategy } from './merge'

function options(overrides: Partial<MergeOptions> = {}): MergeOptions {
  return {
    headSha: 'a'.repeat(40),
    strategies: [
      { strategy: 'merge', allowed: false },
      { strategy: 'squash', allowed: true },
      { strategy: 'rebase', allowed: true },
    ],
    blocker: null,
    checksWarning: null,
    deleteSourceBranch: 'option',
    deleteBranchWithAutoMerge: false,
    workItems: null,
    autoMerge: { available: true },
    current: null,
    ...overrides,
  }
}

describe('initialStrategy', () => {
  it('the first allowed one, or the auto-merge one when it is allowed', () => {
    expect(initialStrategy(options())).toBe('squash')
    expect(
      initialStrategy(options({ current: { setBy: { login: 'a' }, strategy: 'rebase' } })),
    ).toBe('rebase')
    expect(
      initialStrategy(options({ current: { setBy: { login: 'a' }, strategy: 'merge' } })),
    ).toBe('squash')
    expect(
      initialStrategy(options({ strategies: [{ strategy: 'merge', allowed: false }] })),
    ).toBeNull()
  })
})

describe('describeMergeError', () => {
  it.each([
    ['CONFLICT', 'stale', true],
    ['MERGE_CONFLICT', 'conflicts', true],
    ['CHECKS_FAILING', 'checks', true],
    ['MERGE_BLOCKED', 'blocked', true],
    ['FORBIDDEN', 'forbidden', false],
    ['UNAUTHENTICATED', 'signIn', false],
    ['NETWORK', 'other', false],
  ])('[SCM:%s] -> %s (refresh: %s)', (code, reason, shouldRefresh) => {
    const error = new Error(
      "Error invoking remote method 'scm:merge': Error: [SCM:" + code + '] Main says why.',
    )
    expect(describeMergeError(error)).toEqual({
      code,
      detail: 'Main says why.',
      reason,
      shouldRefresh,
    })
  })
})
