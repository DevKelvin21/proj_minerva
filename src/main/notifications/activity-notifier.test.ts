import { describe, expect, it, vi } from 'vitest'
import type {
  ActivityCommentItem,
  ActivityItem,
  ActivityOrphanItem,
  ActivityState,
  NotificationSettings,
} from '../../shared/activity'
import { githubRepo } from '../../shared/scm-guards'
import { mt } from '../i18n'
import {
  createActivityNotifier,
  notifiable,
  notificationFor,
  type NotificationContent,
} from './activity-notifier'

const api = githubRepo('shopwave', 'api')

function comment(id: string, overrides: Partial<ActivityCommentItem> = {}): ActivityCommentItem {
  return {
    kind: 'comment',
    id,
    prKey: 'github:shopwave/api#482',
    repo: api,
    number: 482,
    prTitle: 'Add coupons',
    at: '2026-10-28T12:00:00.000Z',
    read: false,
    direct: true,
    threadId: 't',
    commentId: id,
    author: { login: 'jrivas' },
    excerpt: 'Should this retry?',
    isLineThread: true,
    isReply: false,
    ...overrides,
  }
}

const orphan: ActivityOrphanItem = {
  kind: 'orphan',
  id: 'orphan:1',
  prKey: 'github:shopwave/api#9',
  repo: api,
  number: 9,
  prTitle: 'Child',
  at: '2026-10-28T12:00:00.000Z',
  read: false,
  direct: true,
  parent: { number: 8, title: 'Parent', mergedInto: 'main' },
  suggestedBase: 'main',
}

const text = (key: Parameters<typeof mt>[0], vars: Record<string, string | number>) =>
  mt(key, vars, 'en')

describe('notifiable', () => {
  const items: ActivityItem[] = [comment('a'), comment('b', { direct: false }), orphan]
  it('follows the level: off, direct only, everything', () => {
    expect(notifiable(items, 'off')).toEqual([])
    expect(notifiable(items, 'direct').map((item) => item.id)).toEqual(['a', 'orphan:1'])
    expect(notifiable(items, 'all').map((item) => item.id)).toEqual(['a', 'b', 'orphan:1'])
  })

  it('never notifies an item that is already read', () => {
    expect(notifiable([comment('a', { read: true })], 'all')).toEqual([])
  })
})

describe('notificationFor', () => {
  it('names the PR, the author and the excerpt for one comment', () => {
    expect(notificationFor([comment('a')], text)).toEqual({
      title: '#482 Add coupons',
      body: 'jrivas commented: Should this retry?',
      itemId: 'a',
    })
    expect(notificationFor([comment('a', { isReply: true })], text)?.body).toBe(
      'jrivas replied: Should this retry?',
    )
  })

  it('explains an orphan and its fix', () => {
    expect(notificationFor([orphan], text)).toEqual({
      title: '#9 Child',
      body: 'Its base PR #8 was merged. Retarget it to main.',
      itemId: 'orphan:1',
    })
  })

  it('names the reviewer and the vote, or the review request', () => {
    expect(
      notificationFor(
        [
          {
            ...orphan,
            kind: 'review',
            id: 'r',
            reviewer: { login: 'dkumar' },
            vote: 'changes_requested',
          },
        ],
        text,
      ),
    ).toEqual({ title: '#9 Child', body: 'dkumar requested changes.', itemId: 'r' })
    expect(
      notificationFor([{ ...orphan, kind: 'review_request', id: 'q', required: true }], text),
    ).toEqual({
      title: 'Review requested: #9',
      body: 'You were asked to review "Child".',
      itemId: 'q',
    })
  })

  it('batches several items into one count that opens the Inbox', () => {
    expect(notificationFor([comment('a'), comment('b')], text)).toEqual({
      title: '2 new updates on your pull requests',
      body: 'On one pull request. Open the Inbox to see them.',
      itemId: null,
    })
    expect(notificationFor([comment('a'), orphan], text)?.body).toBe(
      'On 2 pull requests. Open the Inbox to see them.',
    )
    expect(notificationFor([], text)).toBeNull()
  })
})

describe('createActivityNotifier', () => {
  function setup(settings: NotificationSettings, focused: boolean) {
    const setBadge = vi.fn()
    const shown: NotificationContent[] = []
    const notifier = createActivityNotifier({
      getSettings: () => settings,
      setBadge,
      isAppFocused: () => focused,
      show: (content) => shown.push(content),
      text,
    })
    return { notifier, setBadge, shown }
  }
  const state = (unreadCount: number): ActivityState => ({ items: [], unreadCount })

  it('updates the badge and notifies once per batch while the app is in the background', () => {
    const { notifier, setBadge, shown } = setup({ level: 'direct', badge: true }, false)
    notifier.onActivity(state(2), [comment('a'), comment('b', { direct: false })])
    expect(setBadge).toHaveBeenLastCalledWith(2)
    expect(shown).toEqual([expect.objectContaining({ itemId: 'a' })])
  })

  it('stays quiet while the app is focused (the badge still moves)', () => {
    const { notifier, setBadge, shown } = setup({ level: 'all', badge: true }, true)
    notifier.onActivity(state(1), [comment('a')])
    expect(setBadge).toHaveBeenLastCalledWith(1)
    expect(shown).toEqual([])
  })

  it('clears the badge when it is turned off, and shows nothing at level off', () => {
    const { notifier, setBadge, shown } = setup({ level: 'off', badge: false }, false)
    notifier.onActivity(state(3), [comment('a')])
    notifier.refreshBadge(state(3))
    expect(setBadge.mock.calls).toEqual([[0], [0]])
    expect(shown).toEqual([])
  })

  it('a read-only change (no new items) only touches the badge', () => {
    const { notifier, setBadge, shown } = setup({ level: 'all', badge: true }, false)
    notifier.onActivity(state(0), [])
    expect(setBadge).toHaveBeenLastCalledWith(0)
    expect(shown).toEqual([])
  })
})
