import { describe, expect, it, vi } from 'vitest'
import type { ActivityItem, ActivityState } from '../../shared/activity'
import { githubRepo } from '../../shared/scm-guards'
import {
  prKey,
  type AzureRepoRef,
  type RepoRef,
  type ReviewerVote,
  type ScmProviderId,
  type StackNode,
} from '../../shared/scm'
import type {
  CommentThread,
  GetStacksResult,
  PrComment,
  PullRequestSummary,
} from '../../shared/types'
import type { ActivityData, ActivityStore, PrTrack } from './activity-store'
import {
  createActivityService,
  newCommentItems,
  orphanItems,
  pickDue,
  pruneItems,
  reviewItems,
  reviewTrackOf,
  toPlainLine,
} from './activity-service'
import type { WatcherListResult } from './pr-watcher'

const api = githubRepo('shopwave', 'api')
const azRepo: AzureRepoRef = {
  provider: 'azure',
  organization: 'contoso',
  project: 'shop',
  name: 'orders',
  repositoryId: 'r1',
  fullName: 'contoso/shop/orders',
}

function pr(
  number: number,
  overrides: Partial<PullRequestSummary> = {},
  repo: RepoRef = api,
): PullRequestSummary {
  return {
    id: 'id-' + number,
    number,
    title: 'PR ' + number,
    author: { login: 'mgarcia' },
    repo,
    state: 'open',
    isDraft: false,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    headRef: 'feature/' + number,
    baseRef: 'main',
    headSha: '',
    webUrl: '',
    commentCount: null,
    reviewDecision: null,
    ciStatus: null,
    additions: null,
    deletions: null,
    changedFiles: null,
    viewer: { isAuthor: true, reviewer: null },
    ...overrides,
  }
}

function comment(id: string, overrides: Partial<PrComment> = {}): PrComment {
  return {
    id,
    author: { login: 'jrivas' },
    bodyMarkdown: 'Comment ' + id,
    createdAt: '2026-10-02T00:00:00.000Z',
    isMinimized: false,
    ...overrides,
  }
}

function lineThread(id: string, comments: PrComment[]): CommentThread {
  return {
    id,
    status: 'active',
    isResolved: false,
    isLineThread: true,
    path: 'src/a.ts',
    line: 12,
    side: 'RIGHT',
    comments,
  }
}

function generalThread(id: string, comments: PrComment[]): CommentThread {
  return { id, status: 'active', isResolved: false, isLineThread: false, comments }
}

function listing(
  items: PullRequestSummary[],
  okProviders: ScmProviderId[] = ['github'],
): WatcherListResult {
  return { items, errors: [], okProviders: [...okProviders] }
}

function memoryStore(initial?: ActivityData): ActivityStore & { saves: number } {
  let data: ActivityData = initial ?? { prs: new Map(), reviews: new Map(), items: [] }
  return {
    saves: 0,
    load: () => ({
      prs: new Map(data.prs),
      reviews: new Map(data.reviews),
      items: [...data.items],
    }),
    save(next) {
      this.saves++
      data = { prs: new Map(next.prs), reviews: new Map(next.reviews), items: [...next.items] }
    },
  }
}

function track(overrides: Partial<PrTrack> = {}): PrTrack {
  return {
    knownCommentIds: [],
    checkedUpdatedAt: '2026-10-01T00:00:00.000Z',
    checkedAt: '2026-10-28T12:00:00.000Z',
    ...overrides,
  }
}

const NOW = Date.parse('2026-10-28T12:00:00.000Z')

describe('toPlainLine', () => {
  it('flattens whitespace and drops control and bidi characters', () => {
    expect(toPlainLine('  a\n\nb\tc\u0007d\u202Ee  ', 50)).toBe('a b c d e')
  })

  it('drops invisible characters that can hide or disguise text', () => {
    expect(toPlainLine('ad\u200Bmin\uFEFF\u2060\u00AD\u061C', 50)).toBe('ad min')
    expect(toPlainLine('x\u{E0041}\u{E007F}y', 50)).toBe('x y')
  })

  it('caps with an ellipsis, by characters (not UTF-16 units)', () => {
    expect(toPlainLine('abcdef', 4)).toBe('abc…')
    expect(toPlainLine('😀😀😀😀😀', 3)).toBe('😀😀…')
    expect(toPlainLine('abc', 3)).toBe('abc')
  })
})

