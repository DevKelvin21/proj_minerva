/**
 * Context items of the side-panel chat (`shared/chat.ts`): building them from
 * a diff line or a comment thread (line, file or PR-level), and fitting them
 * to what main takes.
 *
 * Every item of one message must fit `MAX_CHAT_CONTEXT_LEN` characters
 * together (codes, notes, authors, comment bodies; main rejects more), so
 * `fitContext` trims before sending:
 *
 * - Everything is sent as is when it fits.
 * - Otherwise the lines go first (up to the whole budget without threads,
 *   else what the threads leave, never less than half): each line gets a fair
 *   share, split between its code and the reviewer's note.
 * - The threads share the rest: the cheapest ones whole, the others cut. A
 *   cut thread keeps its first comment (the concern), then the newest replies
 *   that fit, the last one shortened with "…".
 *
 * The question itself is never part of the budget, so it is never cut.
 */
import type {
  ChatContextItem,
  ChatLineContext,
  ChatSide,
  ChatThreadContext,
  ChatThreadOrigin,
} from '../../../shared/chat'
import {
  MAX_CHAT_AUTHOR_LEN,
  MAX_CHAT_CODE_LEN,
  MAX_CHAT_CONTEXT_LEN,
  MAX_CHAT_NOTE_LEN,
  MAX_CHAT_THREAD_COMMENTS,
} from '../../../shared/chat'
import type { CommentThread, ThreadOrigin } from '../../../shared/types'
import { threadLineRange, threadSide, type LineSide } from './line-threads'
import { hasCommentedVersion } from './thread-origin'

/** Below this many characters a shortened piece says too little to be worth sending. */
const MIN_PIECE = 40

type ThreadComment = ChatThreadContext['comments'][number]

export function chatSide(side: LineSide): ChatSide {
  return side === 'LEFT' ? 'old' : 'new'
}

export function diffSide(side: ChatSide): LineSide {
  return side === 'old' ? 'LEFT' : 'RIGHT'
}

let sequence = 0

/** Client-made id of a context item (unique within the session, so within a message). */
export function newContextItemId(): string {
  sequence += 1
  return `ctx-${sequence}`
}

/** A diff line as a context item: its content and the reviewer's note, both capped. */
export function lineContextItem(input: {
  path: string
  side: LineSide
  line: number
  code: string
  note: string
}): ChatLineContext {
  return {
    kind: 'line',
    id: newContextItemId(),
    path: input.path,
    side: chatSide(input.side),
    line: input.line,
    code: clip(input.code, MAX_CHAT_CODE_LEN),
    note: clip(input.note.trim(), MAX_CHAT_NOTE_LEN),
  }
}

/**
 * A comment thread as a context item: author (display name, else login) and
 * body of each visible comment (all of them when every one is hidden), its
 * first one plus the newest replies the channel takes. A thread with no file
 * is a PR-level one (no path, side or lines). An outdated line thread whose
 * provider said where it was written carries that `origin`, so main sends the
 * code as commented. `null` for a thread with no comments (nothing to send).
 */
export function threadContextItem(thread: CommentThread): ChatThreadContext | null {
  if (thread.comments.length === 0) return null
  const visible = thread.comments.filter((c) => !c.isMinimized)
  const all = (visible.length > 0 ? visible : thread.comments).map((c) => ({
    author: clip(c.author.displayName || c.author.login || '?', MAX_CHAT_AUTHOR_LEN),
    body: c.bodyMarkdown,
  }))
  const [first, ...rest] = all
  const comments = [first, ...rest.slice(-(MAX_CHAT_THREAD_COMMENTS - 1))]
  const base = {
    kind: 'thread' as const,
    id: newContextItemId(),
    threadId: thread.id,
    outdated: thread.isOutdated === true,
    comments,
  }
  if (!thread.path) return { ...base, outdated: false }
  const range = threadLineRange(thread)
  return {
    ...base,
    path: thread.path,
    side: chatSide(threadSide(thread)),
    ...(range ? { startLine: range.start, endLine: range.end } : {}),
    ...(hasCommentedVersion(thread) ? { origin: chatOrigin(thread.origin) } : {}),
  }
}

function chatOrigin(origin: ThreadOrigin): ChatThreadOrigin {
  return {
    commit: origin.commit,
    ...(origin.path ? { path: origin.path } : {}),
    line: origin.line,
    ...(origin.lineEnd !== undefined && origin.lineEnd >= origin.line
      ? { lineEnd: origin.lineEnd }
      : {}),
  }
}

/** A thread with no file: a "general comment" on the whole PR. */
export function isGeneralThreadItem(
  item: ChatContextItem,
): item is ChatThreadContext & { path: undefined } {
  return item.kind === 'thread' && item.path === undefined
}

/** Who started a thread item (its first comment's author), for a general comment's chip. */
export function contextItemAuthor(item: ChatThreadContext): string {
  return item.comments[0]?.author ?? '?'
}

