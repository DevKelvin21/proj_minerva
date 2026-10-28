import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import type { ChatLineContext, ChatMessage } from '../../shared/chat'
import { githubRepo } from '../../shared/scm-guards'
import { openChatDb, openChatDbSafely, plainPreview, type ChatDb } from './chat-db'

const repo = githubRepo('shopwave', 'api')
const PR = 'github:shopwave/api#482'
const T0 = '2026-10-28T10:00:00.000Z'

const line: ChatLineContext = {
  kind: 'line',
  id: 'l1',
  path: 'src/a.ts',
  side: 'new',
  line: 3,
  code: 'const a = 1',
  note: 'why?',
}

function message(
  id: string,
  conversationId: string,
  overrides: Partial<ChatMessage> = {},
): ChatMessage {
  return {
    id,
    conversationId,
    role: 'user',
    text: 'text of ' + id,
    context: [],
    status: 'done',
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  }
}

function seed(db: ChatDb, id: string, prKey = PR, createdAt = T0): void {
  db.createConversation({ id, prKey, repo, number: 482, title: 'Title ' + id, createdAt })
}

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'minerva-chat-'))
  dirs.push(dir)
  return join(dir, 'chat.sqlite')
}

describe('chat-db', () => {
  it('creates the schema at version 1 with WAL and foreign keys', () => {
    const path = tempPath()
    openChatDb(path).close()
    const raw = new DatabaseSync(path)
    expect(raw.prepare('PRAGMA user_version').get()).toEqual({ user_version: 1 })
    expect(raw.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' })
    const tables = raw
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => row.name)
    expect(tables).toEqual(['conversations', 'messages'])
    raw.close()
    // Reopening an up-to-date file migrates nothing and keeps the data.
    const db = openChatDb(path)
    seed(db, 'c1')
    db.close()
    expect(openChatDb(path).getConversation('c1')?.title).toBe('Title c1')
  })

  it('round-trips messages with their context, seal and language', () => {
    const db = openChatDb(':memory:')
    seed(db, 'c1')
    db.insertMessage(message('m1', 'c1', { context: [line] }))
    db.insertMessage(
      message('m2', 'c1', {
        role: 'assistant',
        text: '',
        status: 'streaming',
        language: 'es',
        generatedWith: { provider: 'opencode', model: 'opencode/big-pickle', options: {} },
      }),
    )
    expect(db.getMessage('m1')?.context).toEqual([line])
    db.updateMessage('m2', { text: 'partial', updatedAt: '2026-10-28T10:00:01.000Z' })
    db.updateMessage('m2', {
      status: 'failed',
      error: 'boom',
      updatedAt: '2026-10-28T10:00:02.000Z',
    })
    expect(db.getMessage('m2')).toEqual({
      id: 'm2',
      conversationId: 'c1',
      role: 'assistant',
      text: 'partial',
      context: [],
      status: 'failed',
      error: 'boom',
      generatedWith: { provider: 'opencode', model: 'opencode/big-pickle', options: {} },
      language: 'es',
      createdAt: T0,
      updatedAt: '2026-10-28T10:00:02.000Z',
    })
    db.updateMessage('m2', {
      status: 'streaming',
      error: null,
      generatedWith: null,
      updatedAt: T0,
    })
    const reset = db.getMessage('m2')
    expect(reset?.error).toBeUndefined()
    expect(reset?.generatedWith).toBeUndefined()
  })

  it('pages oldest first with a message-id cursor', () => {
    const db = openChatDb(':memory:')
    seed(db, 'c1')
    seed(db, 'c2')
    for (let i = 1; i <= 7; i++) db.insertMessage(message('m' + i, 'c1'))
    db.insertMessage(message('other', 'c2'))

    const newest = db.getPage('c1', { limit: 3 })
    expect(newest.messages.map((m) => m.id)).toEqual(['m5', 'm6', 'm7'])
    expect(newest.hasMore).toBe(true)
    const older = db.getPage('c1', { before: 'm5', limit: 3 })
    expect(older.messages.map((m) => m.id)).toEqual(['m2', 'm3', 'm4'])
    expect(older.hasMore).toBe(true)
    const oldest = db.getPage('c1', { before: 'm2', limit: 3 })
    expect(oldest.messages.map((m) => m.id)).toEqual(['m1'])
    expect(oldest.hasMore).toBe(false)
    expect(db.getPage('c1').messages).toHaveLength(7)
    // A cursor from another conversation (or unknown) answers an empty page.
    expect(db.getPage('c1', { before: 'other' })).toEqual({ messages: [], hasMore: false })
    expect(db.getPage('c1', { before: 'nope' })).toEqual({ messages: [], hasMore: false })
    expect(db.lastMessages('c1', 2).map((m) => m.id)).toEqual(['m6', 'm7'])
  })

  it('lists one PR newest first, with count and a plain-text preview of the newest text', () => {
    const db = openChatDb(':memory:')
    seed(db, 'old', PR, '2026-10-01T00:00:00.000Z')
    seed(db, 'new', PR, '2026-10-02T00:00:00.000Z')
    seed(db, 'elsewhere', 'github:shopwave/api#1')
    db.insertMessage(message('a1', 'old', { text: 'Why **this**?' }))
    db.insertMessage(
      message('a2', 'old', {
        role: 'assistant',
        text: '## Because\n\n`clamp` keeps it [safe](x).',
      }),
    )
    // An empty streaming answer doesn't blank the preview.
    db.insertMessage(message('a3', 'old', { text: 'And then?' }))
    db.insertMessage(message('a4', 'old', { role: 'assistant', text: '', status: 'streaming' }))

    const list = db.listConversations(PR)
    expect(list.map((c) => c.id)).toEqual(['new', 'old'])
    expect(list[1]).toMatchObject({
      id: 'old',
      prKey: PR,
      repo,
      number: 482,
      messageCount: 4,
      lastMessagePreview: 'And then?',
    })
    expect(list[0]).toMatchObject({ messageCount: 0, lastMessagePreview: '' })

    db.touchConversation('old', '2026-10-03T00:00:00.000Z')
    expect(db.listConversations(PR).map((c) => c.id)).toEqual(['old', 'new'])
    expect(plainPreview('## Because\n\n`clamp` keeps it [safe](x).')).toBe(
      'Because clamp keeps it safe.',
    )
    expect(plainPreview('x'.repeat(500))).toHaveLength(140)
  })

  it('marks answers left streaming as interrupted when it opens', () => {
    const path = tempPath()
    const first = openChatDb(path)
    seed(first, 'c1')
    first.insertMessage(message('q', 'c1'))
    first.insertMessage(message('a', 'c1', { role: 'assistant', status: 'streaming', text: 'hal' }))
    first.close()

    const second = openChatDb(path, () => new Date('2026-10-29T00:00:00.000Z'))
    expect(second.getMessage('a')).toMatchObject({
      status: 'interrupted',
      text: 'hal',
      updatedAt: '2026-10-29T00:00:00.000Z',
    })
    expect(second.getMessage('q')?.status).toBe('done')
  })

  it('deletes a conversation with its messages (cascade)', () => {
    const db = openChatDb(':memory:')
    seed(db, 'c1')
    seed(db, 'c2')
    db.insertMessage(message('m1', 'c1'))
    db.insertMessage(message('m2', 'c2'))
    expect(db.deleteConversation('c1')).toBe(true)
    expect(db.deleteConversation('c1')).toBe(false)
    expect(db.getMessage('m1')).toBeNull()
    expect(db.getMessage('m2')).not.toBeNull()
    expect(db.listConversations(PR).map((c) => c.id)).toEqual(['c2'])
  })

  it('reads malformed rows tolerantly instead of crashing', () => {
    const path = tempPath()
    const db = openChatDb(path)
    seed(db, 'good')
    db.insertMessage(message('m1', 'good', { context: [line] }))
    db.insertMessage(message('m2', 'good', { role: 'assistant' }))
    db.insertMessage(message('m3', 'good'))
    db.close()

    const raw = new DatabaseSync(path)
    raw.exec("UPDATE messages SET context_json = '{not json' WHERE id = 'm1'")
    raw.exec(
      'UPDATE messages SET generated_with_json = \'{"provider":"nope"}\', language = \'fr\',' +
        " status = 'weird' WHERE id = 'm2'",
    )
    raw.exec("UPDATE messages SET role = 'system' WHERE id = 'm3'")
    raw
      .prepare(
        'INSERT INTO conversations (id, pr_key, repo_json, number, title, created_at, updated_at)' +
          ' VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run('bad', PR, '{"provider":"svn"}', 482, 'Bad', T0, T0)
    raw.close()

    const reopened = openChatDb(path)
    expect(reopened.getMessage('m1')?.context).toEqual([])
    const m2 = reopened.getMessage('m2')
    expect(m2?.status).toBe('interrupted')
    expect(m2?.generatedWith).toBeUndefined()
    expect(m2?.language).toBeUndefined()
    // A row with an unknown role is skipped, not thrown.
    expect(reopened.getMessage('m3')).toBeNull()
    expect(reopened.listMessages('good').map((m) => m.id)).toEqual(['m1', 'm2'])
    // A conversation whose repo doesn't validate is left out of the list.
    expect(reopened.listConversations(PR).map((c) => c.id)).toEqual(['good'])
    expect(reopened.getConversation('bad')).toBeNull()
  })

  it('rolls a failed transaction back', () => {
    const db = openChatDb(':memory:')
    seed(db, 'c1')
    expect(() =>
      db.transaction(() => {
        db.insertMessage(message('m1', 'c1'))
        throw new Error('nope')
      }),
    ).toThrow('nope')
    expect(db.getMessage('m1')).toBeNull()
  })
})

describe('openChatDbSafely', () => {
  it('sets a file SQLite cannot open aside and starts a fresh database', () => {
    const path = tempPath()
    writeFileSync(path, 'not a database, just text that is long enough to fail the header check')
    const db = openChatDbSafely(path)
    db.createConversation({
      id: 'c1',
      prKey: PR,
      repo,
      number: 482,
      title: 't',
      createdAt: T0,
    })
    expect(db.listConversations(PR).map((c) => c.id)).toEqual(['c1'])
    db.close()
    expect(existsSync(path)).toBe(true)
    const dir = path.slice(0, path.lastIndexOf('/'))
    expect(readdirSync(dir).some((name) => name.startsWith('chat.sqlite.corrupt-'))).toBe(true)
  })
})
