/**
 * Shape checks of chat data that arrives from outside main's control: the
 * `chat:*` payloads (`../ipc/validators.ts`) and the JSON columns read back
 * from `chat.sqlite` (`./chat-db.ts`). Context items are checked field by
 * field against the limits of `shared/chat.ts`; the same rules on both sides,
 * so a row that went in through IPC reads back the same.
 */
import {
  MAX_CHAT_AUTHOR_LEN,
  MAX_CHAT_CODE_LEN,
  MAX_CHAT_CONTEXT_ITEMS,
  MAX_CHAT_CONTEXT_LEN,
  MAX_CHAT_NOTE_LEN,
  MAX_CHAT_PATH_LEN,
  MAX_CHAT_THREAD_COMMENTS,
  type ChatContextItem,
  type ChatThreadOrigin,
} from '../../shared/chat'
import { FULL_COMMIT_SHA_RE } from '../scm/thread-origins'

/** Longest id main accepts (conversation/message ids are UUIDs; context item ids are client-made). */
export const MAX_CHAT_ID_LEN = 100
/** Longest provider thread id a thread item carries. */
const MAX_CHAT_THREAD_ID_LEN = 200
/** Highest line number a context item can point at. */
const MAX_CHAT_LINE = 1_000_000

/** Conversation and message ids: what `randomUUID` makes, bounded (never a path or SQL). */
export function isChatId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_CHAT_ID_LEN &&
    /^[A-Za-z0-9_-]+$/.test(value)
  )
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key))
}

function isBoundedString(value: unknown, maxLen: number): value is string {
  return typeof value === 'string' && value.length <= maxLen
}

function isNonEmptyString(value: unknown, maxLen: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLen
}

function isLine(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_CHAT_LINE
  )
}

/** A repo-relative file path: no leading `/`, no `..` / `.` / empty segments, no control chars. */
function isChatPath(value: unknown): value is string {
  if (!isNonEmptyString(value, MAX_CHAT_PATH_LEN)) return false
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f\\]/.test(value)) return false
  return value.split('/').every((part) => part.length > 0 && part !== '.' && part !== '..')
}

/** Where an outdated line thread was written: a full commit SHA and its line(s) there. */
function isThreadOrigin(value: unknown): value is ChatThreadOrigin {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ['commit', 'path', 'line', 'lineEnd'])) {
    return false
  }
  if (typeof value.commit !== 'string' || !FULL_COMMIT_SHA_RE.test(value.commit)) return false
  if (value.path !== undefined && !isChatPath(value.path)) return false
  if (!isLine(value.line)) return false
  if (value.lineEnd !== undefined && (!isLine(value.lineEnd) || value.lineEnd < value.line)) {
    return false
  }
  return true
}

/**
 * Characters a valid context item counts toward `MAX_CHAT_CONTEXT_LEN`
 * (code, note, authors, comment bodies), or `null` when it is not valid.
 */
function contextItemLength(value: unknown): number | null {
  if (!isPlainObject(value)) return null
  if (!isNonEmptyString(value.id, MAX_CHAT_ID_LEN)) return null
  // Only a thread may point at no file (a PR-level thread): no path, no side, no lines.
  const general =
    value.kind === 'thread' && value.path === undefined && value.side === undefined
  if (!general) {
    if (!isChatPath(value.path)) return null
    if (value.side !== 'old' && value.side !== 'new') return null
  }

  if (value.kind === 'line') {
    if (!hasOnlyKeys(value, ['kind', 'id', 'path', 'side', 'line', 'code', 'note'])) return null
    if (!isLine(value.line)) return null
    if (!isBoundedString(value.code, MAX_CHAT_CODE_LEN)) return null
    if (!isBoundedString(value.note, MAX_CHAT_NOTE_LEN)) return null
    return value.code.length + value.note.length
  }

  if (value.kind === 'thread') {
    const keys = [
      'kind',
      'id',
      'threadId',
      'path',
      'side',
      'startLine',
      'endLine',
      'outdated',
      'origin',
      'comments',
    ]
    if (!hasOnlyKeys(value, keys)) return null
    if (!isNonEmptyString(value.threadId, MAX_CHAT_THREAD_ID_LEN)) return null
    if (value.startLine !== undefined || value.endLine !== undefined) {
      if (general) return null
      if (!isLine(value.startLine) || !isLine(value.endLine)) return null
      if (value.endLine < value.startLine) return null
    }
    if (typeof value.outdated !== 'boolean') return null
    if (value.origin !== undefined && (general || !isThreadOrigin(value.origin))) return null
    const comments = value.comments
    if (!Array.isArray(comments) || comments.length > MAX_CHAT_THREAD_COMMENTS) return null
    let total = 0
    for (const comment of comments) {
      if (!isPlainObject(comment) || !hasOnlyKeys(comment, ['author', 'body'])) return null
      if (!isNonEmptyString(comment.author, MAX_CHAT_AUTHOR_LEN)) return null
      if (!isBoundedString(comment.body, MAX_CHAT_CONTEXT_LEN)) return null
      total += comment.author.length + comment.body.length
    }
    return total
  }

  return null
}

/**
 * The context items of one message: at most `MAX_CHAT_CONTEXT_ITEMS`, each
 * valid, ids unique, all together within `MAX_CHAT_CONTEXT_LEN` characters.
 */
export function isChatContext(value: unknown): value is ChatContextItem[] {
  if (!Array.isArray(value) || value.length > MAX_CHAT_CONTEXT_ITEMS) return false
  const ids = new Set<string>()
  let total = 0
  for (const item of value) {
    const length = contextItemLength(item)
    if (length === null) return false
    const id = (item as { id: string }).id
    if (ids.has(id)) return false
    ids.add(id)
    total += length
  }
  return total <= MAX_CHAT_CONTEXT_LEN
}
