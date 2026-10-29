/**
 * Contract of the side-panel AI chat ("Ask" tab): saved conversations about
 * one PR, each a list of messages. Conversations live in main (`chat.sqlite`
 * in userData, `main/chat/`); the renderer lists them, opens one (paged),
 * sends a message and follows the answer through the `chatEvent` push.
 *
 * Every question is its own jailed, read-only run over the snapshot at the PR
 * commit (same agent as the analysis). A follow-up carries the earlier
 * exchanges, read by main from the database and trimmed to a budget: the
 * renderer never sends history.
 *
 * Context items are what the reviewer gathered before sending: a diff line
 * (with a note typed in the line's input) or a comment thread (on a line, a
 * file, or the whole PR: a "general comment"). They are
 * copied into the message when it is sent, so a saved conversation still
 * reads correctly after the PR changes. Everything in them (code, paths,
 * comments) is PR content: untrusted, fenced as data in the prompt.
 */
import type { AppLocale } from './locale'
import type { AnalysisActivityItem } from './events'
import type { AnalysisGenerationInfo, RepoRef } from './types'

/** Longest message the reviewer can send. */
export const MAX_CHAT_MESSAGE_LEN = 4000
/** Context items one message can carry. */
export const MAX_CHAT_CONTEXT_ITEMS = 10
/** Longest note typed in a line's input. */
export const MAX_CHAT_NOTE_LEN = 2000
/** Longest code excerpt a line item carries (one diff line). */
export const MAX_CHAT_CODE_LEN = 2000
/** Longest path a context item carries. */
export const MAX_CHAT_PATH_LEN = 1000
/** Comments one thread item carries (its first one plus the newest replies). */
export const MAX_CHAT_THREAD_COMMENTS = 50
/** Longest comment author a thread item carries. */
export const MAX_CHAT_AUTHOR_LEN = 200
/**
 * Characters all context items of one message carry together (codes, notes,
 * authors, comment bodies). The renderer trims thread comments to fit; main
 * rejects anything over it.
 */
export const MAX_CHAT_CONTEXT_LEN = 24_000
/** Characters of earlier exchanges main sends with a follow-up (newest first kept). */
export const MAX_CHAT_HISTORY_LEN = 24_000
/** Messages one `chat:get` page returns at most. */
export const MAX_CHAT_PAGE = 100

/**
 * Which file a line number counts in: `new` = the PR head (added and context
 * lines), `old` = the base (removed lines).
 */
export type ChatSide = 'old' | 'new'

/** One diff line the reviewer added from its input, with what they typed there. */
export interface ChatLineContext {
  kind: 'line'
  /** Client-made id (unique within the message), for keys and removal. */
  id: string
  path: string
  side: ChatSide
  line: number
  /** The line's content as shown in the diff (no +/- prefix). */
  code: string
  /** What the reviewer typed in the line's input (may be empty). */
  note: string
}

/**
 * Where an outdated line thread was written (`CommentThread.origin`): main
 * reads the code there (the provider's file read at `commit`, which refuses a
 * commit that is not the PR's) so the AI gets the lines as commented.
 */
export interface ChatThreadOrigin {
  /** Full commit SHA (40 hex). */
  commit: string
  /** Path at `commit` when it differs from the thread's `path` (renamed since). */
  path?: string
  line: number
  lineEnd?: number
}

/**
 * A comment thread the reviewer added with its sparkle. `path` and `side`
 * are absent together on a PR-level thread (a "general comment"): the AI
 * gets its comments, with no file or line.
 */
export interface ChatThreadContext {
  kind: 'thread'
  id: string
  /** The provider's thread id (to reply to it from an answer). */
  threadId: string
  path?: string
  side?: ChatSide
  /** Absent together on a file-level or PR-level thread. */
  startLine?: number
  endLine?: number
  /** The thread no longer matches the latest version of the PR. */
  outdated: boolean
  /** An outdated line thread whose provider said where it was written. */
  origin?: ChatThreadOrigin
  comments: Array<{ author: string; body: string }>
}

export type ChatContextItem = ChatLineContext | ChatThreadContext

export type ChatMessageStatus =
  | 'done'
  /** The answer is being written (only assistant messages). */
  | 'streaming'
  | 'failed'
  /** The app quit (or crashed) while this answer was being written. */
  | 'interrupted'
  /** The reviewer stopped it. */
  | 'cancelled'

export interface ChatMessage {
  id: string
  conversationId: string
  role: 'user' | 'assistant'
  /** Markdown (rendered without raw HTML); the partial text while streaming. */
  text: string
  /** What the reviewer attached (user messages only; empty otherwise). */
  context: ChatContextItem[]
  status: ChatMessageStatus
  /** Display text of the failure (`failed` only). */
  error?: string
  /** Who wrote it (assistant messages). */
  generatedWith?: AnalysisGenerationInfo
  language?: AppLocale
  /** ISO 8601. */
  createdAt: string
  updatedAt: string
}

/** One row of the panel's conversation list (no messages). */
export interface ChatConversationSummary {
  id: string
  /** `prKey(repo, number)` (`shared/scm.ts`). */
  prKey: string
  repo: RepoRef
  number: number
  /** The first question, shortened. */
  title: string
  messageCount: number
  /** Start of the newest message, shortened (plain text). */
  lastMessagePreview: string
  /** An answer is being written right now. */
  running: boolean
  createdAt: string
  updatedAt: string
}

/** One page of a conversation, oldest first. */
export interface ChatPage {
  conversation: ChatConversationSummary
  messages: ChatMessage[]
  /** Older messages exist: ask again with `before` = the first message's id. */
  hasMore: boolean
}

export interface ChatSendRequest {
  repo: RepoRef
  number: number
  /** Absent = start a new conversation. */
  conversationId?: string
  text: string
  context: ChatContextItem[]
}

/** `chat:send` returns at once; the answer arrives through `chatEvent`. */
export interface ChatSendResult {
  conversation: ChatConversationSummary
  userMessage: ChatMessage
  assistantMessage: ChatMessage
}

/**
 * What a streaming answer is doing right now, in run order: starting the AI
 * provider, reading the PR (its details and the snapshot at its commit),
 * waiting for the model's first event, then the model's own phases.
 */
export type ChatRunStage = 'starting' | 'loading' | 'waiting' | 'exploring' | 'writing'

export const CHAT_RUN_STAGES: readonly ChatRunStage[] = [
  'starting',
  'loading',
  'waiting',
  'exploring',
  'writing',
]

/**
 * Push from main to every window. `message` carries the WHOLE message (full
 * text so far, not a delta), coalesced to about one event per 50 ms per
 * message while streaming; `activity` is the run's live tool log and `stage`
 * its current step (neither saved, both absent once the message settles).
 */
export type ChatEvent =
  | {
      type: 'message'
      prKey: string
      message: ChatMessage
      activity?: AnalysisActivityItem[]
      stage?: ChatRunStage
    }
  | { type: 'conversation'; conversation: ChatConversationSummary }
  | { type: 'deleted'; prKey: string; conversationId: string }
