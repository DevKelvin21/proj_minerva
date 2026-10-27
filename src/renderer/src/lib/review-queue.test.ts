import { describe, expect, it } from 'vitest'
import type { PullRequestSummary } from '../../../shared/types'
import { buildReviewQueue, matchesQueueQuery } from './review-queue'

let next = 1
function pr(overrides: Partial<PullRequestSummary> = {}): PullRequestSummary {
  const number = next++
  return {
    id: 'id-' + number,
    number,
    title: 'PR ' + number,
    author: { login: 'someone' },
    repo: { provider: 'github', owner: 'shopwave', name: 'api', fullName: 'shopwave/api' },
    state: 'open',
    isDraft: false,
    createdAt: '2026-10-0' + ((number % 9) + 1) + 'T00:00:00Z',
    updatedAt: '2026-10-0' + ((number % 9) + 1) + 'T00:00:00Z',
    headRef: 'feat/x',
    baseRef: 'main',
    headSha: '',
    webUrl: '',
    commentCount: 0,
    reviewDecision: null,
    ciStatus: null,
    additions: null,
    deletions: null,
    changedFiles: null,
    ...overrides,
  }
}

const ids = (entries: { pr: PullRequestSummary }[]): number[] => entries.map((e) => e.pr.number)

const me = {}

describe('buildReviewQueue', () => {
  it('puts each PR in one section: review › updated › yours › optional › rest', () => {
    const toReview = pr({ viewer: { isAuthor: false, reviewer: 'required', vote: 'none' } })
    const optional = pr({ viewer: { isAuthor: false, reviewer: 'optional' } })
    const voted = pr({ viewer: { isAuthor: false, reviewer: 'required', vote: 'approved' } })
    const updated = pr({
      viewer: { isAuthor: false, reviewer: 'required', vote: 'approved' },
      unread: { isNew: false, hasUpdates: true, hasNewComments: false },
    })
    const mine = pr({ viewer: { isAuthor: true, reviewer: null } })
    const other = pr({ unread: { isNew: false, hasUpdates: true, hasNewComments: false } })
    const queue = buildReviewQueue([toReview, optional, voted, updated, mine, other], me)
    expect(ids(queue.needsReview)).toEqual([toReview.number])
    expect(ids(queue.updated)).toEqual([updated.number])
    expect(ids(queue.mine)).toEqual([mine.number])
    expect(ids(queue.optional)).toEqual([optional.number])
    // Unread but not involved, and an already-voted review: the rest.
    expect(ids(queue.rest).sort()).toEqual([voted.number, other.number].sort())
  })

  it("needs your review = Home's rule (required, no vote), oldest first", () => {
    const newer = pr({
      createdAt: '2026-09-01T00:00:00Z',
      viewer: { isAuthor: false, reviewer: 'required' },
    })
    const older = pr({
      createdAt: '2026-02-01T00:00:00Z',
      isDraft: true,
      viewer: { isAuthor: false, reviewer: 'required', vote: 'none' },
    })
    const queue = buildReviewQueue([newer, older], me)
    expect(ids(queue.needsReview)).toEqual([older.number, newer.number])
    expect(queue.needsReview.map((e) => e.status)).toEqual(['draft', null])
  })

  it('a PR never opened is not "updated since you looked"', () => {
    const mine = pr({
      viewer: { isAuthor: true, reviewer: null },
      unread: { isNew: true, hasUpdates: false, hasNewComments: false },
    })
    const queue = buildReviewQueue([mine], me)
    expect(queue.updated).toHaveLength(0)
    expect(ids(queue.mine)).toEqual([mine.number])
  })

  it('your PRs say what stands between them and the merge', () => {
    const author = { isAuthor: true, reviewer: null } as const
    const statuses = buildReviewQueue(
      [
        pr({ viewer: author, isDraft: true }),
        pr({ viewer: author, ciStatus: 'failure', reviewDecision: 'approved' }),
        pr({ viewer: author, reviewDecision: 'rejected' }),
        pr({ viewer: author, reviewDecision: 'approved' }),
        pr({ viewer: author }),
      ],
      me,
    ).mine.map((e) => e.status)
    expect(statuses.sort()).toEqual(
      ['draft', 'ciFailing', 'changesRequested', 'approved', 'waiting'].sort(),
    )
  })

  it('updated entries say what changed', () => {
    const viewer = { isAuthor: true, reviewer: null } as const
    const statuses = buildReviewQueue(
      [
        pr({ viewer, unread: { isNew: false, hasUpdates: true, hasNewComments: true } }),
        pr({ viewer, unread: { isNew: false, hasUpdates: true, hasNewComments: false } }),
      ],
      me,
    ).updated.map((e) => e.status)
    expect(statuses.sort()).toEqual(['newComments', 'newCommits'].sort())
  })

  it('filters by every word across title, repo, #number, branch and author', () => {
    const target = pr({
      title: 'Fix cart rounding',
      headRef: 'fix/cart',
      author: { login: 'grace' },
    })
    expect(matchesQueueQuery(target, 'cart grace')).toBe(true)
    expect(matchesQueueQuery(target, '#' + target.number)).toBe(true)
    expect(matchesQueueQuery(target, 'shopwave/api fix/cart')).toBe(true)
    expect(matchesQueueQuery(target, 'cart ada')).toBe(false)
    expect(buildReviewQueue([target, pr()], me, 'rounding').rest).toHaveLength(1)
  })
})
