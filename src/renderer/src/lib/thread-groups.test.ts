import { describe, expect, it } from 'vitest'
import type { CommentThread } from '../../../shared/types'
import type { ThreadStatus } from '../../../shared/scm'
import {
  countThreadsByFilter,
  filterThreads,
  groupThreadsByFile,
  settableStatusesFor,
} from './thread-groups'

function thread(
  id: string,
  status: ThreadStatus,
  extra: Partial<CommentThread> = {},
): CommentThread {
  return {
    id,
    status,
    isResolved: status !== 'active' && status !== 'pending',
    isLineThread: extra.line !== undefined,
    comments: [
      {
        id: id + '/1',
        author: { login: 'ada', avatarUrl: '' },
        bodyMarkdown: 'x',
        createdAt: extra.comments?.[0]?.createdAt ?? '2026-10-14T09:00:00Z',
        isMinimized: false,
      },
    ],
    ...extra,
  }
}

// The #108 mock: every status, two general threads.
const THREADS: CommentThread[] = [
  thread('1', 'active', { path: 'src/cart/total.ts', line: 2, lineEnd: 3 }),
  thread('2', 'pending', { path: 'src/cart/total.ts', line: 1 }),
  thread('3', 'resolved', { path: 'src/cart/total.ts', line: 2, side: 'LEFT' }),
  thread('4', 'wont_fix'),
  thread('5', 'closed'),
  thread('6', 'by_design', { path: 'src/cart/total.ts', line: 4 }),
  thread('7', 'active', { path: 'README.md', line: 9 }),
]

describe('filterThreads / countThreadsByFilter', () => {
  it('"open" means active or pending', () => {
    expect(filterThreads(THREADS, 'open').map((t) => t.id)).toEqual(['1', '2', '7'])
    expect(filterThreads(THREADS, 'all')).toHaveLength(7)
    expect(filterThreads(THREADS, 'wont_fix').map((t) => t.id)).toEqual(['4'])
  })

  it('counts every filter, with 0 for absent statuses', () => {
    expect(countThreadsByFilter(THREADS)).toEqual({
      open: 3,
      all: 7,
      active: 2,
      pending: 1,
      resolved: 1,
      wont_fix: 1,
      closed: 1,
      by_design: 1,
    })
    expect(countThreadsByFilter([]).resolved).toBe(0)
  })
})

describe('groupThreadsByFile', () => {
  it('puts General first, then files alphabetically, threads by line', () => {
    const groups = groupThreadsByFile(THREADS)
    expect(groups.map((g) => g.path)).toEqual([null, 'README.md', 'src/cart/total.ts'])
    expect(groups[0].threads.map((t) => t.id)).toEqual(['4', '5'])
    expect(groups[2].threads.map((t) => t.id)).toEqual(['2', '1', '3', '6'])
  })

  it('keeps file-level threads (path, no line) under their file, first', () => {
    const groups = groupThreadsByFile([
      thread('a', 'active', { path: 'x.ts', line: 3 }),
      thread('b', 'active', { path: 'x.ts' }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].threads.map((t) => t.id)).toEqual(['b', 'a'])
  })
})

describe('settableStatusesFor', () => {
  it('GitHub review threads: active/resolved; GitHub general comments: none', () => {
    expect(settableStatusesFor('github', { id: 'PRRT_1', isLineThread: true })).toEqual([
      'active',
      'resolved',
    ])
    expect(settableStatusesFor('github', { id: 'issue-9', isLineThread: false })).toEqual([])
  })

  it('Azure: all six, for line and general threads', () => {
    expect(settableStatusesFor('azure', { id: '4', isLineThread: false })).toHaveLength(6)
  })
})
