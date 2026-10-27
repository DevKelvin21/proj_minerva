/**
 * `RealGithubService` over a fake Octokit (`graphql` answered per operation
 * name): no network, and writes are only ever recorded, never sent.
 */
import { describe, expect, it, vi } from 'vitest'
import { githubRepo } from '../../../shared/scm-guards'
import { MAX_PR_FILES, RealGithubService, type GithubClient } from './real-service'

const repo = githubRepo('acme', 'api')

function detailNode(changedFiles: number) {
  return {
    id: 'PR_1',
    number: 7,
    title: 'Big one',
    body: '',
    state: 'OPEN',
    isDraft: false,
    url: 'https://github.com/acme/api/pull/7',
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-02T00:00:00Z',
    headRefName: 'feature/x',
    baseRefName: 'main',
    additions: 1,
    deletions: 1,
    changedFiles,
    reviewDecision: null,
    author: { login: 'octo', avatarUrl: '' },
    comments: { totalCount: 0 },
    commitCount: { totalCount: 1 },
    lastCommit: { nodes: [] },
    labels: { nodes: [] },
    reviewRequests: { nodes: [] },
    latestReviews: { nodes: [] },
  }
}

const thread = {
  id: 'PRRT_1',
  isResolved: true,
  isOutdated: false,
  path: 'a.ts',
  line: 1,
  originalLine: 1,
  diffSide: 'RIGHT',
  comments: { nodes: [] },
}

function fakeClient(owner: { number: number; nameWithOwner: string } | null, changedFiles = 3) {
  const ops: string[] = []
  const graphql = vi.fn(async (query: string) => {
    const op = /(query|mutation)\s+(\w+)/.exec(query)?.[2] ?? 'unknown'
    ops.push(op)
    if (op === 'PullRequestDetail') return { repository: { pullRequest: detailNode(changedFiles) } }
    if (op === 'ReviewThreadOwner') {
      return {
        node: owner
          ? {
              __typename: 'PullRequestReviewThread',
              pullRequest: {
                number: owner.number,
                repository: { nameWithOwner: owner.nameWithOwner },
              },
            }
          : null,
      }
    }
    if (op === 'ResolveReviewThread') return { resolveReviewThread: { thread } }
    if (op === 'AddReviewThreadReply') {
      return {
        addPullRequestReviewThreadReply: {
          comment: {
            id: 'C',
            body: 'ok',
            createdAt: '',
            isMinimized: false,
            url: '',
            author: null,
          },
        },
      }
    }
    throw new Error('unexpected ' + op)
  })
  const client = { graphql, rest: {}, request: vi.fn() } as unknown as GithubClient
  return { client, ops }
}

function service(client: GithubClient): RealGithubService {
  return new RealGithubService(
    () => 'token',
    () => client,
  )
}

describe('RealGithubService detail', () => {
  it('flags filesTruncated when the PR has more files than the files API is paged to', async () => {
    const big = await service(fakeClient(null, MAX_PR_FILES + 212).client).getPullRequestDetail(
      repo,
      7,
    )
    expect(big).toMatchObject({ changedFiles: 512, filesTruncated: true })
    const small = await service(fakeClient(null, MAX_PR_FILES).client).getPullRequestDetail(repo, 7)
    expect(small.filesTruncated).toBeUndefined()
  })
})

describe('RealGithubService thread writes are scoped to repo#number', () => {
  it('resolves a thread that belongs to the PR', async () => {
    const { client, ops } = fakeClient({ number: 7, nameWithOwner: 'ACME/api' })
    await expect(
      service(client).setThreadStatus({ repo, number: 7, threadId: 'PRRT_1', status: 'resolved' }),
    ).resolves.toMatchObject({ id: 'PRRT_1', isResolved: true })
    expect(ops).toEqual(['ReviewThreadOwner', 'ResolveReviewThread'])
  })

  it('refuses a thread of another PR, another repo, or not a thread, before any mutation', async () => {
    for (const owner of [
      { number: 8, nameWithOwner: 'acme/api' },
      { number: 7, nameWithOwner: 'evil/api' },
      null,
    ]) {
      const { client, ops } = fakeClient(owner)
      await expect(
        service(client).setThreadStatus({
          repo,
          number: 7,
          threadId: 'PRRT_x',
          status: 'resolved',
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' })
      await expect(
        service(client).postComment({ repo, number: 7, threadId: 'PRRT_x', bodyMarkdown: 'hi' }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' })
      expect(ops).toEqual(['ReviewThreadOwner', 'ReviewThreadOwner'])
    }
  })

  it('replies to a thread that belongs to the PR', async () => {
    const { client, ops } = fakeClient({ number: 7, nameWithOwner: 'acme/api' })
    await service(client).postComment({ repo, number: 7, threadId: 'PRRT_1', bodyMarkdown: 'hi' })
    expect(ops).toEqual(['ReviewThreadOwner', 'AddReviewThreadReply'])
  })
})
