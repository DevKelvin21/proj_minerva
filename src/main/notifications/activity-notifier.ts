/**
 * Outward signals of the activity inbox (`docs/plan-notifications.md`, step
 * 3): the unread count on the dock / taskbar icon, and ONE system
 * notification per batch of new items, only for what the notification level
 * lets through (default: items aimed at the user directly) and only while
 * the app is not focused (in the app, the Inbox badge is enough).
 *
 * Pure over its deps (badge, focus, notification display, text), so the
 * rules are unit-tested without Electron; `activity-notifier-electron.ts`
 * is the thin real binding.
 *
 * Every string shown comes from items main already sanitized (one line,
 * capped); system notifications render plain text.
 */
import type {
  ActivityItem,
  ActivityState,
  NotificationLevel,
  NotificationSettings,
} from '../../shared/activity'

export interface NotificationContent {
  title: string
  body: string
  /** The item to open on click; `null` = several items, open the Inbox. */
  itemId: string | null
}

export interface ActivityNotifierDeps {
  getSettings: () => NotificationSettings
  setBadge: (count: number) => void
  isAppFocused: () => boolean
  show: (content: NotificationContent) => void
  /** Translated text (main's `mt`), keys under `activity.notification`. */
  text: (key: NotificationTextKey, vars: Record<string, string | number>) => string
}

export type NotificationTextKey =
  | 'activity.notification.commentTitle'
  | 'activity.notification.commentBody'
  | 'activity.notification.replyBody'
  | 'activity.notification.orphanTitle'
  | 'activity.notification.orphanBody'
  | 'activity.notification.manyTitle'
  | 'activity.notification.manyBody'
  | 'activity.notification.manyBodyOnePr'
  | 'activity.notification.reviewTitle'
  | 'activity.notification.requestTitle'
  | 'activity.notification.requestBody'
  | 'activity.notification.requestBodyOptional'
  | `activity.notification.vote.${'approved' | 'approved_with_suggestions' | 'changes_requested' | 'rejected'}`

export interface ActivityNotifier {
  /** After every inbox change: badge always, a notification for `added` when due. */
  onActivity(state: ActivityState, added: readonly ActivityItem[]): void
  /** Re-applies the badge (startup, or after the badge setting changed). */
  refreshBadge(state: ActivityState): void
}

/** The new items the level lets through (exported for tests). */
export function notifiable(
  added: readonly ActivityItem[],
  level: NotificationLevel,
): ActivityItem[] {
  if (level === 'off') return []
  return added.filter((item) => !item.read && (level === 'all' || item.direct))
}

/** One notification for a batch: the item itself when alone, a count otherwise (exported for tests). */
export function notificationFor(
  items: readonly ActivityItem[],
  text: ActivityNotifierDeps['text'],
): NotificationContent | null {
  if (items.length === 0) return null
  if (items.length === 1) {
    const [item] = items
    const pr = { number: item.number, title: item.prTitle }
    if (item.kind === 'review') {
      return {
        title: text('activity.notification.reviewTitle', pr),
        body: text(`activity.notification.vote.${item.vote}`, {
          reviewer: item.reviewer.displayName ?? item.reviewer.login,
        }),
        itemId: item.id,
      }
    }
    if (item.kind === 'review_request') {
      return {
        title: text('activity.notification.requestTitle', pr),
        body: text(
          item.required
            ? 'activity.notification.requestBody'
            : 'activity.notification.requestBodyOptional',
          pr,
        ),
        itemId: item.id,
      }
    }
    if (item.kind === 'orphan') {
      return {
        title: text('activity.notification.orphanTitle', pr),
        body: text('activity.notification.orphanBody', {
          parent: item.parent.number,
          base: item.suggestedBase,
        }),
        itemId: item.id,
      }
    }
    return {
      title: text('activity.notification.commentTitle', pr),
      body: text(
        item.isReply ? 'activity.notification.replyBody' : 'activity.notification.commentBody',
        {
          author: item.author.displayName ?? item.author.login,
          excerpt: item.excerpt,
        },
      ),
      itemId: item.id,
    }
  }
  const prs = new Set(items.map((item) => item.prKey)).size
  return {
    title: text('activity.notification.manyTitle', { count: items.length }),
    body: text(
      prs === 1 ? 'activity.notification.manyBodyOnePr' : 'activity.notification.manyBody',
      { count: items.length, prs },
    ),
    itemId: null,
  }
}

export function createActivityNotifier(deps: ActivityNotifierDeps): ActivityNotifier {
  const refreshBadge = (state: ActivityState): void => {
    deps.setBadge(deps.getSettings().badge ? state.unreadCount : 0)
  }
  return {
    refreshBadge,
    onActivity(state, added) {
      refreshBadge(state)
      if (deps.isAppFocused()) return
      const content = notificationFor(notifiable(added, deps.getSettings().level), deps.text)
      if (content) deps.show(content)
    },
  }
}