describe('pickDue', () => {
  it('ranks moved updatedAt, then baselines, then stale Azure polls, and caps', () => {
    const moved = pr(1, { updatedAt: '2026-10-05T00:00:00.000Z' })
    const unchanged = pr(2)
    const fresh = pr(3)
    const azureStale = pr(4, {}, azRepo)
    const azureRecent = pr(5, {}, azRepo)
    const prs = new Map<string, PrTrack>([
      [prKey(api, 1), track()],
      [prKey(api, 2), track()],
      [prKey(azRepo, 4), track({ checkedAt: '2026-10-28T11:50:00.000Z' })],
      [prKey(azRepo, 5), track({ checkedAt: '2026-10-28T11:59:00.000Z' })],
    ])
    const open = [unchanged, azureRecent, azureStale, fresh, moved]
    expect(pickDue(open, prs, NOW, 3 * 60_000, 10).map((p) => p.number)).toEqual([1, 3, 4])
    expect(pickDue(open, prs, NOW, 3 * 60_000, 2).map((p) => p.number)).toEqual([1, 3])
  })

  it('never polls GitHub PRs whose updatedAt did not move', () => {
    const prs = new Map([[prKey(api, 2), track({ checkedAt: '2026-01-01T00:00:00.000Z' })]])
    expect(pickDue([pr(2)], prs, NOW, 60_000, 10)).toEqual([])
  })
})

describe('newCommentItems', () => {
  it('reports unknown comments by others, never the user own ones', () => {
    const threads = [
      lineThread('t1', [comment('c1'), comment('c2', { isViewer: true }), comment('c3')]),
    ]
    const items = newCommentItems(pr(7), threads, new Set(['c1']))
    expect(items.map((item) => item.commentId)).toEqual(['c3'])
    expect(items[0]).toMatchObject({
      kind: 'comment',
      id: 'comment:' + prKey(api, 7) + ':c3',
      prKey: prKey(api, 7),
      threadId: 't1',
      isLineThread: true,
      path: 'src/a.ts',
      line: 12,
      side: 'RIGHT',
      isReply: true,
      read: false,
      direct: true,
    })
  })

  it('flattens the path and skips ids no provider would send', () => {
    const items = newCommentItems(
      pr(10),
      [
        { ...lineThread('t', [comment('ok')]), path: 'src/a\u202E.ts\nevil' },
        lineThread('x'.repeat(400), [comment('long-thread')]),
        lineThread('t2', [comment('y'.repeat(400))]),
      ],
      new Set(),
    )
    expect(items.map((item) => item.commentId)).toEqual(['ok'])
    expect(items[0].path).toBe('src/a .ts evil')
  })

  it('is direct on my own PR or in a thread I wrote in, and not otherwise', () => {
    const reviewing = pr(8, { viewer: { isAuthor: false, reviewer: 'required' } })
    const threads = [
      lineThread('mine', [comment('a', { isViewer: true }), comment('b')]),
      generalThread('other', [comment('c')]),
    ]
    const items = newCommentItems(reviewing, threads, new Set(['a']))
    expect(items.map((item) => [item.commentId, item.direct, item.isLineThread])).toEqual([
      ['b', true, true],
      ['c', false, false],
    ])
    expect(items[1].path).toBeUndefined()
  })

  it('sanitizes the untrusted text it keeps', () => {
    const [item] = newCommentItems(
      pr(9, { title: 'Title\nwith\u0000break' }),
      [
        generalThread('t', [
          comment('x', {
            bodyMarkdown: 'line one\n\nline two ' + 'z'.repeat(300),
            author: { login: 'eve\u202E', avatarUrl: 'javascript:alert(1)' },
          }),
        ]),
      ],
      new Set(),
    )
    expect(item.prTitle).toBe('Title with break')
    expect(item.excerpt.startsWith('line one line two zzz')).toBe(true)
    expect(Array.from(item.excerpt)).toHaveLength(160)
    // No avatar URL is kept (the inbox draws initials).
    expect(item.author).toEqual({ login: 'eve' })
  })
})

