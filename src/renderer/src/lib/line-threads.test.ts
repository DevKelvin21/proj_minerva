import { describe, expect, it } from 'vitest'
import {
  excerptWindow,
  indexLineThreads,
  lineThreadKey,
  resolveNewThreadPosition,
  threadLineRange,
} from './line-threads'
import type { CommentThread } from '../../../shared/types'

const author = { login: 'dkumar', avatarUrl: '' }

function makeThread(overrides: Partial<CommentThread>): CommentThread {
  return {
    id: 'thread-1',
    status: 'active',
    isResolved: false,
    isLineThread: true,
    comments: [
      {
        id: 'c-1',
        author,
        bodyMarkdown: 'hola',
        createdAt: '2026-07-01T00:00:00.000Z',
        isMinimized: false,
      },
    ],
    ...overrides,
  }
}

describe('indexLineThreads', () => {
  it('indexes only line threads matching the given file path', () => {
    const threads: CommentThread[] = [
      makeThread({ id: 't1', path: 'a.ts', line: 3, side: 'RIGHT' }),
      makeThread({ id: 't2', path: 'b.ts', line: 3, side: 'RIGHT' }),
      makeThread({ id: 't3', isLineThread: false, path: undefined, line: undefined }),
    ]

    const map = indexLineThreads(threads, 'a.ts')
    expect(map.size).toBe(1)
    expect(map.get(lineThreadKey(3, 'RIGHT'))?.[0].id).toBe('t1')
  })

  it('defaults to side RIGHT when the thread has no explicit side', () => {
    const threads: CommentThread[] = [
      makeThread({ id: 't1', path: 'a.ts', line: 10, side: undefined }),
    ]
    const map = indexLineThreads(threads, 'a.ts')
    expect(map.get(lineThreadKey(10, 'RIGHT'))?.[0].id).toBe('t1')
  })

  it('distinguishes LEFT and RIGHT threads on the same line number', () => {
    const threads: CommentThread[] = [
      makeThread({ id: 'left', path: 'a.ts', line: 5, side: 'LEFT' }),
      makeThread({ id: 'right', path: 'a.ts', line: 5, side: 'RIGHT' }),
    ]
    const map = indexLineThreads(threads, 'a.ts')
    expect(map.get(lineThreadKey(5, 'LEFT'))?.[0].id).toBe('left')
    expect(map.get(lineThreadKey(5, 'RIGHT'))?.[0].id).toBe('right')
  })

  it('keeps every thread that lands on the same position, in order', () => {
    const threads: CommentThread[] = [
      makeThread({ id: 'first', path: 'a.ts', line: 5, side: 'RIGHT' }),
      makeThread({ id: 'second', path: 'a.ts', line: 5, side: 'RIGHT' }),
    ]
    const map = indexLineThreads(threads, 'a.ts')
    expect(map.get(lineThreadKey(5, 'RIGHT'))?.map((t) => t.id)).toEqual(['first', 'second'])
  })
})

describe('resolveNewThreadPosition', () => {
  it('uses the old line number and side LEFT for deletions', () => {
    expect(resolveNewThreadPosition(true, 12, undefined)).toEqual({ line: 12, side: 'LEFT' })
  })

  it('uses the new line number and side RIGHT for context/addition lines', () => {
    expect(resolveNewThreadPosition(false, undefined, 8)).toEqual({ line: 8, side: 'RIGHT' })
    expect(resolveNewThreadPosition(false, 8, 9)).toEqual({ line: 9, side: 'RIGHT' })
  })

  it('returns undefined when the required line number is missing', () => {
    expect(resolveNewThreadPosition(true, undefined, 9)).toBeUndefined()
    expect(resolveNewThreadPosition(false, 8, undefined)).toBeUndefined()
  })
})

describe('threadLineRange / excerptWindow', () => {
  it('covers line..lineEnd, and a single line without lineEnd', () => {
    expect(threadLineRange({ line: 2, lineEnd: 4 })).toEqual({ start: 2, end: 4 })
    expect(threadLineRange({ line: 7 })).toEqual({ start: 7, end: 7 })
    expect(threadLineRange({})).toBeNull()
  })

  it('pads the excerpt with context, clamped to the file', () => {
    expect(excerptWindow(12, 12, 20)).toEqual({ from: 9, to: 15 })
    expect(excerptWindow(1, 2, 3)).toEqual({ from: 1, to: 3 })
    expect(excerptWindow(30, 30, 20)).toBeNull()
    expect(excerptWindow(1, 1, 0)).toBeNull()
  })
})
