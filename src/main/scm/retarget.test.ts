import { describe, expect, it, vi } from 'vitest'
import { githubRepo } from '../../shared/scm-guards'
import type { PullRequestDetail, PullRequestSummary } from '../../shared/types'
import { retargetPullRequest, type RetargetCapable } from './retarget'

const repo = githubRepo('acme', 'api')

function fakeProvider(
  detail: Partial<PullRequestDetail>,
  branches: string[] = ['main', 'develop'],
) {
  const updatePullRequestBase = vi.fn(
    async (_repo: unknown, number: number, newBase: string) =>
      ({ number, baseRef: newBase }) as PullRequestSummary,
  )
  const provider: RetargetCapable = {
    getPullRequestDetail: vi.fn(
      async () =>
        ({
          state: 'open',
          baseRef: 'feature/parent',
          headRef: 'feature/child',
          ...detail,
        }) as PullRequestDetail,
    ),
    branchExists: vi.fn(async (_repo, branch: string) => branches.includes(branch)),
    updatePullRequestBase,
  }
  return { provider, updatePullRequestBase }
}

const req = { repo, number: 7, expectedCurrentBase: 'feature/parent', newBase: 'main' }

describe('retargetPullRequest', () => {
  it('re-validates, then writes the new base', async () => {
    const { provider, updatePullRequestBase } = fakeProvider({})
    await expect(retargetPullRequest(provider, req)).resolves.toMatchObject({ baseRef: 'main' })
    expect(updatePullRequestBase).toHaveBeenCalledWith(repo, 7, 'main')
  })

  it('refuses with CONFLICT when the base moved since the UI read it', async () => {
    const { provider, updatePullRequestBase } = fakeProvider({ baseRef: 'refs/heads/develop' })
    await expect(retargetPullRequest(provider, req)).rejects.toMatchObject({
      code: 'CONFLICT',
      message: expect.stringContaining('now targets develop'),
    })
    expect(updatePullRequestBase).not.toHaveBeenCalled()
  })

  it('refuses with CONFLICT when the PR is no longer open', async () => {
    for (const state of ['merged', 'closed'] as const) {
      const { provider, updatePullRequestBase } = fakeProvider({ state })
      await expect(retargetPullRequest(provider, req)).rejects.toMatchObject({ code: 'CONFLICT' })
      expect(updatePullRequestBase).not.toHaveBeenCalled()
    }
  })

  it('refuses its own head branch and a no-op', async () => {
    const { provider, updatePullRequestBase } = fakeProvider({}, ['feature/child', 'main'])
    await expect(
      retargetPullRequest(provider, { ...req, newBase: 'feature/child' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    await expect(
      retargetPullRequest(provider, { ...req, newBase: 'feature/parent' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(updatePullRequestBase).not.toHaveBeenCalled()
  })

  it('refuses a new base that does not exist with NOT_FOUND', async () => {
    const { provider, updatePullRequestBase } = fakeProvider({}, ['develop'])
    await expect(retargetPullRequest(provider, req)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(updatePullRequestBase).not.toHaveBeenCalled()
  })
})
