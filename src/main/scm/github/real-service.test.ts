/**
 * `RealGithubService` over a fake Octokit (`graphql` answered per operation
 * name): no network, and writes are only ever recorded, never sent.
 */
import { describe, expect, it, vi } from 'vitest'
import { githubRepo } from '../../../shared/scm-guards'
import {
  MAX_PR_FILES,
  RealGithubService,
  githubViewerRelation,
  mapSearchNodeToSummary,
  reviewThreadOrigin,
  type GithubClient,
  type SearchPullRequestNode,
} from './real-service'

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
    if (op === 'PullRequestThreads') {
      const node = (id: string, viewerDidAuthor: boolean) => ({
        id,
        body: id,
        createdAt: '',
        isMinimized: false,
        url: '',
        viewerDidAuthor,
        author: { login: 'someone', avatarUrl: '' },
      })
      return {
        repository: {
          pullRequest: {
            reviewThreads: {
              nodes: [
                { ...thread, comments: { nodes: [node('mine', true), node('theirs', false)] } },
              ],
            },
            comments: { nodes: [node('general', false)] },
          },
        },
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

describe('RealGithubService threads', () => {
  it("marks the user's own comments from viewerDidAuthor", async () => {
    const threads = await service(fakeClient(null).client).getCommentThreads(repo, 7)
    const flags = threads.flatMap((t) => t.comments.map((c) => [c.id, c.isViewer]))
    expect(flags).toEqual([
      ['mine', true],
      ['theirs', undefined],
      ['general', undefined],
    ])
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

function searchNode(
  number: number,
  repoName: string,
  extra: Partial<SearchPullRequestNode> = {},
): SearchPullRequestNode {
  return {
    __typename: 'PullRequest',
    id: 'PR_' + number,
    number,
    title: 'PR ' + number,
    state: 'OPEN',
    isDraft: false,
    url: 'https://github.com/acme/' + repoName + '/pull/' + number,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-0' + (number % 9) + 'T00:00:00Z',
    headRefName: 'feature/' + number,
    baseRefName: 'main',
    additions: 1,
    deletions: 0,
    changedFiles: 1,
    reviewDecision: null,
    author: { login: 'octo', avatarUrl: '' },
    repository: { owner: { login: 'acme' }, name: repoName, nameWithOwner: 'acme/' + repoName },
    comments: { totalCount: 0 },
    lastCommit: { nodes: [] },
    labels: { nodes: [] },
    reviewRequests: { nodes: [] },
    latestReviews: { nodes: [] },
    ...extra,
  }
}

describe('search node -> summary (labels, reviewers, viewer)', () => {
  const node = searchNode(5, 'api', {
    author: { login: 'Octo', avatarUrl: 'a' },
    labels: { nodes: [{ name: 'checkout-v2', color: '14b8a6' }] },
    reviewRequests: {
      nodes: [
        { requestedReviewer: { login: 'me', avatarUrl: 'm' } },
        // A team request has no login (`... on User` only): skipped.
        { requestedReviewer: {} },
        { requestedReviewer: null },
      ],
    },
    latestReviews: {
      nodes: [
        { state: 'APPROVED', author: { login: 'grace', avatarUrl: 'g' } },
        { state: 'COMMENTED', author: { login: 'octo', avatarUrl: 'a' } },
      ],
    },
  })

  it('maps labels with color and reviewers like the detail does', () => {
    const pr = mapSearchNodeToSummary(node, 'ME')
    expect(pr.labels).toEqual([{ name: 'checkout-v2', color: '14b8a6' }])
    expect(pr.reviewers).toEqual([
      { user: { login: 'grace', avatarUrl: 'g' }, vote: 'approved', isRequired: false },
      { user: { login: 'octo', avatarUrl: 'a' }, vote: 'none', isRequired: false },
      { user: { login: 'me', avatarUrl: 'm' }, vote: 'none', isRequired: false },
    ])
    // A pending request: no standing vote.
    expect(pr.viewer).toEqual({ isAuthor: false, reviewer: 'required', vote: 'none' })
  })

  it('omits viewer when the login is unknown', () => {
    expect(mapSearchNodeToSummary(node).viewer).toBeUndefined()
    expect(mapSearchNodeToSummary(node, null).viewer).toBeUndefined()
    expect(mapSearchNodeToSummary(searchNode(6, 'api', { labels: undefined })).labels).toEqual([])
  })

  it('viewer: author, standing review, own review on own PR, uninvolved', () => {
    // Author (case-insensitive); their own COMMENTED review does not make them a reviewer.
    expect(githubViewerRelation('Octo', node, 'octo')).toEqual({ isAuthor: true, reviewer: null })
    // A standing review (no pending request) counts as required, with its vote.
    expect(githubViewerRelation('Octo', node, 'grace')).toEqual({
      isAuthor: false,
      reviewer: 'required',
      vote: 'approved',
    })
    expect(githubViewerRelation('Octo', node, 'someone')).toEqual({
      isAuthor: false,
      reviewer: null,
    })
    expect(githubViewerRelation(undefined, {}, 'me')).toEqual({ isAuthor: false, reviewer: null })
  })

  it('viewer vote: re-requested after approval is none; standing CHANGES_REQUESTED stays', () => {
    const rerequested = {
      reviewRequests: { nodes: [{ requestedReviewer: { login: 'me' } }] },
      latestReviews: { nodes: [{ state: 'APPROVED', author: { login: 'me', avatarUrl: '' } }] },
    }
    expect(githubViewerRelation('octo', rerequested, 'me')).toEqual({
      isAuthor: false,
      reviewer: 'required',
      vote: 'none',
    })
    const changes = {
      reviewRequests: { nodes: [] },
      latestReviews: {
        nodes: [{ state: 'CHANGES_REQUESTED', author: { login: 'ME', avatarUrl: '' } }],
      },
    }
    expect(githubViewerRelation('octo', changes, 'me')).toEqual({
      isAuthor: false,
      reviewer: 'required',
      vote: 'changes_requested',
    })
  })
})

describe('RealGithubService listings carry the viewer from the same query', () => {
  function searchClient(viewer: { login?: string } | null) {
    const queries: string[] = []
    const graphql = vi.fn(async (query: string, vars: { searchQuery: string }) => {
      expect(/query\s+(\w+)/.exec(query)?.[1]).toBe('SearchPullRequests')
      expect(query).toContain('viewer { login }')
      queries.push(vars.searchQuery)
      const nodes = vars.searchQuery.includes('involves:@me')
        ? [searchNode(1, 'api', { author: { login: 'me', avatarUrl: '' } })]
        : [
            searchNode(1, 'api', { author: { login: 'me', avatarUrl: '' } }),
            searchNode(2, 'api', { isCrossRepository: true }),
            searchNode(3, 'api', {
              reviewRequests: { nodes: [{ requestedReviewer: { login: 'me' } }] },
            }),
          ]
      return { viewer, search: { nodes: [...nodes, { __typename: 'Issue' }] } }
    })
    const client = { graphql, rest: {}, request: vi.fn() } as unknown as GithubClient
    return { client, queries }
  }

  it('listPullRequests computes viewer against the token user', async () => {
    const { client } = searchClient({ login: 'me' })
    const prs = await service(client).listPullRequests({ state: 'open' })
    expect(prs.map((pr) => [pr.number, pr.viewer])).toEqual([
      [1, { isAuthor: true, reviewer: null }],
    ])
  })

  it('listScopePullRequests returns full summaries of the repos the user has PRs in', async () => {
    const { client, queries } = searchClient({ login: 'me' })
    const scope = await service(client).listScopePullRequests()
    expect(queries).toEqual([
      'is:pr is:open involves:@me archived:false sort:updated-desc',
      'is:pr is:open archived:false repo:acme/api sort:updated-desc',
    ])
    expect(
      scope.map((item) => [item.summary.number, item.headIsFork, item.summary.viewer]),
    ).toEqual([
      [1, undefined, { isAuthor: true, reviewer: null }],
      [2, true, { isAuthor: false, reviewer: null }],
      [3, undefined, { isAuthor: false, reviewer: 'required', vote: 'none' }],
    ])
  })

  it('no viewer login in the answer -> no viewer field', async () => {
    const { client } = searchClient(null)
    const scope = await service(client).listScopePullRequests()
    expect(scope.every((item) => item.summary.viewer === undefined)).toBe(true)
  })
})

describe('thread origins and reading a file at one', () => {
  const origin = 'ab'.repeat(20)

  it('maps originalCommit and originalStartLine..originalLine, RIGHT side only', () => {
    const node = {
      ...thread,
      isOutdated: true,
      line: null,
      originalLine: 14,
      originalStartLine: 12,
      diffSide: 'RIGHT' as 'LEFT' | 'RIGHT',
      originalCommit: { oid: origin.toUpperCase() } as { oid: string } | null,
    }
    expect(reviewThreadOrigin(node)).toEqual({ commit: origin, line: 12, lineEnd: 14 })
    expect(reviewThreadOrigin({ ...node, originalStartLine: null })).toEqual({
      commit: origin,
      line: 14,
    })
    expect(reviewThreadOrigin({ ...node, diffSide: 'LEFT' })).toBeUndefined()
    expect(reviewThreadOrigin({ ...node, originalCommit: { oid: 'abc1234' } })).toBeUndefined()
    expect(reviewThreadOrigin({ ...node, originalCommit: null })).toBeUndefined()
  })

  function contentClient(prCommits: string[], missing = false) {
    const getContent = vi.fn(async () => {
      if (missing) throw Object.assign(new Error('Not Found'), { status: 404 })
      return {
        data: { type: 'file', size: 4, content: Buffer.from('old\n').toString('base64') },
      }
    })
    const listCommits = vi.fn(async () => ({ data: prCommits.map((sha) => ({ sha })) }))
    const graphql = vi.fn(async () => ({
      repository: {
        pullRequest: {
          reviewThreads: {
            nodes: [{ ...thread, originalCommit: { oid: origin }, comments: { nodes: [] } }],
          },
          comments: { nodes: [] },
        },
      },
    }))
    const client = {
      graphql,
      rest: { repos: { getContent }, pulls: { listCommits } },
      request: vi.fn(),
    } as unknown as GithubClient
    return { client, getContent, listCommits }
  }

  const read = (s: RealGithubService, commit: string) =>
    s.getFileContent({ repo, number: 7, path: 'a.ts', side: 'head', commit })

  it('reads an origin it returned without listing commits', async () => {
    const fake = contentClient([])
    const s = service(fake.client)
    const threads = await s.getCommentThreads(repo, 7)
    expect(threads[0].origin).toEqual({ commit: origin, line: 1 })
    await expect(read(s, origin)).resolves.toMatchObject({ content: 'old\n' })
    expect(fake.listCommits).not.toHaveBeenCalled()
    expect(fake.getContent).toHaveBeenCalledWith(expect.objectContaining({ ref: origin }))
  })

  it("accepts one of the PR's commits, and refuses any other before reading", async () => {
    const other = 'cd'.repeat(20)
    const fake = contentClient([other])
    const s = service(fake.client)
    await expect(read(s, other)).resolves.toMatchObject({ content: 'old\n' })
    await expect(read(s, 'ef'.repeat(20))).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'That commit is not part of this pull request.',
    })
    expect(fake.getContent).toHaveBeenCalledTimes(1)
  })

  it('says in one sentence that the file does not exist at that version', async () => {
    const fake = contentClient([origin], true)
    await expect(read(service(fake.client), origin)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'a.ts does not exist in that version.',
    })
  })
})
