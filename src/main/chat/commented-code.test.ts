import { describe, expect, it, vi } from 'vitest'
import type { ChatContextItem, ChatThreadContext } from '../../shared/chat'
import type { FileContentRequest, RepoRef } from '../../shared/types'
import {
  commentedExcerpt,
  MAX_COMMENTED_CODE_LINES,
  MAX_COMMENTED_CODE_TOTAL,
  readCommentedCode,
} from './commented-code'

const repo: RepoRef = { provider: 'github', owner: 'o', name: 'r', fullName: 'o/r' }
const COMMIT = 'ab'.repeat(20)
const file = Array.from({ length: 30 }, (_, i) => 'line ' + (i + 1)).join('\n') + '\n'

const outdated: ChatThreadContext = {
  kind: 'thread',
  id: 't1',
  threadId: 'PRRT_1',
  path: 'src/now.ts',
  side: 'new',
  startLine: 20,
  endLine: 20,
  outdated: true,
  origin: { commit: COMMIT, path: 'src/then.ts', line: 8, lineEnd: 9 },
  comments: [{ author: 'a', body: 'b' }],
}

describe('commentedExcerpt', () => {
  it('keeps five lines around the thread, numbered from the first one', () => {
    const code = commentedExcerpt(file, COMMIT, 'src/then.ts', 8, 9)!
    expect(code.firstLine).toBe(3)
    expect(code.lines[0]).toBe('line 3')
    expect(code.lines.at(-1)).toBe('line 14')
    expect(code).toMatchObject({ commit: COMMIT, path: 'src/then.ts', start: 8, end: 9 })
  })

  it('clamps at both ends of the file and answers null past its end', () => {
    const top = commentedExcerpt('a\r\nb\r\nc', COMMIT, 'x', 1)!
    expect(top).toMatchObject({ firstLine: 1, lines: ['a', 'b', 'c'], start: 1, end: 1 })
    expect(commentedExcerpt(file, COMMIT, 'x', 31)).toBeNull()
    expect(commentedExcerpt(file, COMMIT, 'x', 29, 40)!.end).toBe(30)
  })

  it('caps a long range at the line limit and long lines with an ellipsis', () => {
    const long = Array.from({ length: 200 }, () => 'x'.repeat(500)).join('\n')
    const code = commentedExcerpt(long, COMMIT, 'x', 10, 150)!
    expect(code.lines).toHaveLength(MAX_COMMENTED_CODE_LINES)
    expect(code.lines[0]).toHaveLength(300)
    expect(code.lines[0].endsWith('…')).toBe(true)
  })
})

describe('readCommentedCode', () => {
  it('reads only outdated threads with an origin, at that commit and path', async () => {
    const read = vi.fn(async (_req: FileContentRequest) => ({
      content: file,
      isBinary: false,
      tooLarge: false,
    }))
    const context: ChatContextItem[] = [
      outdated,
      { ...outdated, id: 't2', outdated: false },
      { ...outdated, id: 't3', origin: undefined },
      { kind: 'thread', id: 'g', threadId: 'G', outdated: false, comments: [] },
      { kind: 'line', id: 'l', path: 'a', side: 'new', line: 1, code: '', note: '' },
    ]
    const result = await readCommentedCode(repo, 7, context, read)
    expect(read).toHaveBeenCalledTimes(1)
    expect(read).toHaveBeenCalledWith({
      repo,
      number: 7,
      path: 'src/then.ts',
      side: 'head',
      commit: COMMIT,
    })
    expect(Object.keys(result)).toEqual(['t1'])
    expect(result.t1.start).toBe(8)
  })

  it('leaves out a failed, binary or empty read, and never throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const reads = [
      Promise.reject(new Error('[SCM:NOT_FOUND] gone')),
      Promise.resolve({ content: null, isBinary: false, tooLarge: false }),
      Promise.resolve({ content: 'x', isBinary: true, tooLarge: false }),
    ]
    const read = vi.fn(() => reads.shift()!)
    const context = ['a', 'b', 'c'].map((id) => ({ ...outdated, id }))
    await expect(readCommentedCode(repo, 7, context, read)).resolves.toEqual({})
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).not.toContain('src/')
    warn.mockRestore()
  })

  it('keeps all excerpts of one message within the shared budget', async () => {
    const wide = Array.from({ length: 30 }, () => 'y'.repeat(290)).join('\n')
    const read = vi.fn(async () => ({ content: wide, isBinary: false, tooLarge: false }))
    const context = Array.from({ length: 10 }, (_, i) => ({ ...outdated, id: 't' + i }))
    const result = await readCommentedCode(repo, 7, context, read)
    const size = Object.values(result).reduce(
      (n, code) => n + code.lines.reduce((m, line) => m + line.length + 1, 0),
      0,
    )
    expect(size).toBeLessThanOrEqual(MAX_COMMENTED_CODE_TOTAL)
    expect(Object.keys(result).length).toBeGreaterThan(0)
    expect(Object.keys(result).length).toBeLessThan(10)
  })
})
