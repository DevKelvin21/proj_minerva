import { describe, expect, it } from 'vitest'
import type {
  ActivityCommentItem,
  ActivityItem,
  ActivityOrphanItem,
} from '../../../shared/activity'
import { githubRepo } from '../../../shared/scm-guards'
import {
  activityTarget,
  fileName,
  focusAfterRemoval,
  groupActivity,
  matchesActivityQuery,
  parseInboxFilter,
  visibleInboxItems,
} from './activity'

const api = githubRepo('shopwave', 'api')
const web = githubRepo('shopwave', 'web')

function comment(id: string, overrides: Partial<ActivityCommentItem> = {}): ActivityCommentItem {
  return {
    kind: 'comment',
    id,
    prKey: 'github:shopwave/api#1',
    repo: api,
    number: 1,
    prTitle: 'Coupons',
    at: '2026-10-28T12:00:00.000Z',
    read: false,
    direct: true,
    threadId: 't-' + id,
    commentId: id,
    author: { login: 'jrivas' },
    excerpt: 'Should this retry?',
    isLineThread: true,
    path: 'src/routes/carts.ts',
    line: 26,
    side: 'RIGHT',
    isReply: false,
    ...overrides,
  }
}

const orphan: ActivityOrphanItem = {
  kind: 'orphan',
  id: 'orphan:x',
  prKey: 'github:shopwave/web#9',
  repo: web,
  number: 9,
  prTitle: 'Child',
  at: '2026-10-28T11:00:00.000Z',
  read: false,
  direct: true,
  parent: { number: 8, title: 'Parent', mergedInto: 'main' },
  suggestedBase: 'main',
}

describe('groupActivity', () => {
  it('groups by PR in order of their newest item and counts unread', () => {
    const items: ActivityItem[] = [comment('a'), orphan, comment('b', { read: true })]
    const groups = groupActivity(items)
    expect(groups.map((g) => [g.number, g.items.map((i) => i.id), g.unreadCount])).toEqual([
      [1, ['a', 'b'], 1],
      [9, ['orphan:x'], 1],
    ])
  })
})

describe('activityTarget', () => {
  it('sends a line comment to its line, anything else to the conversation or the PR', () => {
    expect(activityTarget(comment('a'))).toEqual({
      kind: 'line',
      path: 'src/routes/carts.ts',
      line: 26,
      threadId: 't-a',
    })
    expect(activityTarget(comment('b', { isLineThread: false, path: undefined }))).toEqual({
      kind: 'conversation',
      threadId: 't-b',
    })
    // A file-level or outdated thread (no line) reads in the conversation.
    expect(activityTarget(comment('c', { line: undefined }))).toEqual({
      kind: 'conversation',
      threadId: 't-c',
    })
    expect(activityTarget(orphan)).toEqual({ kind: 'overview' })
    expect(
      activityTarget({
        ...orphan,
        kind: 'review',
        reviewer: { login: 'dkumar' },
        vote: 'approved',
      }),
    ).toEqual({ kind: 'overview' })
  })
})

describe('matchesActivityQuery', () => {
  const [group] = groupActivity([comment('a')])
  it('matches every word against the PR and its comments', () => {
    expect(matchesActivityQuery(group, '')).toBe(true)
    expect(matchesActivityQuery(group, 'coupons #1')).toBe(true)
    expect(matchesActivityQuery(group, 'JRIVAS retry')).toBe(true)
    expect(matchesActivityQuery(group, 'carts.ts shopwave/api')).toBe(true)
    expect(matchesActivityQuery(group, 'refund')).toBe(false)
  })

  it('matches people by the display name the rows show, as well as the login', () => {
    const [named] = groupActivity([
      comment('a', { author: { login: 'jrivas', displayName: 'Julia Rivas' } }),
      {
        ...orphan,
        prKey: 'github:shopwave/api#1',
        repo: api,
        number: 1,
        id: 'review:x',
        kind: 'review',
        reviewer: { login: 'dkumar', displayName: 'Dev Kumar' },
        vote: 'changes_requested',
      },
    ])
    expect(matchesActivityQuery(named, 'julia')).toBe(true)
    expect(matchesActivityQuery(named, 'jrivas')).toBe(true)
    expect(matchesActivityQuery(named, 'dev kumar')).toBe(true)
    expect(matchesActivityQuery(named, 'dkumar')).toBe(true)
    expect(matchesActivityQuery(named, 'nobody')).toBe(false)
  })

  it("matches an orphan's parent and branches", () => {
    const [child] = groupActivity([{ ...orphan, suggestedBase: 'release/2.0' }])
    expect(matchesActivityQuery(child, '#8')).toBe(true)
    expect(matchesActivityQuery(child, 'release/2.0')).toBe(true)
  })
})

describe('fileName', () => {
  it('keeps the last path segment', () => {
    expect(fileName('src/routes/carts.ts')).toBe('carts.ts')
    expect(fileName('README.md')).toBe('README.md')
  })
})

describe('parseInboxFilter', () => {
  it('defaults to Unread for anything but "all"', () => {
    expect(parseInboxFilter('all')).toBe('all')
    expect(parseInboxFilter('unread')).toBe('unread')
    expect(parseInboxFilter(null)).toBe('unread')
    expect(parseInboxFilter('ALL')).toBe('unread')
  })
})

describe('visibleInboxItems', () => {
  const items = [comment('a'), comment('b', { read: true }), comment('c', { read: true })]
  const none = new Set<string>()

  it('Unread lists unread items plus the ones read while the view was open', () => {
    expect(visibleInboxItems(items, 'unread', none, none).map((i) => i.id)).toEqual(['a'])
    expect(visibleInboxItems(items, 'unread', new Set(['c']), none).map((i) => i.id)).toEqual([
      'a',
      'c',
    ])
  })

  it('All lists everything; both views drop the items hidden by a pending Done', () => {
    expect(visibleInboxItems(items, 'all', none, none)).toHaveLength(3)
    expect(visibleInboxItems(items, 'all', none, new Set(['a', 'b'])).map((i) => i.id)).toEqual([
      'c',
    ])
    expect(visibleInboxItems(items, 'unread', new Set(['c']), new Set(['a', 'c']))).toEqual([])
  })
})

describe('focusAfterRemoval', () => {
  const order = ['a', 'b', 'c', 'd']
  it('moves to the next remaining row, else the previous one', () => {
    expect(focusAfterRemoval(order, new Set(['b']))).toBe('c')
    expect(focusAfterRemoval(order, new Set(['b', 'c']))).toBe('d')
    expect(focusAfterRemoval(order, new Set(['c', 'd']))).toBe('b')
  })

  it('is null when nothing is left or nothing was removed', () => {
    expect(focusAfterRemoval(order, new Set(order))).toBeNull()
    expect(focusAfterRemoval(order, new Set(['x']))).toBeNull()
  })
})
