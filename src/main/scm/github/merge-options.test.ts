import { describe, expect, it } from 'vitest'
import { githubBlocker, mapGithubMergeOptions, type GithubMergeNode } from './merge-options'

function node(
  pr: Partial<GithubMergeNode['pullRequest']> = {},
  repo: Partial<GithubMergeNode['repository']> = {},
): GithubMergeNode {
  return {
    repository: {
      mergeCommitAllowed: true,
      squashMergeAllowed: true,
      rebaseMergeAllowed: false,
      autoMergeAllowed: true,
      deleteBranchOnMerge: false,
      viewerPermission: 'WRITE',
      ...repo,
    },
    pullRequest: {
      state: 'OPEN',
      isDraft: false,
      headRefOid: 'a'.repeat(40),
      isCrossRepository: false,
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN',
      reviewDecision: null,
      viewerCanEnableAutoMerge: true,
      autoMergeRequest: null,
      checksState: 'SUCCESS',
      ...pr,
    },
  }
}

describe('githubBlocker', () => {
  it.each([
    [{ mergeStateStatus: 'CLEAN' }, null],
    [{ mergeStateStatus: 'UNSTABLE', checksState: 'FAILURE' }, null],
    [{ mergeStateStatus: 'HAS_HOOKS' }, null],
    [{ state: 'MERGED' }, 'not_open'],
    [{ isDraft: true, mergeStateStatus: 'DRAFT' }, 'draft'],
    [{ mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' }, 'conflicts'],
    [{ mergeStateStatus: 'BLOCKED', checksState: 'FAILURE' }, 'checks_failing'],
    [{ mergeStateStatus: 'BLOCKED', checksState: 'PENDING' }, 'checks_pending'],
    [{ mergeStateStatus: 'BLOCKED', reviewDecision: 'REVIEW_REQUIRED' }, 'approvals_missing'],
    [{ mergeStateStatus: 'BLOCKED' }, 'blocked'],
    [{ mergeStateStatus: 'BEHIND' }, 'behind'],
    [{ mergeStateStatus: 'UNKNOWN', mergeable: 'UNKNOWN' }, 'checking'],
  ] as const)('%o -> %s', (pr, expected) => {
    expect(githubBlocker(node(pr))).toBe(expected)
  })

  it('read-only access is no_permission, before anything else', () => {
    expect(githubBlocker(node({ mergeStateStatus: 'DIRTY' }, { viewerPermission: 'READ' }))).toBe(
      'no_permission',
    )
  })
})

describe('mapGithubMergeOptions', () => {
  it('only the methods the repository allows; a clean PR has nothing to wait for', () => {
    const options = mapGithubMergeOptions(node())
    expect(options.strategies).toEqual([
      { strategy: 'merge', allowed: true },
      { strategy: 'squash', allowed: true },
      { strategy: 'rebase', allowed: false },
    ])
    expect(options.blocker).toBeNull()
    expect(options.autoMerge).toEqual({ available: false, reason: 'nothing_to_wait_for' })
    expect(options.workItems).toBeNull()
    expect(options.deleteBranchWithAutoMerge).toBe(false)
  })

  it('auto-merge: offered while blocked, refused when the repository turns it off', () => {
    const pending = { mergeStateStatus: 'BLOCKED', checksState: 'PENDING' }
    expect(mapGithubMergeOptions(node(pending)).autoMerge).toEqual({ available: true })
    expect(mapGithubMergeOptions(node(pending, { autoMergeAllowed: false })).autoMerge).toEqual({
      available: false,
      reason: 'repo_disabled',
    })
    expect(
      mapGithubMergeOptions(node({ ...pending, viewerCanEnableAutoMerge: false })).autoMerge,
    ).toEqual({ available: false, reason: 'no_permission' })
  })

  it('the auto-merge already set: who and with which method', () => {
    const options = mapGithubMergeOptions(
      node({
        mergeStateStatus: 'BLOCKED',
        checksState: 'PENDING',
        autoMergeRequest: { mergeMethod: 'SQUASH', enabledBy: { login: 'grace', avatarUrl: 'https://x/a.png' } },
      }),
    )
    expect(options.current).toEqual({
      setBy: { login: 'grace', avatarUrl: 'https://x/a.png' },
      strategy: 'squash',
    })
  })

  it('branch deletion: the user chooses, the repository does it, or a fork cannot', () => {
    expect(mapGithubMergeOptions(node()).deleteSourceBranch).toBe('option')
    expect(mapGithubMergeOptions(node({}, { deleteBranchOnMerge: true })).deleteSourceBranch).toBe(
      'repo',
    )
    expect(mapGithubMergeOptions(node({ isCrossRepository: true })).deleteSourceBranch).toBe('none')
  })

  it('optional checks running on a mergeable PR are a warning, not a blocker', () => {
    const options = mapGithubMergeOptions(node({ mergeStateStatus: 'UNSTABLE', checksState: 'PENDING' }))
    expect(options.blocker).toBeNull()
    expect(options.checksWarning).toBe('pending')
  })
})