/**
 * `path:12` or `path:12-14` (a file-level thread: just the path). `null` for
 * a PR-level thread, which has no location (its chip names its author).
 */
export function contextItemLocation(item: ChatContextItem): string | null {
  if (item.kind === 'line') return `${item.path}:${item.line}`
  if (item.path === undefined) return null
  if (item.startLine === undefined) return item.path
  return item.endLine !== undefined && item.endLine > item.startLine
    ? `${item.path}:${item.startLine}-${item.endLine}`
    : `${item.path}:${item.startLine}`
}

/** Characters of `item` that count against `MAX_CHAT_CONTEXT_LEN`. */
export function contextCost(item: ChatContextItem): number {
  if (item.kind === 'line') return item.code.length + item.note.length
  return item.comments.reduce((n, c) => n + commentCost(c), 0)
}

/** `items` trimmed to fit `budget` together (see the header); order is kept. */
export function fitContext(
  items: readonly ChatContextItem[],
  budget: number = MAX_CHAT_CONTEXT_LEN,
): ChatContextItem[] {
  const total = items.reduce((n, item) => n + contextCost(item), 0)
  if (total <= budget) return [...items]

  const lines = items.filter((item): item is ChatLineContext => item.kind === 'line')
  const threads = items.filter((item): item is ChatThreadContext => item.kind === 'thread')
  const lineCost = lines.reduce((n, item) => n + contextCost(item), 0)
  const threadCost = total - lineCost
  const lineRoom = Math.min(
    lineCost,
    threads.length > 0 ? Math.max(budget - threadCost, Math.floor(budget / 2)) : budget,
  )

  const fitted = new Map<string, ChatContextItem>()
  const lineShares = fairShares(
    lines.map((item) => contextCost(item)),
    lineRoom,
  )
  lines.forEach((item, i) => fitted.set(item.id, fitLine(item, lineShares[i])))
  const usedByLines = lines.reduce((n, item) => n + contextCost(fitted.get(item.id)!), 0)

  const threadShares = fairShares(
    threads.map((item) => contextCost(item)),
    budget - usedByLines,
  )
  threads.forEach((item, i) =>
    fitted.set(item.id, { ...item, comments: fitComments(item.comments, threadShares[i]) }),
  )
  return items.map((item) => fitted.get(item.id) ?? item)
}

/**
 * Splits `budget` among pieces wanting `costs`: the cheapest get all they
 * want, the rest share what is left evenly. Answers one share per cost, in order.
 */
function fairShares(costs: readonly number[], budget: number): number[] {
  const shares = new Array<number>(costs.length).fill(0)
  const order = costs.map((cost, i) => ({ cost, i })).sort((a, b) => a.cost - b.cost)
  let room = Math.max(0, budget)
  order.forEach(({ cost, i }, k) => {
    const share = Math.min(cost, Math.floor(room / (order.length - k)))
    shares[i] = share
    room -= share
  })
  return shares
}

/** One line cut to `share` characters: the note keeps at least half when the code is long. */
function fitLine(item: ChatLineContext, share: number): ChatLineContext {
  if (item.code.length + item.note.length <= share) return item
  const codeRoom = Math.min(item.code.length, Math.max(share - item.note.length, Math.floor(share / 2)))
  return { ...item, code: clip(item.code, codeRoom), note: clip(item.note, share - codeRoom) }
}

function commentCost(c: ThreadComment): number {
  return c.author.length + c.body.length
}

/** A thread's comments cut to `budget`: the first one kept (shortened if needed), then the newest replies. */
export function fitComments(comments: readonly ThreadComment[], budget: number): ThreadComment[] {
  if (comments.length === 0) return []
  const [first, ...replies] = comments
  if (comments.reduce((n, c) => n + commentCost(c), 0) <= budget) return [...comments]

  // The first comment gets what the replies leave, and at least half.
  const repliesCost = replies.reduce((n, c) => n + commentCost(c), 0)
  const firstRoom = Math.max(
    0,
    Math.min(commentCost(first), Math.max(budget - repliesCost, Math.floor(budget / 2))) -
      first.author.length,
  )
  const kept = [{ author: first.author, body: clip(first.body, firstRoom) }]
  let room = budget - commentCost(kept[0])
  const newest: ThreadComment[] = []
  for (let i = replies.length - 1; i >= 0; i--) {
    const reply = replies[i]
    if (commentCost(reply) <= room) {
      newest.unshift(reply)
      room -= commentCost(reply)
      continue
    }
    const bodyRoom = room - reply.author.length
    if (bodyRoom >= MIN_PIECE)
      newest.unshift({ author: reply.author, body: clip(reply.body, bodyRoom) })
    break
  }
  return [...kept, ...newest]
}

function clip(text: string, length: number): string {
  if (text.length <= length) return text
  if (length <= 1) return ''
  return text.slice(0, length - 1) + '…'
}
