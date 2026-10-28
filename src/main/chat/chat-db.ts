/**
 * Storage of the side-panel chat (`shared/chat.ts`): `chat.sqlite` in
 * userData, through Node's built-in `node:sqlite` (`DatabaseSync`; Electron
 * 43 ships Node 24). Synchronous on purpose: every statement is a small
 * indexed read or write, and a sync API keeps "insert, then broadcast" free
 * of interleavings.
 *
 * Schema (versioned with `PRAGMA user_version`, migrations below):
 * - `conversations`: one per saved chat, keyed by id, grouped by `pr_key`
 *   (`prKey(repo, number)`), the `RepoRef` kept as JSON.
 * - `messages`: ordered by `seq` (per conversation, 1-based), cascade-deleted
 *   with their conversation. `context_json` is a copy of the items the
 *   reviewer attached; `generated_with_json` the provider/model seal.
 *
 * Reads are tolerant: a row that doesn't validate (hand-edited file, older
 * shape) never crashes the panel. A conversation with a bad repo is skipped;
 * a message with bad context reads with an empty context, a bad seal or
 * language reads without it.
 *
 * Text in here is PR-related content and the reviewer's words: never logged.
 */
import { existsSync, renameSync } from 'node:fs'
import { DatabaseSync, type SQLInputValue, type SQLOutputValue } from 'node:sqlite'
import { isAiProviderId } from '../../shared/ai-providers'
import {
  MAX_CHAT_PAGE,
  type ChatContextItem,
  type ChatConversationSummary,
  type ChatMessage,
  type ChatMessageStatus,
} from '../../shared/chat'
import { isAppLocale } from '../../shared/locale'
import { isRepoRef } from '../../shared/scm-guards'
import type { AnalysisGenerationInfo, RepoRef } from '../../shared/types'
import { isChatContext } from './chat-guards'

export const CHAT_DB_FILE_NAME = 'chat.sqlite'

/** Current schema version (`PRAGMA user_version`). */
const SCHEMA_VERSION = 1

/** Default page size of `getPage`. */
export const DEFAULT_CHAT_PAGE = 50

/** Longest conversation title / list preview, in characters. */
const TITLE_LEN = 80
const PREVIEW_LEN = 140
/** Characters of the newest message read for its preview (before markdown is stripped). */
const PREVIEW_SOURCE_LEN = 600

/** Most conversations `listConversations` returns for one PR (newest first). */
const MAX_CONVERSATIONS_PER_PR = 200

const MESSAGE_STATUSES: readonly ChatMessageStatus[] = [
  'done',
  'streaming',
  'failed',
  'interrupted',
  'cancelled',
]

/** A conversation as stored (the summary minus `running`, which only the service knows). */
export type StoredConversation = Omit<ChatConversationSummary, 'running'>

export interface NewConversation {
  id: string
  prKey: string
  repo: RepoRef
  number: number
  title: string
  createdAt: string
}

/** Fields of a message that change after it is inserted. */
export interface MessagePatch {
  text?: string
  status?: ChatMessageStatus
  /** `null` clears it. */
  error?: string | null
  /** `null` clears it. */
  generatedWith?: AnalysisGenerationInfo | null
  language?: ChatMessage['language']
  updatedAt: string
}

export interface ChatDb {
  listConversations(prKey: string): StoredConversation[]
  getConversation(id: string): StoredConversation | null
  createConversation(conversation: NewConversation): void
  touchConversation(id: string, updatedAt: string): void
  deleteConversation(id: string): boolean
  /** Appends a message at the end of its conversation (next `seq`). */
  insertMessage(message: ChatMessage): void
  updateMessage(id: string, patch: MessagePatch): void
  getMessage(id: string): ChatMessage | null
  /**
   * One page, oldest first: the `limit` messages just before `before` (a
   * message id of that conversation), or the newest ones. A `before` that is
   * not in the conversation answers an empty page.
   */
  getPage(
    conversationId: string,
    options?: { before?: string; limit?: number },
  ): { messages: ChatMessage[]; hasMore: boolean }
  /** Every message of a conversation, oldest first (history of a follow-up). */
  listMessages(conversationId: string): ChatMessage[]
  /** The newest `count` messages, oldest first. */
  lastMessages(conversationId: string, count: number): ChatMessage[]
  /** Runs `fn` in one transaction (rolled back if it throws). */
  transaction<T>(fn: () => T): T
  /** Every `streaming` message becomes `interrupted` (startup / quit). Returns how many. */
  interruptStreaming(updatedAt: string): number
  close(): void
}

