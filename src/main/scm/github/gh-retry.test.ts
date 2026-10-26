import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GithubRepoRef } from '../../../shared/scm'
import { ScmError } from '../errors'
import type { ScmDataSource } from '../provider'

/**
 * `gh-retry.ts` depends on `ghCliAuth.refetchTokenAfter401()` to refresh the
 * `gh` token on a 401 — mocked to drive every scenario without spawning `gh`.
 */
const refetchTokenAfter401Mock = vi.fn()
vi.mock('./gh-cli-auth', () => ({
  ghCliAuth: { refetchTokenAfter401: (...args: unknown[]) => refetchTokenAfter401Mock(...args) },
}))

const { withGhCliTokenRetry } = await import('./gh-retry')

const REAUTH = "Not authenticated with GitHub CLI: run 'gh auth login' in a terminal and retry."

function authError(): ScmError {
  return new ScmError(
    'UNAUTHENTICATED',
    'Not authenticated: the GitHub token is invalid or expired.',
  )
}

const validRepo: GithubRepoRef = {
  provider: 'github',
  owner: 'octocat',
  name: 'hello-world',
  fullName: 'octocat/hello-world',
}

function makeFakeService(overrides: Partial<ScmDataSource> = {}): ScmDataSource {
  return {
    listPullRequests: vi.fn().mockResolvedValue([]),
    getPullRequestDetail: vi.fn().mockResolvedValue({}),
    getPullRequestFiles: vi.fn().mockResolvedValue([]),
    getCommentThreads: vi.fn().mockResolvedValue([]),
    postComment: vi.fn().mockResolvedValue({}),
    writeSnapshot: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

describe('withGhCliTokenRetry', () => {
  beforeEach(() => {
    refetchTokenAfter401Mock.mockReset()
  })

  it('401 -> successful refetch -> single retry succeeds', async () => {
    refetchTokenAfter401Mock.mockResolvedValue('ghp_new_token')
    const listPullRequests = vi
      .fn()
      .mockRejectedValueOnce(authError())
      .mockResolvedValueOnce([{ id: 'pr1' }])
    const wrapped = withGhCliTokenRetry(makeFakeService({ listPullRequests }))

    await expect(wrapped.listPullRequests({})).resolves.toEqual([{ id: 'pr1' }])
    expect(listPullRequests).toHaveBeenCalledTimes(2)
    expect(refetchTokenAfter401Mock).toHaveBeenCalledTimes(1)
  })

  it('401 -> refetch returns null -> actionable UNAUTHENTICATED error, no retry', async () => {
    refetchTokenAfter401Mock.mockResolvedValue(null)
    const listPullRequests = vi.fn().mockRejectedValue(authError())
    const wrapped = withGhCliTokenRetry(makeFakeService({ listPullRequests }))

    const error = await wrapped.listPullRequests({}).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ScmError)
    expect((error as ScmError).code).toBe('UNAUTHENTICATED')
    expect((error as ScmError).message).toBe(REAUTH)
    expect(listPullRequests).toHaveBeenCalledTimes(1)
  })

  it('401 on the retry does NOT retry again (single retry)', async () => {
    refetchTokenAfter401Mock.mockResolvedValue('ghp_new_token')
    const listPullRequests = vi.fn().mockRejectedValue(authError())
    const wrapped = withGhCliTokenRetry(makeFakeService({ listPullRequests }))

    await expect(wrapped.listPullRequests({})).rejects.toThrow(REAUTH)
    expect(listPullRequests).toHaveBeenCalledTimes(2)
    expect(refetchTokenAfter401Mock).toHaveBeenCalledTimes(1)
  })

  it('non-auth errors pass through untouched, without refetch or retry', async () => {
    const rateLimitError = new ScmError('RATE_LIMITED', 'GitHub rate limit reached')
    const plainError = new Error('boom')
    for (const thrown of [rateLimitError, plainError]) {
      refetchTokenAfter401Mock.mockReset()
      const listPullRequests = vi.fn().mockRejectedValue(thrown)
      const wrapped = withGhCliTokenRetry(makeFakeService({ listPullRequests }))

      await expect(wrapped.listPullRequests({})).rejects.toBe(thrown)
      expect(listPullRequests).toHaveBeenCalledTimes(1)
      expect(refetchTokenAfter401Mock).not.toHaveBeenCalled()
    }
  })

  it('a direct success (no 401) never refetches', async () => {
    const wrapped = withGhCliTokenRetry(
      makeFakeService({ getPullRequestDetail: vi.fn().mockResolvedValue({ id: 'd1' }) }),
    )

    await expect(wrapped.getPullRequestDetail(validRepo, 1)).resolves.toEqual({ id: 'd1' })
    expect(refetchTokenAfter401Mock).not.toHaveBeenCalled()
  })

  it('wraps all 6 data methods with the same retry', async () => {
    refetchTokenAfter401Mock.mockResolvedValue('ghp_new_token')
    const calls: Record<keyof ScmDataSource, (w: ScmDataSource) => Promise<unknown>> = {
      listPullRequests: (w) => w.listPullRequests({}),
      getPullRequestDetail: (w) => w.getPullRequestDetail(validRepo, 1),
      getPullRequestFiles: (w) => w.getPullRequestFiles(validRepo, 1),
      getCommentThreads: (w) => w.getCommentThreads(validRepo, 1),
      postComment: (w) => w.postComment({ repo: validRepo, number: 1, bodyMarkdown: 'hi' }),
      writeSnapshot: (w) => w.writeSnapshot({ repo: validRepo, headSha: 'abc' }, '/tmp/x'),
    }

    for (const [method, call] of Object.entries(calls)) {
      const fn = vi.fn().mockRejectedValueOnce(authError()).mockResolvedValueOnce('ok')
      const wrapped = withGhCliTokenRetry(makeFakeService({ [method]: fn }))

      await expect(call(wrapped)).resolves.toBe('ok')
      expect(fn).toHaveBeenCalledTimes(2)
    }
  })
})
