import { describe, expect, it } from 'vitest'
import { githubRepo } from '../../shared/scm-guards'
import type { CommentThread } from '../../shared/types'
import { ThreadOriginCommits } from './thread-origins'

const repo = githubRepo('shopwave', 'api')
const sha = (c: string): string => c.repeat(40)

function thread(commit?: string): CommentThread {
  return {
    id: 't',
    status: 'active',
    isResolved: false,
    isLineThread: true,
    comments: [],
    ...(commit ? { origin: { commit, line: 1 } } : {}),
  }
}

describe('ThreadOriginCommits', () => {
  it('knows only the commits it recorded, per PR, case-insensitively', () => {
    const origins = new ThreadOriginCommits()
    origins.record(repo, 1, [thread(sha('a')), thread(), thread(sha('B'))])
    expect(origins.has(repo, 1, sha('a'))).toBe(true)
    expect(origins.has(repo, 1, sha('b'))).toBe(true)
    expect(origins.has(repo, 2, sha('a'))).toBe(false)
    expect(origins.has(githubRepo('shopwave', 'web'), 1, sha('a'))).toBe(false)
    expect(origins.has(repo, 1, sha('c'))).toBe(false)
  })

  it('ignores anything that is not a full SHA and keeps older commits', () => {
    const origins = new ThreadOriginCommits()
    origins.record(repo, 1, [thread('main'), thread('abc1234')])
    expect(origins.has(repo, 1, 'main')).toBe(false)
    origins.record(repo, 1, [thread(sha('a'))])
    origins.record(repo, 1, [thread(sha('b'))])
    expect(origins.has(repo, 1, sha('a'))).toBe(true)
  })

  it('forgets the least recently recorded PR past its cap', () => {
    const origins = new ThreadOriginCommits(2)
    origins.record(repo, 1, [thread(sha('a'))])
    origins.record(repo, 2, [thread(sha('a'))])
    origins.record(repo, 3, [thread(sha('a'))])
    expect(origins.has(repo, 1, sha('a'))).toBe(false)
    expect(origins.has(repo, 3, sha('a'))).toBe(true)
  })
})
