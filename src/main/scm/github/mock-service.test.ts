/**
 * The GitHub mock's summaries (home dashboard): labels, reviewers and the
 * viewer relation against the mock "me", which is also the login the mock
 * auth reports (`MINERVA_MOCK_GH_AUTH=signed_in`).
 */
import { describe, expect, it } from 'vitest'
import { MOCK_GITHUB_LOGIN } from './fixtures'
import { MockGithubService } from './mock-service'

const author = { isAuthor: true, reviewer: null }
const required = (vote: string) => ({ isAuthor: false, reviewer: 'required', vote })
const none = { isAuthor: false, reviewer: null }

describe('MockGithubService summaries', () => {
  it('"me" is mgarcia', () => {
    expect(MOCK_GITHUB_LOGIN).toBe('mgarcia')
  })

  it('scope = every open PR, with the viewer relation', async () => {
    const scope = await new MockGithubService().listScopePullRequests()
    const byKey = Object.fromEntries(
      scope.map(({ summary }) => [summary.repo.fullName + '#' + summary.number, summary.viewer]),
    )
    expect(byKey).toEqual({
      'shopwave/api#482': author,
      'shopwave/api#479': required('none'),
      'shopwave/api#470': author,
      'shopwave/web#201': required('none'),
      'shopwave/web#198': none,
      'shopwave/web#190': none,
      // mgarcia requested changes on #77.
      'shopwave/checkout-service#77': required('changes_requested'),
      'shopwave/checkout-service#74': author,
    })
  })

  it('summaries carry labels and reviewers but no detail-only fields', async () => {
    const prs = await new MockGithubService().listPullRequests({ state: 'all' })
    expect(prs.length).toBeGreaterThan(0)
    for (const pr of prs) {
      expect(pr).not.toHaveProperty('bodyMarkdown')
      expect(pr).not.toHaveProperty('commits')
      expect(Array.isArray(pr.labels)).toBe(true)
      expect(Array.isArray(pr.reviewers)).toBe(true)
      expect(pr.viewer).toBeDefined()
    }
    const endpointRepos = new Set(
      prs
        .filter((pr) => pr.state === 'open' && pr.labels?.some((l) => l.name === 'endpoint'))
        .map((pr) => pr.repo.name),
    )
    expect([...endpointRepos].sort()).toEqual(['api', 'checkout-service'])
  })

  it('summaries are fresh objects (the watcher keeps what it gets)', async () => {
    const service = new MockGithubService()
    const [first] = await service.listPullRequests({})
    const [again] = await service.listPullRequests({})
    expect(again).not.toBe(first)
    expect(again).toEqual(first)
  })
})

describe('MockGithubService comments', () => {
  const api = {
    provider: 'github' as const,
    owner: 'shopwave',
    name: 'api',
    fullName: 'shopwave/api',
  }

  it("marks the mock user's comments as the viewer's", async () => {
    const threads = await new MockGithubService().getCommentThreads(api, 482)
    const flags = threads.flatMap((t) =>
      t.comments.map((c) => [c.author.login, c.isViewer === true]),
    )
    expect(flags).toEqual([
      ['dkumar', false],
      ['mgarcia', true],
      ['dkumar', false],
    ])
  })

  it('simulates one incoming line comment on api#482 and moves its updatedAt', async () => {
    const mock = new MockGithubService()
    const before = (await mock.listPullRequests({})).find((pr) => pr.number === 482)
    const at = new Date('2026-10-28T12:00:00.000Z')
    expect(mock.simulateIncomingComment(at)).toBe(true)
    expect(mock.simulateIncomingComment(at)).toBe(false)

    const after = (await mock.listPullRequests({})).find((pr) => pr.number === 482)
    expect(after?.updatedAt).toBe(at.toISOString())
    expect(after?.updatedAt).not.toBe(before?.updatedAt)
    // Review comments do not count in GitHub's comment total.
    expect(after?.commentCount).toBe(before?.commentCount)

    const threads = await mock.getCommentThreads(api, 482)
    expect(threads.at(-1)).toMatchObject({
      isLineThread: true,
      path: 'src/routes/carts.ts',
      line: 26,
      comments: [{ author: { login: 'jrivas' }, createdAt: at.toISOString() }],
    })
    expect(threads.at(-1)?.comments[0].isViewer).toBeUndefined()
  })
})
