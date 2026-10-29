import { describe, expect, it } from 'vitest'
import type { CommentThread, ThreadOrigin } from '../../../shared/types'
import {
  fileGroupTag,
  hasCommentedVersion,
  removedInPush,
  shortCommit,
  versionLineRange,
} from './thread-origin'

const commit = 'abcdef0123'.repeat(4)
const origin = (push?: ThreadOrigin['push']): ThreadOrigin => ({
  commit,
  line: 14,
  lineEnd: 15,
  ...(push ? { push } : {}),
})

function thread(extra: Partial<CommentThread> = {}): CommentThread {
  return {
    id: '1',
    status: 'active',
    isResolved: false,
    isLineThread: true,
    path: 'src/a.ts',
    line: 20,
    side: 'RIGHT',
    comments: [],
    ...extra,
  }
}

describe('thread origin', () => {
  it('shortens a commit to 7 characters', () => {
    expect(shortCommit(commit)).toBe('abcdef0')
  })

  it('offers the commented version only for outdated RIGHT-side threads with an origin', () => {
    expect(hasCommentedVersion(thread({ isOutdated: true, origin: origin() }))).toBe(true)
    expect(hasCommentedVersion(thread({ origin: origin() }))).toBe(false)
    expect(hasCommentedVersion(thread({ isOutdated: true }))).toBe(false)
    expect(hasCommentedVersion(thread({ isOutdated: true, origin: origin(), side: 'LEFT' }))).toBe(
      false,
    )
    expect(
      hasCommentedVersion(thread({ isOutdated: true, origin: origin(), path: undefined })),
    ).toBe(false)
  })

  it("highlights the origin's lines as commented and the current ones on Latest", () => {
    const t = thread({ isOutdated: true, origin: origin() })
    expect(versionLineRange(t, 'commented')).toEqual({ start: 14, end: 15 })
    expect(versionLineRange(t, 'latest')).toEqual({ start: 20, end: 20 })
    expect(versionLineRange(thread(), 'commented')).toEqual({ start: 20, end: 20 })
  })

  it('names the removing push only when it can only be the next one', () => {
    expect(removedInPush(origin({ index: 1, total: 2 }))).toBe(2)
    expect(removedInPush(origin({ index: 2, total: 4 }))).toBeNull()
    expect(removedInPush(origin())).toBeNull()
    expect(removedInPush(undefined)).toBeNull()
  })

  it('tags a file group removed, not in the diff, or nothing', () => {
    const azure = [{ origin: origin({ index: 1, total: 2 }) }]
    expect(fileGroupTag(azure, false, 'missing')).toEqual({ kind: 'removed', push: 2 })
    expect(
      fileGroupTag([...azure, { origin: origin({ index: 1, total: 3 }) }], false, 'missing'),
    ).toEqual({ kind: 'removed', push: null })
    expect(fileGroupTag([{ origin: origin() }], true, 'missing')).toEqual({
      kind: 'removed',
      push: null,
    })
    // Without an origin, a missing file is still just "not in the diff".
    expect(fileGroupTag([{}], false, 'missing')).toEqual({ kind: 'notInDiff' })
    expect(fileGroupTag(azure, false, 'present')).toEqual({ kind: 'notInDiff' })
    expect(fileGroupTag(azure, false, 'unknown')).toEqual({ kind: 'notInDiff' })
    expect(fileGroupTag(azure, true, 'present')).toBeNull()
  })
})
