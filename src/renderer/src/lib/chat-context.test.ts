import { describe, expect, it } from 'vitest'
import type { ChatContextItem, ChatThreadContext } from '../../../shared/chat'
import { MAX_CHAT_CONTEXT_LEN, MAX_CHAT_NOTE_LEN, MAX_CHAT_THREAD_COMMENTS } from '../../../shared/chat'
import type { CommentThread, PrComment } from '../../../shared/types'
import {
  contextCost,
  fitComments,
  fitContext,
  lineContextItem,
  threadContextItem,
} from './chat-context'

const size = (items: readonly ChatContextItem[]): number =>
  items.reduce((n, item) => n + contextCost(item), 0)

const line = (code: string, note = '') =>
  lineContextItem({ path: 'src/a.ts', side: 'RIGHT', line: 4, code, note })

const thread = (...bodies: string[]): ChatThreadContext => ({
  kind: 'thread',
  id: 'thread-' + bodies.length + '-' + bodies.join('').length,
  threadId: 't',
  path: 'src/a.ts',
  side: 'new',
  outdated: false,
  comments: bodies.map((body, i) => ({ author: 'user' + i, body })),
})

describe('lineContextItem', () => {
  it('maps the diff side and caps the note', () => {
    const item = lineContextItem({
      path: 'src/old.ts',
      side: 'LEFT',
      line: 7,
      code: 'const a = 1',
      note: '  ' + 'n'.repeat(MAX_CHAT_NOTE_LEN + 10) + '  ',
    })
    expect(item).toMatchObject({ kind: 'line', path: 'src/old.ts', side: 'old', line: 7 })
    expect(item.note).toHaveLength(MAX_CHAT_NOTE_LEN)
    expect(item.note.endsWith('…')).toBe(true)
    expect(line('x').id).not.toBe(line('x').id)
  })
})

describe('threadContextItem', () => {
  const comment = (over: Partial<PrComment>): PrComment => ({
    id: 'c',
    author: { login: 'alice' },
    bodyMarkdown: 'body',
    createdAt: '2026-01-01T00:00:00.000Z',
    isMinimized: false,
    ...over,
  })
  const base: CommentThread = {
    id: 't1',
    status: 'active',
    isResolved: false,
    isLineThread: true,
    path: 'src/a.ts',
    line: 12,
    lineEnd: 14,
    side: 'RIGHT',
    comments: [comment({})],
  }

  it('names authors by display name, skips hidden comments and flags outdated threads', () => {
    const item = threadContextItem({
      ...base,
      isOutdated: true,
      comments: [
        comment({ author: { login: 'alice', displayName: 'Alice A.' }, bodyMarkdown: 'Concern' }),
        comment({ bodyMarkdown: 'spam', isMinimized: true }),
        comment({ author: { login: 'bob' }, bodyMarkdown: 'Reply' }),
      ],
    })
    expect(item).toMatchObject({
      kind: 'thread',
      threadId: 't1',
      path: 'src/a.ts',
      side: 'new',
      startLine: 12,
      endLine: 14,
      outdated: true,
      comments: [
        { author: 'Alice A.', body: 'Concern' },
        { author: 'bob', body: 'Reply' },
      ],
    })
  })

  it('keeps hidden comments when they are all there is, and a file-level thread has no lines', () => {
    const item = threadContextItem({
      ...base,
      line: undefined,
      lineEnd: undefined,
      side: 'LEFT',
      comments: [comment({ isMinimized: true })],
    })
    expect(item?.comments).toHaveLength(1)
    expect(item?.side).toBe('old')
    expect(item && 'startLine' in item).toBe(false)
  })

  it('keeps the first comment and the newest replies the channel takes', () => {
    const comments = Array.from({ length: MAX_CHAT_THREAD_COMMENTS + 5 }, (_, i) =>
      comment({ id: 'c' + i, bodyMarkdown: 'body ' + i }),
    )
    const item = threadContextItem({ ...base, comments })
    expect(item?.comments).toHaveLength(MAX_CHAT_THREAD_COMMENTS)
    expect(item?.comments[0].body).toBe('body 0')
    expect(item?.comments[1].body).toBe('body 6')
    expect(item?.comments.at(-1)?.body).toBe('body ' + (MAX_CHAT_THREAD_COMMENTS + 4))
  })

  it('nothing to point at: no file or no comments', () => {
    expect(threadContextItem({ ...base, path: undefined })).toBeNull()
    expect(threadContextItem({ ...base, comments: [] })).toBeNull()
  })
})

