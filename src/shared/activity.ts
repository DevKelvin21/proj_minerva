/**
 * The activity inbox contract (`docs/plan-notifications.md`): what happened on
 * the user's PRs since they last looked. Built in main by
 * `main/scm/activity-service.ts` from the PR watcher's listing; the renderer
 * reads it with `activity:get` and gets `activityChanged` pushes.
 *
 * Every text field that comes from a PR (titles, excerpts, logins) is
 * UNTRUSTED: main flattens and caps it, and the renderer shows it as plain
 * text, never as Markdown or HTML.
 */
import type { RepoRef, ReviewerVote } from './scm'
import { isRepoRef } from './scm-guards'
import type { UserRef } from './types'

/** Longest comment excerpt main keeps (characters, after flattening to one line). */
export const ACTIVITY_EXCERPT_MAX = 160

interface ActivityItemBase {
  /**
   * Stable id: `comment:<prKey>:<commentId>`, `orphan:<prKey>:<parentNumber>`,
   * `review:<prKey>:<login>:<vote>:<at>` or `request:<prKey>:<at>`.
   */
  id: string
  /** `prKey(repo, number)` of the PR the item is about. */
  prKey: string
  repo: RepoRef
  number: number
  prTitle: string
  /** When it happened (the comment's `createdAt`; for an orphan, when it was detected). ISO. */
  at: string
  read: boolean
  /**
   * Aimed at the user directly: a comment on their own PR, a reply in a
   * thread they wrote in, or an orphan of their own PR. The rest is
   * "everything" level (notifications, step 3, only alert on `direct`).
   */
  direct: boolean
}

export interface ActivityCommentItem extends ActivityItemBase {
  kind: 'comment'
  threadId: string
  commentId: string
  author: UserRef
  /** One line, control characters stripped, at most `ACTIVITY_EXCERPT_MAX` characters. */
  excerpt: string
  /** A comment on a diff line (`path` + `line` set) vs. the PR conversation. */
  isLineThread: boolean
  path?: string
  line?: number
  side?: 'LEFT' | 'RIGHT'
  /** Not the first comment of its thread. */
  isReply: boolean
}

export interface ActivityOrphanItem extends ActivityItemBase {
  kind: 'orphan'
  /** The completed parent PR whose source branch this PR still targets. */
  parent: { number: number; title: string; mergedInto: string }
  suggestedBase: string
}

/** A vote on one of the user's own PRs (approved, changes requested, rejected…). */
export interface ActivityReviewItem extends ActivityItemBase {
  kind: 'review'
  reviewer: UserRef
  vote: Exclude<ReviewerVote, 'none'>
}

/** The user was asked to review (newly added, or re-requested after voting). */
export interface ActivityReviewRequestItem extends ActivityItemBase {
  kind: 'review_request'
  /** Required reviewer (direct) vs. optional. */
  required: boolean
}

export type ActivityItem =
  ActivityCommentItem | ActivityOrphanItem | ActivityReviewItem | ActivityReviewRequestItem

const REVIEW_VOTES: readonly ReviewerVote[] = [
  'approved',
  'approved_with_suggestions',
  'changes_requested',
  'rejected',
]

/** Answer of `activity:get` and payload of the `activityChanged` push: always the full state. */
export interface ActivityState {
  /** Newest first. */
  items: ActivityItem[]
  unreadCount: number
}

/** Request of `activity:markRead`: some items, or every one. */
export type MarkActivityReadRequest = { ids: string[] } | { all: true }

/** Request of `activity:dismiss` ("Done"): the items leave the inbox and never come back. */
export interface DismissActivityRequest {
  ids: string[]
}

/**
 * Which new items raise a system notification: none, only the ones aimed at
 * the user (`ActivityItem.direct`), or every one.
 */
export type NotificationLevel = 'off' | 'direct' | 'all'

export const NOTIFICATION_LEVELS: readonly NotificationLevel[] = ['off', 'direct', 'all']

/** Settings → Notifications, saved in settings.json (`notifications`). */
export interface NotificationSettings {
  level: NotificationLevel
  /** Unread count on the dock / taskbar icon. */
  badge: boolean
}

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = { level: 'direct', badge: true }

/** Exactly `{ level, badge }` with valid values (settings.json on load, IPC payloads). */
export function isNotificationSettings(value: unknown): value is NotificationSettings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const v = value as Record<string, unknown>
  return (
    Object.keys(v).every((key) => key === 'level' || key === 'badge') &&
    NOTIFICATION_LEVELS.includes(v.level as NotificationLevel) &&
    typeof v.badge === 'boolean'
  )
}

// ---------------------------------------------------------------------------
// Shape guards: `activity.json` on load (main) and the `activityChanged`
// payload (preload). Shape only; the text was sanitized when the item was made.
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const isString = (value: unknown): value is string => typeof value === 'string'
const isOptional = <T>(value: unknown, guard: (v: unknown) => v is T): boolean =>
  value === undefined || guard(value)
const isPositiveInt = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0

function isUserRef(value: unknown): value is UserRef {
  return (
    isRecord(value) &&
    isString(value.login) &&
    isOptional(value.displayName, isString) &&
    isOptional(value.avatarUrl, isString)
  )
}

export function isActivityItem(value: unknown): value is ActivityItem {
  if (!isRecord(value)) return false
  const base =
    isString(value.id) &&
    isString(value.prKey) &&
    isRepoRef(value.repo) &&
    isPositiveInt(value.number) &&
    isString(value.prTitle) &&
    isString(value.at) &&
    typeof value.read === 'boolean' &&
    typeof value.direct === 'boolean'
  if (!base) return false
  if (value.kind === 'comment') {
    return (
      isString(value.threadId) &&
      isString(value.commentId) &&
      isUserRef(value.author) &&
      isString(value.excerpt) &&
      typeof value.isLineThread === 'boolean' &&
      isOptional(value.path, isString) &&
      isOptional(value.line, isPositiveInt) &&
      (value.side === undefined || value.side === 'LEFT' || value.side === 'RIGHT') &&
      typeof value.isReply === 'boolean'
    )
  }
  if (value.kind === 'review') {
    return isUserRef(value.reviewer) && REVIEW_VOTES.includes(value.vote as ReviewerVote)
  }
  if (value.kind === 'review_request') {
    return typeof value.required === 'boolean'
  }
  if (value.kind === 'orphan') {
    const parent = value.parent
    return (
      isRecord(parent) &&
      isPositiveInt(parent.number) &&
      isString(parent.title) &&
      isString(parent.mergedInto) &&
      isString(value.suggestedBase)
    )
  }
  return false
}

export function isActivityState(value: unknown): value is ActivityState {
  return (
    isRecord(value) &&
    Array.isArray(value.items) &&
    value.items.every(isActivityItem) &&
    typeof value.unreadCount === 'number' &&
    Number.isInteger(value.unreadCount) &&
    value.unreadCount >= 0
  )
}