describe('orphanItems', () => {
  function node(number: number, children: StackNode[] = [], orphan = false): StackNode {
    return {
      prKey: prKey(api, number),
      repo: api,
      number,
      title: 'PR ' + number,
      headRef: 'h' + number,
      baseRef: 'b' + number,
      state: 'open',
      isDraft: false,
      children,
      ...(orphan
        ? {
            orphan: {
              parent: { number: 1, title: 'Parent', mergedInto: 'main' },
              targetBranchExists: true,
              suggestedBase: 'main',
            },
          }
        : {}),
    }
  }

  it('keeps only orphans of PRs the user authored, anywhere in the tree', () => {
    const result: GetStacksResult = {
      stacks: [{ repo: api, root: node(10, [node(11, [], true), node(12, [], true)]), size: 3 }],
      errors: [],
    }
    const mine = new Map([[prKey(api, 11), pr(11)]])
    const items = orphanItems(result, mine, '2026-10-28T12:00:00.000Z')
    expect(items).toEqual([
      expect.objectContaining({
        kind: 'orphan',
        id: 'orphan:' + prKey(api, 11) + ':1',
        number: 11,
        direct: true,
        suggestedBase: 'main',
        parent: { number: 1, title: 'Parent', mergedInto: 'main' },
      }),
    ])
  })
})

describe('pruneItems', () => {
  it('sorts newest first, drops old read items, keeps old unread ones', () => {
    const base = newCommentItems(
      pr(1),
      [generalThread('t', [comment('a'), comment('b'), comment('c')])],
      new Set(),
    )
    const items: ActivityItem[] = [
      { ...base[0], at: '2026-10-01T00:00:00.000Z', read: true },
      { ...base[1], at: '2026-10-01T00:00:00.000Z', read: false },
      { ...base[2], at: '2026-10-27T00:00:00.000Z', read: true },
    ]
    expect(pruneItems(items, NOW).map((item) => item.id)).toEqual([base[2].id, base[1].id])
  })
})