/** Shortens one line of text to `max` characters, with an ellipsis. */
export function shortenText(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : flat.slice(0, max - 1).trimEnd() + '…'
}

/** A conversation title from its first message. */
export function conversationTitle(text: string): string {
  return shortenText(text, TITLE_LEN)
}

/**
 * Plain-text preview of a Markdown message: code fences, inline code marks,
 * emphasis, headings, quotes and link targets dropped; whitespace collapsed.
 */
export function plainPreview(markdown: string): string {
  const plain = markdown
    .replace(/```[^\n]*\n?/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(?:#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/[`*_~]+/g, '')
  return shortenText(plain, PREVIEW_LEN)
}

function parseJson(text: unknown): unknown {
  if (typeof text !== 'string') return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

function isGenerationInfo(value: unknown): value is AnalysisGenerationInfo {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const v = value as Record<string, unknown>
  if (!isAiProviderId(v.provider) || typeof v.model !== 'string') return false
  const options = v.options
  if (typeof options !== 'object' || options === null || Array.isArray(options)) return false
  return Object.values(options).every((entry) => typeof entry === 'string')
}

type Row = Record<string, SQLOutputValue>

function str(row: Row, key: string): string | null {
  const value = row[key]
  return typeof value === 'string' ? value : null
}

function rowToConversation(row: Row): StoredConversation | null {
  const id = str(row, 'id')
  const prKey = str(row, 'pr_key')
  const repo = parseJson(row.repo_json)
  const number = row.number
  if (id === null || prKey === null || !isRepoRef(repo)) return null
  if (typeof number !== 'number' || !Number.isInteger(number)) return null
  const count = row.message_count
  return {
    id,
    prKey,
    repo,
    number,
    title: str(row, 'title') ?? '',
    messageCount: typeof count === 'number' ? count : 0,
    lastMessagePreview: plainPreview(str(row, 'last_text') ?? ''),
    createdAt: str(row, 'created_at') ?? '',
    updatedAt: str(row, 'updated_at') ?? '',
  }
}

function rowToMessage(row: Row): ChatMessage | null {
  const id = str(row, 'id')
  const conversationId = str(row, 'conversation_id')
  const role = row.role
  if (id === null || conversationId === null) return null
  if (role !== 'user' && role !== 'assistant') return null
  const rawStatus = row.status
  // An unknown status (a newer app wrote it) reads as an answer that didn't finish.
  const status = (MESSAGE_STATUSES as readonly unknown[]).includes(rawStatus)
    ? (rawStatus as ChatMessageStatus)
    : 'interrupted'
  const context = parseJson(row.context_json)
  const generatedWith = parseJson(row.generated_with_json)
  const language = row.language
  const error = str(row, 'error')
  return {
    id,
    conversationId,
    role,
    text: str(row, 'text') ?? '',
    context: isChatContext(context) ? (context as ChatContextItem[]) : [],
    status,
    ...(status === 'failed' && error !== null ? { error } : {}),
    ...(isGenerationInfo(generatedWith) ? { generatedWith } : {}),
    ...(isAppLocale(language) ? { language } : {}),
    createdAt: str(row, 'created_at') ?? '',
    updatedAt: str(row, 'updated_at') ?? '',
  }
}

function present<T>(value: T | null): value is T {
  return value !== null
}

/** Schema migrations, index = the version they lead to minus one. */
const MIGRATIONS: readonly string[] = [
  'CREATE TABLE conversations (' +
    ' id TEXT PRIMARY KEY,' +
    ' pr_key TEXT NOT NULL,' +
    ' repo_json TEXT NOT NULL,' +
    ' number INTEGER NOT NULL,' +
    ' title TEXT NOT NULL,' +
    ' created_at TEXT NOT NULL,' +
    ' updated_at TEXT NOT NULL' +
    ');' +
    'CREATE INDEX conversations_by_pr ON conversations (pr_key, updated_at);' +
    'CREATE TABLE messages (' +
    ' id TEXT PRIMARY KEY,' +
    ' conversation_id TEXT NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,' +
    ' seq INTEGER NOT NULL,' +
    ' role TEXT NOT NULL,' +
    ' text TEXT NOT NULL,' +
    ' context_json TEXT NOT NULL,' +
    ' status TEXT NOT NULL,' +
    ' error TEXT,' +
    ' generated_with_json TEXT,' +
    ' language TEXT,' +
    ' created_at TEXT NOT NULL,' +
    ' updated_at TEXT NOT NULL' +
    ');' +
    'CREATE UNIQUE INDEX messages_by_conversation ON messages (conversation_id, seq);',
]

function migrate(db: DatabaseSync): void {
  const row = db.prepare('PRAGMA user_version').get() as Row | undefined
  const current = typeof row?.user_version === 'number' ? row.user_version : 0
  if (current > SCHEMA_VERSION) {
    // Written by a newer app: read what we understand, never downgrade it.
    return
  }
  for (let version = current; version < SCHEMA_VERSION; version++) {
    db.exec('BEGIN')
    try {
      db.exec(MIGRATIONS[version])
      db.exec('PRAGMA user_version = ' + (version + 1))
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }
}

/**
 * Opens (creating if needed) the chat database at `path` (`':memory:'` in
 * tests), migrates it, and marks every answer left `streaming` by a previous
 * run (quit or crash mid-answer) as `interrupted`.
 */
export function openChatDb(path: string, now: () => Date = () => new Date()): ChatDb {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA synchronous = NORMAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA busy_timeout = 3000')
  // A deleted conversation (PR code, notes, answers) leaves no readable trace in free pages.
  db.exec('PRAGMA secure_delete = ON')
  migrate(db)

  // Summaries in ONE query: the count and the newest non-empty text come from
  // correlated subqueries over the `(conversation_id, seq)` index.
  const listSql =
    'SELECT c.id, c.pr_key, c.repo_json, c.number, c.title, c.created_at, c.updated_at,' +
    ' (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count,' +
    ' (SELECT substr(m.text, 1, ' +
    PREVIEW_SOURCE_LEN +
    ") FROM messages m WHERE m.conversation_id = c.id AND m.text <> ''" +
    ' ORDER BY m.seq DESC LIMIT 1) AS last_text' +
    ' FROM conversations c'
  const listByPr = db.prepare(
    listSql +
      ' WHERE c.pr_key = ? ORDER BY c.updated_at DESC, c.id DESC LIMIT ' +
      MAX_CONVERSATIONS_PER_PR,
  )
  const getConversationStmt = db.prepare(listSql + ' WHERE c.id = ?')
  const insertConversation = db.prepare(
    'INSERT INTO conversations (id, pr_key, repo_json, number, title, created_at, updated_at)' +
      ' VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
  const touchStmt = db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?')
  const deleteStmt = db.prepare('DELETE FROM conversations WHERE id = ?')
  const insertMessageStmt = db.prepare(
    'INSERT INTO messages (id, conversation_id, seq, role, text, context_json, status, error,' +
      ' generated_with_json, language, created_at, updated_at)' +
      ' VALUES (?, ?, (SELECT COALESCE(MAX(seq), 0) + 1 FROM messages WHERE conversation_id = ?),' +
      ' ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  )
  const getMessageStmt = db.prepare('SELECT * FROM messages WHERE id = ?')
  const seqOf = db.prepare('SELECT seq FROM messages WHERE id = ? AND conversation_id = ?')
  const pageNewest = db.prepare(
    'SELECT * FROM messages WHERE conversation_id = ? ORDER BY seq DESC LIMIT ?',
  )
  const pageBefore = db.prepare(
    'SELECT * FROM messages WHERE conversation_id = ? AND seq < ? ORDER BY seq DESC LIMIT ?',
  )
  const allMessages = db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY seq')
  const interruptStmt = db.prepare(
    "UPDATE messages SET status = 'interrupted', updated_at = ? WHERE status = 'streaming'",
  )

  const readPage = (rows: Row[], limit: number): { messages: ChatMessage[]; hasMore: boolean } => {
    const hasMore = rows.length > limit
    const messages = rows.slice(0, limit).map(rowToMessage).filter(present).reverse()
    return { messages, hasMore }
  }

  const chatDb: ChatDb = {
    listConversations(prKey) {
      return (listByPr.all(prKey) as Row[]).map(rowToConversation).filter(present)
    },

    getConversation(id) {
      const row = getConversationStmt.get(id) as Row | undefined
      return row ? rowToConversation(row) : null
    },

    createConversation(conversation) {
      insertConversation.run(
        conversation.id,
        conversation.prKey,
        JSON.stringify(conversation.repo),
        conversation.number,
        conversation.title,
        conversation.createdAt,
        conversation.createdAt,
      )
    },

    touchConversation(id, updatedAt) {
      touchStmt.run(updatedAt, id)
    },

    deleteConversation(id) {
      return Number(deleteStmt.run(id).changes) > 0
    },

    insertMessage(message) {
      insertMessageStmt.run(
        message.id,
        message.conversationId,
        message.conversationId,
        message.role,
        message.text,
        JSON.stringify(message.context),
        message.status,
        message.error ?? null,
        message.generatedWith ? JSON.stringify(message.generatedWith) : null,
        message.language ?? null,
        message.createdAt,
        message.updatedAt,
      )
    },

    updateMessage(id, patch) {
      const sets: string[] = ['updated_at = ?']
      const values: SQLInputValue[] = [patch.updatedAt]
      if (patch.text !== undefined) {
        sets.push('text = ?')
        values.push(patch.text)
      }
      if (patch.status !== undefined) {
        sets.push('status = ?')
        values.push(patch.status)
      }
      if (patch.error !== undefined) {
        sets.push('error = ?')
        values.push(patch.error)
      }
      if (patch.generatedWith !== undefined) {
        sets.push('generated_with_json = ?')
        values.push(patch.generatedWith === null ? null : JSON.stringify(patch.generatedWith))
      }
      if (patch.language !== undefined) {
        sets.push('language = ?')
        values.push(patch.language)
      }
      values.push(id)
      // Column names come from the fixed list above, never from input.
      db.prepare('UPDATE messages SET ' + sets.join(', ') + ' WHERE id = ?').run(...values)
    },

    getMessage(id) {
      const row = getMessageStmt.get(id) as Row | undefined
      return row ? rowToMessage(row) : null
    },

    getPage(conversationId, options = {}) {
      const limit = Math.min(
        Math.max(1, Math.trunc(options.limit ?? DEFAULT_CHAT_PAGE)),
        MAX_CHAT_PAGE,
      )
      if (options.before === undefined) {
        return readPage(pageNewest.all(conversationId, limit + 1) as Row[], limit)
      }
      const anchor = seqOf.get(options.before, conversationId) as Row | undefined
      if (!anchor || typeof anchor.seq !== 'number') return { messages: [], hasMore: false }
      return readPage(pageBefore.all(conversationId, anchor.seq, limit + 1) as Row[], limit)
    },

    listMessages(conversationId) {
      return (allMessages.all(conversationId) as Row[]).map(rowToMessage).filter(present)
    },

    lastMessages(conversationId, count) {
      return (pageNewest.all(conversationId, count) as Row[])
        .map(rowToMessage)
        .filter(present)
        .reverse()
    },

    transaction(fn) {
      db.exec('BEGIN')
      try {
        const result = fn()
        db.exec('COMMIT')
        return result
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },

    interruptStreaming(updatedAt) {
      return Number(interruptStmt.run(updatedAt).changes)
    },

    close() {
      if (db.isOpen) db.close()
    },
  }

  chatDb.interruptStreaming(now().toISOString())
  return chatDb
}

/**
 * `openChatDb` that never keeps the app from starting: a file SQLite cannot
 * open or migrate is set aside as `chat.sqlite.corrupt-<time>` (with its WAL
 * files) and a fresh one is created; if even that fails, the chat runs on an
 * in-memory database for this session.
 */
export function openChatDbSafely(path: string): ChatDb {
  try {
    return openChatDb(path)
  } catch {
    console.warn('[chat] could not open the chat database; starting a new one')
  }
  const suffix = '.corrupt-' + Date.now()
  try {
    for (const file of [path, path + '-wal', path + '-shm']) {
      if (existsSync(file)) renameSync(file, file + suffix)
    }
    return openChatDb(path)
  } catch {
    console.warn('[chat] could not create a chat database; conversations will not be saved')
    return openChatDb(':memory:')
  }
}
