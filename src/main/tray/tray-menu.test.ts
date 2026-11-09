import { describe, expect, it } from 'vitest'
import type {
  ActivityCommentItem,
  ActivityItem,
  ActivityState,
  NotificationSettings,
} from '../../shared/activity'
import { githubRepo } from '../../shared/scm-guards'
import { mt } from '../i18n'
import {
  buildTrayContent,
  escapeMenuLabel,
  TRAY_LABEL_MAX,
  TRAY_MENU_MAX_ITEMS,
  trayItemLabel,
  trayTitle,
  truncate,
  type TrayMenuEntry,
  type TrayText,
} from './tray-menu'

const api = githubRepo('shopwave', 'api')
const text: TrayText = (key, vars) => mt(key, vars, 'en')
const textEs: TrayText = (key, vars) => mt(key, vars, 'es')

const settings: NotificationSettings = { level: 'direct', badge: true, sound: true, menuBar: true }

function comment(id: string, overrides: Partial<ActivityCommentItem> = {}): ActivityCommentItem {
  return {
    kind: 'comment',
    id,
    prKey: 'github:shopwave/api#482',
    repo: api,
    number: 482,
    prTitle: 'Add POST /carts',
    at: '2026-10-28T12:00:00.000Z',
    read: false,
    direct: true,
    threadId: 't',
    commentId: id,
    author: { login: 'mgarcia' },
    excerpt: 'Should this retry?',
    isLineThread: true,
    isReply: false,
    ...overrides,
  }
}

function stateOf(items: ActivityItem[]): ActivityState {
  return { items, unreadCount: items.filter((item) => !item.read).length }
}

const labels = (menu: TrayMenuEntry[]): string[] =>
  menu.map((entry) => (entry.type === 'separator' ? '---' : entry.label))

describe('trayItemLabel', () => {
  it('reads "#n title — who did what"', () => {
    expect(trayItemLabel(comment('a'), text)).toBe('#482 Add POST /carts — mgarcia commented')
    expect(trayItemLabel(comment('a', { isReply: true }), text)).toBe(
      '#482 Add POST /carts — mgarcia replied',
    )
    expect(
      trayItemLabel(
        {
          kind: 'review',
          id: 'r',
          prKey: 'k',
          repo: api,
          number: 7,
          prTitle: 'Fix',
          at: '2026-10-28T12:00:00.000Z',
          read: false,
          direct: true,
          reviewer: { login: 'dkumar', displayName: 'D. Kumar' },
          vote: 'changes_requested',
        },
        text,
      ),
    ).toBe('#7 Fix — D. Kumar requested changes')
  })

  it('shortens a long title first, keeping who did what, and caps the line', () => {
    const label = trayItemLabel(
      comment('a', {
        prTitle: 'Add POST /carts endpoint with coupon validation and a retry policy',
      }),
      text,
    )
    expect(Array.from(label).length).toBeLessThanOrEqual(TRAY_LABEL_MAX)
    expect(label).toMatch(/^#482 Add POST \/carts.*… — mgarcia commented$/)
  })

  it('stays one line even if a field carried a newline', () => {
    const label = trayItemLabel(comment('a', { prTitle: 'Two\nlines\tand\u0007bell' }), text)
    expect(label).toBe('#482 Two lines and bell — mgarcia commented')
  })

  it('escapes & so it is not read as a mnemonic', () => {
    expect(trayItemLabel(comment('a', { prTitle: 'R&D cleanup' }), text)).toBe(
      '#482 R&&D cleanup — mgarcia commented',
    )
    expect(escapeMenuLabel('a & b && c')).toBe('a && b &&&& c')
  })

  it('cuts on code points, never inside an emoji', () => {
    expect(truncate('🦉🦉🦉🦉', 3)).toBe('🦉🦉…')
    expect(truncate('short', 10)).toBe('short')
  })
})

describe('trayTitle', () => {
  it('is empty at 0 and caps large counts', () => {
    expect(trayTitle(0)).toBe('')
    expect(trayTitle(3)).toBe('3')
    expect(trayTitle(150)).toBe('99+')
  })
})

describe('buildTrayContent', () => {
  it('lists the newest unread items under an "N unread" header, at most five', () => {
    const items = [
      comment('read', { read: true }),
      ...Array.from({ length: 7 }, (_, i) => comment('c' + i, { number: 100 + i })),
    ]
    const content = buildTrayContent(stateOf(items), settings, text)
    expect(content.title).toBe('7')
    expect(content.tooltip).toBe('Minerva — 7 unread')
    const header = content.menu[2]
    expect(header).toEqual({ type: 'normal', label: '7 unread', enabled: false })
    const listed = content.menu.filter(
      (entry) => entry.type === 'normal' && entry.action?.kind === 'openItem',
    )
    expect(listed).toHaveLength(TRAY_MENU_MAX_ITEMS)
    expect(listed.map((entry) => entry.type === 'normal' && entry.action)).toEqual(
      ['c0', 'c1', 'c2', 'c3', 'c4'].map((itemId) => ({ kind: 'openItem', itemId })),
    )
  })

  it('has the fixed entries in order', () => {
    const content = buildTrayContent(stateOf([comment('a')]), settings, text)
    expect(labels(content.menu)).toEqual([
      'Open Minerva',
      '---',
      '1 unread',
      '#482 Add POST /carts — mgarcia commented',
      'Show all in the Inbox…',
      'Mark all as read',
      '---',
      'Play notification sounds',
      '---',
      'Quit Minerva',
    ])
    expect(content.tooltip).toBe('Minerva — 1 unread')
    const sound = content.menu.find((entry) => entry.type === 'checkbox')
    expect(sound).toMatchObject({
      checked: true,
      enabled: true,
      action: { kind: 'setSound', sound: false },
    })
  })

  it('says "Nothing new" with an empty count, and nothing to mark read', () => {
    const content = buildTrayContent(stateOf([comment('a', { read: true })]), settings, text)
    expect(content.title).toBe('')
    expect(content.tooltip).toBe('Minerva')
    expect(labels(content.menu)).toContain('Nothing new')
    expect(
      content.menu.find((e) => e.type === 'normal' && e.action?.kind === 'markAllRead'),
    ).toMatchObject({
      enabled: false,
    })
  })

  it('the sound checkbox follows the setting and is off-limits at level off', () => {
    const muted = buildTrayContent(stateOf([]), { ...settings, sound: false }, text)
    expect(muted.menu.find((entry) => entry.type === 'checkbox')).toMatchObject({
      checked: false,
      action: { kind: 'setSound', sound: true },
    })
    const off = buildTrayContent(stateOf([]), { ...settings, level: 'off' }, text)
    expect(off.menu.find((entry) => entry.type === 'checkbox')).toMatchObject({ enabled: false })
  })

  it('speaks Spanish, with plural forms', () => {
    const one = buildTrayContent(stateOf([comment('a')]), settings, textEs)
    expect(labels(one.menu)).toContain('1 sin leer')
    expect(one.tooltip).toBe('Minerva — 1 sin leer')
    expect(labels(one.menu)).toContain('#482 Add POST /carts — mgarcia comentó')
    const two = buildTrayContent(stateOf([comment('a'), comment('b')]), settings, textEs)
    expect(labels(two.menu)).toContain('2 sin leer')
    expect(labels(two.menu)[0]).toBe('Abrir Minerva')
  })
})