describe('createActivityService', () => {
  function setup(threadsByPr: Record<number, CommentThread[]>, initial?: ActivityData) {
    const store = memoryStore(initial)
    const changes: { state: ActivityState; added: ActivityItem[] }[] = []
    const getThreads = vi.fn(async (_repo: RepoRef, number: number) => threadsByPr[number] ?? [])
    let now = NOW
    const service = createActivityService({
      store,
      getThreads,
      onChange: (state, added) => changes.push({ state, added }),
      now: () => now,
    })
    return { service, store, changes, getThreads, advance: (ms: number) => (now += ms) }
  }

  it('baselines silently, then reports a new comment once', async () => {
    const threads: Record<number, CommentThread[]> = { 1: [lineThread('t1', [comment('c1')])] }
    const { service, changes, getThreads } = setup(threads)

    await service.onListing(listing([pr(1)]))
    expect(changes).toEqual([])
    expect(service.get()).toEqual({ items: [], unreadCount: 0 })

    // Same updatedAt: nothing is fetched.
    await service.onListing(listing([pr(1)]))
    expect(getThreads).toHaveBeenCalledTimes(1)

    threads[1] = [lineThread('t1', [comment('c1'), comment('c2')])]
    await service.onListing(listing([pr(1, { updatedAt: '2026-10-03T00:00:00.000Z' })]))
    expect(changes).toHaveLength(1)
    expect(changes[0].added.map((item) => item.id)).toEqual(['comment:' + prKey(api, 1) + ':c2'])
    expect(service.get().unreadCount).toBe(1)

    await service.onListing(listing([pr(1, { updatedAt: '2026-10-04T00:00:00.000Z' })]))
    expect(changes).toHaveLength(1)
  })

  it('marks items read (some or all) and pushes the new state', async () => {
    const threads: Record<number, CommentThread[]> = { 1: [] }
    const { service, changes } = setup(threads)
    await service.onListing(listing([pr(1)]))
    threads[1] = [generalThread('t', [comment('a'), comment('b')])]
    await service.onListing(listing([pr(1, { updatedAt: '2026-10-03T00:00:00.000Z' })]))
    const [first] = service.get().items

    expect(service.markRead({ ids: [first.id] }).unreadCount).toBe(1)
    expect(service.markRead({ ids: [first.id] }).unreadCount).toBe(1)
    expect(service.markRead({ all: true })).toMatchObject({ unreadCount: 0 })
    // Two real changes pushed (the repeated mark is a no-op).
    expect(changes.map((change) => change.state.unreadCount)).toEqual([2, 1, 0])
  })

  it('keeps a PR due when its threads fail, and checks it again next time', async () => {
    const { service, getThreads } = setup({})
    getThreads.mockRejectedValueOnce(new Error('boom'))
    await service.onListing(listing([pr(1)]))
    await service.onListing(listing([pr(1)]))
    expect(getThreads).toHaveBeenCalledTimes(2)
    await service.onListing(listing([pr(1)]))
    expect(getThreads).toHaveBeenCalledTimes(2)
  })

  it('ignores PRs of providers that failed this listing', async () => {
    const { service, getThreads } = setup({})
    await service.onListing({
      items: [pr(1)],
      errors: [{ provider: 'github', code: 'NETWORK', message: 'x' }],
      okProviders: [],
    })
    expect(getThreads).not.toHaveBeenCalled()
  })

  it('polls Azure PRs on an interval, since their updatedAt misses comments', async () => {
    const threads: Record<number, CommentThread[]> = { 4: [] }
    const { service, getThreads, changes, advance } = setup(threads)
    const azurePr = pr(4, {}, azRepo)
    await service.onListing(listing([azurePr], ['azure']))
    threads[4] = [generalThread('t', [comment('n')])]
    await service.onListing(listing([azurePr], ['azure']))
    expect(getThreads).toHaveBeenCalledTimes(1)
    advance(3 * 60_000)
    await service.onListing(listing([azurePr], ['azure']))
    expect(getThreads).toHaveBeenCalledTimes(2)
    expect(changes[0].added.map((item) => item.prKey)).toEqual([prKey(azRepo, 4)])
  })

  it('forgets a PR once it is closed, so a reopen baselines again', async () => {
    const threads: Record<number, CommentThread[]> = { 1: [generalThread('t', [comment('a')])] }
    const { service, changes, store } = setup(threads)
    await service.onListing(listing([pr(1)]))
    await service.onListing(listing([pr(1, { state: 'merged' })]))
    expect(store.load().prs.has(prKey(api, 1))).toBe(false)
    threads[1] = [generalThread('t', [comment('a'), comment('b')])]
    await service.onListing(listing([pr(1, { updatedAt: '2026-10-09T00:00:00.000Z' })]))
    expect(changes).toEqual([])
  })

  it('does not save when a listing changed nothing', async () => {
    const { service, store } = setup({ 1: [] })
    await service.onListing(listing([pr(1)]))
    const saves = store.saves
    await service.onListing(listing([pr(1)]))
    expect(store.saves).toBe(saves)
  })

  it('skips a listing that arrives while one is still running', async () => {
    let release!: () => void
    const { service, getThreads } = setup({})
    getThreads.mockImplementationOnce(
      () => new Promise<CommentThread[]>((resolve) => (release = () => resolve([]))),
    )
    const first = service.onListing(listing([pr(1)]))
    await service.onListing(listing([pr(1)]))
    release()
    await first
    expect(getThreads).toHaveBeenCalledTimes(1)
  })

  it('adds orphans of my PRs and drops them once they are retargeted', async () => {
    const store = memoryStore()
    const changes: ActivityItem[][] = []
    const orphanNode: StackNode = {
      prKey: prKey(api, 2),
      repo: api,
      number: 2,
      title: 'Child',
      headRef: 'child',
      baseRef: 'parent',
      state: 'open',
      isDraft: false,
      children: [],
      orphan: {
        parent: { number: 1, title: 'Parent', mergedInto: 'main' },
        targetBranchExists: true,
        suggestedBase: 'main',
      },
    }
    let stacks: GetStacksResult = { stacks: [{ repo: api, root: orphanNode, size: 1 }], errors: [] }
    let now = NOW
    const service = createActivityService({
      store,
      getThreads: async () => [],
      getStacks: async () => stacks,
      onChange: (state) => changes.push(state.items),
      now: () => now,
      orphanIntervalMs: 1000,
    })
    await service.onListing(listing([pr(2)]))
    expect(service.get().items.map((item) => item.id)).toEqual(['orphan:' + prKey(api, 2) + ':1'])

    // Still an orphan: not added twice.
    now += 1000
    await service.onListing(listing([pr(2)]))
    expect(service.get().items).toHaveLength(1)

    stacks = {
      stacks: [{ repo: api, root: { ...orphanNode, orphan: undefined }, size: 1 }],
      errors: [],
    }
    now += 1000
    await service.onListing(listing([pr(2)]))
    expect(service.get().items).toEqual([])
    expect(changes).toHaveLength(2)
  })
})