describe('fitContext', () => {
  it('sends everything when it fits', () => {
    const items = [line('const a = 1', 'why?'), thread('Is this safe?', 'I think so.')]
    expect(fitContext(items)).toEqual(items)
    expect(fitContext([])).toEqual([])
  })

  it('cuts threads to what the lines leave, keeping each first comment and the order', () => {
    const long = 'y'.repeat(30_000)
    const items = [thread(long, 'short reply', long), line('const a = 1', 'note')]
    const fitted = fitContext(items)
    expect(size(fitted)).toBeLessThanOrEqual(MAX_CHAT_CONTEXT_LEN)
    expect(fitted.map((i) => i.kind)).toEqual(['thread', 'line'])
    expect(fitted[1]).toEqual(items[1])
    const comments = (fitted[0] as ChatThreadContext).comments
    expect(comments[0].author).toBe('user0')
    expect(comments[0].body.endsWith('…')).toBe(true)
    expect(comments.at(-1)?.author).toBe('user2')
  })

  it('a cheap thread stays whole while an expensive one is cut', () => {
    const items = [thread('small'), thread('a'.repeat(20_000), 'b'.repeat(20_000))]
    const fitted = fitContext(items)
    expect(fitted[0]).toEqual(items[0])
    expect(size(fitted)).toBeLessThanOrEqual(MAX_CHAT_CONTEXT_LEN)
    expect(size(fitted)).toBeGreaterThan(MAX_CHAT_CONTEXT_LEN / 2)
  })

  it('lines over the budget share it, the note keeping room next to long code', () => {
    const items = Array.from({ length: 10 }, () => line('c'.repeat(2000), 'n'.repeat(2000)))
    const fitted = fitContext(items)
    expect(size(fitted)).toBeLessThanOrEqual(MAX_CHAT_CONTEXT_LEN)
    for (const item of fitted) {
      if (item.kind !== 'line') throw new Error('expected a line')
      expect(item.note.length).toBeGreaterThan(1000)
      expect(item.code.length).toBeGreaterThan(1000)
    }
  })

  it('with threads too, the lines never take more than half when the threads need it', () => {
    const items = [
      ...Array.from({ length: 8 }, () => line('c'.repeat(2000), 'n'.repeat(2000))),
      thread('t'.repeat(30_000)),
    ]
    const fitted = fitContext(items)
    expect(size(fitted)).toBeLessThanOrEqual(MAX_CHAT_CONTEXT_LEN)
    const threadSize = contextCost(fitted.at(-1)!)
    expect(threadSize).toBeGreaterThanOrEqual(MAX_CHAT_CONTEXT_LEN / 2 - 100)
  })
})

describe('fitComments', () => {
  it('drops the oldest replies first and shortens the last one that partly fits', () => {
    const comments = [
      { author: 'a', body: 'first' },
      { author: 'b', body: 'x'.repeat(400) },
      { author: 'c', body: 'y'.repeat(400) },
    ]
    const fitted = fitComments(comments, 700)
    expect(fitted[0]).toEqual(comments[0])
    expect(fitted.at(-1)).toEqual(comments[2])
    expect(fitted[1].author).toBe('b')
    expect(fitted[1].body.endsWith('…')).toBe(true)
    expect(fitted.reduce((n, c) => n + c.author.length + c.body.length, 0)).toBeLessThanOrEqual(700)
  })
})
