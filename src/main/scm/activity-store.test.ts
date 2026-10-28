import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ActivityCommentItem } from '../../shared/activity'
import { githubRepo } from '../../shared/scm-guards'
import { createActivityStore } from './activity-store'

let dir = ''
const file = (): string => join(dir, 'activity.json')

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'minerva-activity-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const item: ActivityCommentItem = {
  kind: 'comment',
  id: 'comment:github:shopwave/api#1:c1',
  prKey: 'github:shopwave/api#1',
  repo: githubRepo('shopwave', 'api'),
  number: 1,
  prTitle: 'PR 1',
  at: '2026-10-28T12:00:00.000Z',
  read: false,
  direct: true,
  threadId: 't1',
  commentId: 'c1',
  author: { login: 'jrivas' },
  excerpt: 'Hello',
  isLineThread: false,
  isReply: false,
}

describe('createActivityStore', () => {
  it('starts empty when the file is missing', () => {
    const data = createActivityStore(file).load()
    expect(data.prs.size).toBe(0)
    expect(data.items).toEqual([])
  })

  it('round-trips tracks and items through an atomic write', () => {
    const store = createActivityStore(file)
    const track = {
      knownCommentIds: ['c1'],
      checkedUpdatedAt: '2026-10-28T11:00:00.000Z',
      checkedAt: '2026-10-28T12:00:00.000Z',
    }
    store.save({ prs: new Map([[item.prKey, track]]), items: [item] })
    const data = createActivityStore(file).load()
    expect(data.prs.get(item.prKey)).toEqual(track)
    expect(data.items).toEqual([item])
    expect(JSON.parse(readFileSync(file(), 'utf-8')).version).toBe(1)
  })

  it('falls back to empty on corrupt JSON or another version', () => {
    writeFileSync(file(), '{nope')
    expect(createActivityStore(file).load().items).toEqual([])
    writeFileSync(file(), JSON.stringify({ version: 99, prs: {}, items: [item] }))
    expect(createActivityStore(file).load().items).toEqual([])
  })

  it('drops malformed tracks and items one by one', () => {
    writeFileSync(
      file(),
      JSON.stringify({
        version: 1,
        prs: {
          good: { knownCommentIds: [], checkedUpdatedAt: 'a', checkedAt: 'b' },
          bad: { knownCommentIds: [1], checkedUpdatedAt: 'a', checkedAt: 'b' },
        },
        items: [item, { ...item, kind: 'mystery' }, { ...item, repo: { provider: 'gitlab' } }],
      }),
    )
    const data = createActivityStore(file).load()
    expect([...data.prs.keys()]).toEqual(['good'])
    expect(data.items).toEqual([item])
  })
})