describe('review events', () => {
  const nowIso = '2026-10-28T12:00:00.000Z'
  const reviewer = (login: string, vote: ReviewerVote) => ({
    user: { login },
    vote,
    isRequired: true,
  })

  it('reports a vote that changed on my PR, never a reset to none', () => {
    const before = pr(1, { reviewers: [reviewer('dkumar', 'none'), reviewer('lchen', 'approved')] })
    const after = pr(1, {
      reviewers: [reviewer('dkumar', 'changes_requested'), reviewer('lchen', 'none')],
    })
    const previous = reviewTrackOf(before, undefined, nowIso)
    const items = reviewItems(after, previous, reviewTrackOf(after, previous, nowIso), nowIso)
    expect(items).toEqual([
      expect.objectContaining({
        kind: 'review',
        reviewer: { login: 'dkumar' },
        vote: 'changes_requested',
        direct: true,
        number: 1,
      }),
    ])
  })

  it('ignores votes on PRs I do not author', () => {
    const notMine = { viewer: { isAuthor: false, reviewer: null } }
    const before = pr(1, { ...notMine, reviewers: [reviewer('dkumar', 'none')] })
    const after = pr(1, { ...notMine, reviewers: [reviewer('dkumar', 'approved')] })
    const previous = reviewTrackOf(before, undefined, nowIso)
    expect(reviewItems(after, previous, reviewTrackOf(after, previous, nowIso), nowIso)).toEqual([])
  })

  it('reports a review newly asked of me (required = direct), not one I already had', () => {
    const before = pr(2, { viewer: { isAuthor: false, reviewer: null } })
    const asked = pr(2, { viewer: { isAuthor: false, reviewer: 'required', vote: 'none' } })
    const previous = reviewTrackOf(before, undefined, nowIso)
    const next = reviewTrackOf(asked, previous, nowIso)
    expect(reviewItems(asked, previous, next, nowIso)).toEqual([
      expect.objectContaining({ kind: 'review_request', required: true, direct: true }),
    ])
    expect(reviewItems(asked, next, reviewTrackOf(asked, next, nowIso), nowIso)).toEqual([])

    const optional = pr(2, { viewer: { isAuthor: false, reviewer: 'optional' } })
    expect(
      reviewItems(optional, previous, reviewTrackOf(optional, previous, nowIso), nowIso),
    ).toEqual([expect.objectContaining({ required: false, direct: false })])
  })

  it('a re-request after voting is a new request', () => {
    const voted = pr(3, { viewer: { isAuthor: false, reviewer: 'required', vote: 'approved' } })
    const again = pr(3, { viewer: { isAuthor: false, reviewer: 'required', vote: 'none' } })
    const previous = reviewTrackOf(voted, undefined, nowIso)
    expect(previous.requested).toBe(false)
    expect(
      reviewItems(again, previous, reviewTrackOf(again, previous, nowIso), nowIso),
    ).toHaveLength(1)
  })

  it('an unknown identity never fires a request once it resolves', () => {
    const unknown = pr(4, { viewer: undefined })
    const known = pr(4, { viewer: { isAuthor: false, reviewer: 'required', vote: 'none' } })
    const previous = reviewTrackOf(unknown, undefined, nowIso)
    expect(previous.requested).toBeNull()
    expect(reviewItems(known, previous, reviewTrackOf(known, previous, nowIso), nowIso)).toEqual([])
  })

  it('a listing without reviewers keeps the last known votes', () => {
    const before = pr(5, { reviewers: [reviewer('dkumar', 'approved')] })
    const previous = reviewTrackOf(before, undefined, nowIso)
    expect(reviewTrackOf(pr(5), previous, nowIso).votes).toEqual({ dkumar: 'approved' })
  })

  it('end to end: baseline silent, then one item for the new vote', async () => {
    const store = memoryStore()
    const changes: ActivityItem[][] = []
    const service = createActivityService({
      store,
      getThreads: async () => [],
      onChange: (_state, added) => changes.push(added),
      now: () => NOW,
    })
    await service.onListing(listing([pr(6, { reviewers: [reviewer('dkumar', 'none')] })]))
    expect(changes).toEqual([])
    await service.onListing(
      listing([pr(6, { reviewers: [reviewer('dkumar', 'changes_requested')] })]),
    )
    expect(changes).toEqual([[expect.objectContaining({ kind: 'review', number: 6 })]])
    expect(store.load().reviews.get(prKey(api, 6))?.votes).toEqual({
      dkumar: 'changes_requested',
    })
  })
})
