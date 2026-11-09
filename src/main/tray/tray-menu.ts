/**
 * The macOS menu bar item's content, as plain data: title (the unread Inbox
 * count), tooltip and the menu. Pure over the inbox state, the notification
 * settings and a translator, so the rules are unit-tested without Electron;
 * `tray-service.ts` turns it into a native `Tray` + `Menu`.
 *
 * Item labels are built only from `ActivityItem` fields main already
 * sanitized (one line, capped), flattened again and truncated here, with `&`
 * escaped (`&&`) so a title never turns into a mnemonic. Each entry carries
 * an `TrayAction` naming ids only: nothing here can open a URL from PR content.
 */
import type { ActivityItem, ActivityState, NotificationSettings } from '../../shared/activity'
import type { MainMessageKey } from '../i18n'

/** Newest unread items listed in the menu. */
export const TRAY_MENU_MAX_ITEMS = 5

/** Longest item label, in characters (macOS menus do not wrap). */
export const TRAY_LABEL_MAX = 60

/** Shortest title kept when a long "who did what" squeezes it. */
const MIN_TITLE_CHARS = 12

export type TrayTextKey = Extract<MainMessageKey, `activity.tray.${string}`>

export type TrayText = (key: TrayTextKey, vars?: Record<string, string | number>) => string

/** What a click does. Ids only; `tray-service.ts` maps each to main's own code. */
export type TrayAction =
  | { kind: 'openApp' }
  | { kind: 'openItem'; itemId: string }
  | { kind: 'showInbox' }
  | { kind: 'markAllRead' }
  | { kind: 'setSound'; sound: boolean }
  | { kind: 'quit' }

export type TrayMenuEntry =
  | { type: 'separator' }
  | { type: 'normal'; label: string; enabled: boolean; action?: TrayAction }
  | { type: 'checkbox'; label: string; checked: boolean; enabled: boolean; action: TrayAction }

export interface TrayContent {
  /** Next to the owl: the unread count, empty at 0. */
  title: string
  tooltip: string
  menu: TrayMenuEntry[]
}

const plural = (count: number): 'one' | 'other' => (count === 1 ? 'one' : 'other')

/** One line of plain text: control characters and runs of whitespace become one space. */
function flatten(text: string): string {
  // eslint-disable-next-line no-control-regex -- stripping control characters is the point
  return text.replace(/[\u0000-\u001f\u007f-\u009f\s]+/g, ' ').trim()
}

/** At most `max` characters (code points, so no emoji is cut in half), `…` when cut. */
export function truncate(text: string, max: number): string {
  const chars = Array.from(text)
  if (chars.length <= max) return text
  return (
    chars
      .slice(0, Math.max(0, max - 1))
      .join('')
      .trimEnd() + '…'
  )
}

/** `&` is a mnemonic marker in native menus; `&&` shows one ampersand. */
export function escapeMenuLabel(text: string): string {
  return text.replace(/&/g, '&&')
}

/** "who did what" for an item: `mgarcia commented`, `review requested`… */
function whatHappened(item: ActivityItem, text: TrayText): string {
  switch (item.kind) {
    case 'comment':
      return text(item.isReply ? 'activity.tray.what.reply' : 'activity.tray.what.comment', {
        author: flatten(item.author.displayName ?? item.author.login),
      })
    case 'review':
      return text(`activity.tray.what.vote.${item.vote}`, {
        reviewer: flatten(item.reviewer.displayName ?? item.reviewer.login),
      })
    case 'review_request':
      return text(
        item.required ? 'activity.tray.what.request' : 'activity.tray.what.requestOptional',
      )
    case 'orphan':
      return text('activity.tray.what.orphan', { parent: item.parent.number })
  }
}

/**
 * `#482 Add POST /carts… — mgarcia commented`: one line, at most
 * `TRAY_LABEL_MAX` characters. The PR title gives way first, so "who did
 * what" stays readable; then the whole line is capped. Escaped for the menu.
 */
export function trayItemLabel(item: ActivityItem, text: TrayText): string {
  const what = truncate(flatten(whatHappened(item, text)), TRAY_LABEL_MAX)
  const line = (title: string): string =>
    text('activity.tray.item', { number: item.number, title, what })
  const overhead = Array.from(line('')).length
  const title = truncate(
    flatten(item.prTitle),
    Math.max(MIN_TITLE_CHARS, TRAY_LABEL_MAX - overhead),
  )
  return escapeMenuLabel(truncate(line(title), TRAY_LABEL_MAX))
}

/** The count next to the owl: empty at 0, capped so the menu bar stays narrow. */
export function trayTitle(unread: number): string {
  if (unread <= 0) return ''
  return unread > 99 ? '99+' : String(unread)
}

/** Everything the menu bar item shows for this state and these settings. */
export function buildTrayContent(
  state: ActivityState,
  settings: NotificationSettings,
  text: TrayText,
): TrayContent {
  const unread = state.items.filter((item) => !item.read)
  const count = state.unreadCount
  const listed: TrayMenuEntry[] =
    unread.length === 0
      ? [{ type: 'normal', label: text('activity.tray.empty'), enabled: false }]
      : [
          {
            type: 'normal',
            label: text(`activity.tray.unread_${plural(count)}`, { count }),
            enabled: false,
          },
          ...unread.slice(0, TRAY_MENU_MAX_ITEMS).map((item): TrayMenuEntry => ({
            type: 'normal',
            label: trayItemLabel(item, text),
            enabled: true,
            action: { kind: 'openItem', itemId: item.id },
          })),
        ]
  return {
    title: trayTitle(count),
    tooltip:
      count > 0
        ? text(`activity.tray.tooltipUnread_${plural(count)}`, { count })
        : text('activity.tray.tooltip'),
    menu: [
      {
        type: 'normal',
        label: text('activity.tray.open'),
        enabled: true,
        action: { kind: 'openApp' },
      },
      { type: 'separator' },
      ...listed,
      {
        type: 'normal',
        label: text('activity.tray.showAll'),
        enabled: true,
        action: { kind: 'showInbox' },
      },
      {
        type: 'normal',
        label: text('activity.tray.markAllRead'),
        enabled: count > 0,
        action: { kind: 'markAllRead' },
      },
      { type: 'separator' },
      {
        type: 'checkbox',
        label: text('activity.tray.sound'),
        checked: settings.sound,
        // Like Settings: no notifications, no sound to choose.
        enabled: settings.level !== 'off',
        action: { kind: 'setSound', sound: !settings.sound },
      },
      { type: 'separator' },
      {
        type: 'normal',
        label: text('activity.tray.quit'),
        enabled: true,
        action: { kind: 'quit' },
      },
    ],
  }
}
