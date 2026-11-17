/**
 * `RealGithubService.submitReview` over a fake Octokit: the event, the pinned
 * head commit and the body that are sent, and how GitHub's refusals map to
 * typed codes. Writes are only recorded, never sent. Also: the PR detail
 * carries the `viewer` relation (what the Review control keys on).
 */
import { describe, expect, it, vi } from 'vitest'
import { githubRepo } from '../../../shared/scm-guards'
import type { ReviewWrite } from '../provider'
import { RealGithubService, mapGithubReviewError, type GithubClient } from './real-service'

const repo = githubRepo('acme', 'api')
const HEAD = 'a'.repeat(40)

function httpError(status: number, message: string) {
  return Object.assign(new Error(message), { status, response: { data: { message }, headers: {} } })
}

function fakeClient(options: { reviewError?: unknown } = {}) {
  const createReview = vi.fn(async (_params: Record<string, unknown>) => {
    if (options.reviewError) throw options.reviewError
    return { data: { id: 1, state: 'APPROVED' } }
  })
  const graphql = vi.fn(async (query: string) => {
    if (/query\s+PullRequestDetail\b/.test(query)) {
      return {
        viewer: { login: 'Me' },
        repository: {
          pullRequest: {
            id: 'PR_1',
            number: 7,
            title: 'Add refunds',
            body: '',
            state: 'OPEN',
            isDraft: false,
            url: 'https://github.com/acme/api/pull/7',
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-02T00:00:00Z',
            headRefName: 'feature/refunds',
            baseRefName: 'main',
            author: { login: 'someone', avatarUrl: '' },
            reviewRequests: { nodes: [] },
            latestReviews: {
              nodes: [{ state: 'APPROVED', author: { login: 'me', avatarUrl: '' } }],
            },
            lastCommit: { nodes: [{ commit: { oid: HEAD, statusCheckRollup: null } }] },
          },
        },
      }
    }
    return {}
  })
  const client = {
    graphql,
    rest: { pulls: { createReview } },
    request: vi.fn(),
  } as unknown as GithubClient
  return { client, createReview }
}

function service(client: GithubClient): RealGithubService {
  return new RealGithubService(
    () => 'token',
    () => client,
  )
}

const approve: ReviewWrite = { repo, number: 7, headSha: HEAD, verdict: 'approved', body: '' }

describe('RealGithubService.submitReview', () => {
  it('approve: APPROVE pinned to the reviewed head, no body when there is none', async () => {
    const { client, createReview } = fakeClient()
    await expect(service(client).submitReview(approve)).resolves.toEqual({})
    expect(createReview).toHaveBeenCalledWith({
      owner: 'acme',
      repo: 'api',
      pull_number: 7,
      commit_id: HEAD,
      event: 'APPROVE',
    })
  })

  it('request changes and comment send their event and the summary', async () => {
    const { client, createReview } = fakeClient()
    await service(client).submitReview({ ...approve, verdict: 'changes_requested', body: 'Fix x' })
    await service(client).submitReview({ ...approve, verdict: 'comment', body: 'Notes' })
    expect(createReview.mock.calls.map(([params]) => [params.event, params.body])).toEqual([
      ['REQUEST_CHANGES', 'Fix x'],
      ['COMMENT', 'Notes'],
    ])
  })

  it('an Azure-only verdict never reaches GitHub', async () => {
    const { client, createReview } = fakeClient()
    await expect(
      service(client).submitReview({ ...approve, verdict: 'rejected' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(createReview).not.toHaveBeenCalled()
  })

  it('maps refusals: your own PR is FORBIDDEN, a stale commit CONFLICT, 401 UNAUTHENTICATED', async () => {
    const own = httpError(422, 'Unprocessable Entity: Can not approve your own pull request')
    const stale = httpError(422, 'commit_id is not part of the pull request')
    await expect(
      service(fakeClient({ reviewError: own }).client).submitReview(approve),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(
      service(fakeClient({ reviewError: stale }).client).submitReview(approve),
    ).rejects.toMatchObject({ code: 'CONFLICT', message: expect.stringContaining('commit_id') })
    expect(mapGithubReviewError(httpError(401, 'Bad credentials'), 'acme/api').code).toBe(
      'UNAUTHENTICATED',
    )
  })
})

describe('RealGithubService.getPullRequestDetail viewer', () => {
  it('computes the viewer relation from the token user (case-insensitive)', async () => {
    const { client } = fakeClient()
    const detail = await service(client).getPullRequestDetail(repo, 7)
    expect(detail.viewer).toEqual({ isAuthor: false, reviewer: 'required', vote: 'approved' })
  })
})
