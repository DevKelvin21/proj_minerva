/**
 * The side-panel chat (`shared/chat.ts`): saved conversations per PR
 * (`./chat-db.ts`) and the runs that answer them.
 *
 * `send` saves the reviewer's message and an empty `streaming` answer, starts
 * the run in the background and returns at once. Each run is its own jailed,
 * read-only agent over the snapshot at the PR commit (`AiService` with the
 * `chat` option, `../ai/task-prompts.ts`); a follow-up carries the earlier
 * done exchanges, read here from the database and trimmed to
 * `MAX_CHAT_HISTORY_LEN` (newest kept). One run per conversation at a time;
 * runs live in main, so they survive the renderer switching PR or closing
 * the panel.
 *
 * Every change is pushed to every window (`broadcast`): `message` carries the
 * whole message (full text so far), coalesced to about one event per
 * `flushIntervalMs` while streaming, with the run's activity log; the text is
 * saved on each of those flushes, so a crash loses at most one interval.
 * The final state (done / failed with its error / cancelled) is saved and
 * pushed once more, without activity, followed by the conversation summary
 * (`running` back to false).
 *
 * Never logs message text: it is the reviewer's words and PR content.
 */
import { randomUUID } from 'node:crypto'
import {
  MAX_CHAT_HISTORY_LEN,
  type ChatConversationSummary,
  type ChatEvent,
  type ChatMessage,
  type ChatPage,
  type ChatSendRequest,
  type ChatSendResult,
} from '../../shared/chat'
import type { AnalysisActivityItem, DraftDidacticSection } from '../../shared/events'
import type { AppLocale } from '../../shared/locale'
import { prKey } from '../../shared/scm'
import type { AnalysisGenerationInfo, RepoRef } from '../../shared/types'
import { chatContextLabel } from '../ai/prompts/ask-chat'
import type { AiService, ChatHistoryTurn, CommentedCode } from '../ai/service'
import { mt } from '../i18n'
import { conversationTitle, type ChatDb, type StoredConversation } from './chat-db'

/** About one `message` event per this many ms per streaming message. */
const DEFAULT_FLUSH_INTERVAL_MS = 50
/** Answers being written at once across all conversations (each is a full agent run). */
export const MAX_CONCURRENT_CHAT_RUNS = 3
/** The oldest kept history turn is only shortened when at least this much budget is left. */
const MIN_SHORTENED_TURN = 200

/** What a run needs, resolved when it starts (catalog warmup, selection, provider). */
export interface ChatRunSetup {
  service: AiService
  /** The provider/model/options seal, captured before the run (like the analysis' seal). */
  generatedWith: AnalysisGenerationInfo
}

export interface ChatServiceDeps {
  db: ChatDb
  prepareRun: () => Promise<ChatRunSetup>
  /**
   * The code as commented of the message's outdated threads, by item id
   * (`./commented-code.ts`). Never rejects; absent = threads go without it.
   */
  readCommentedCode?: (
    repo: RepoRef,
    number: number,
    context: ChatMessage['context'],
  ) => Promise<Record<string, CommentedCode>>
  /** The UI language right now; captured when a message is sent and sealed on its answer. */
  currentLanguage: () => AppLocale
  broadcast: (event: ChatEvent) => void
  now?: () => Date
  newId?: () => string
  flushIntervalMs?: number
}

export interface ChatService {
  list(repo: RepoRef, number: number): ChatConversationSummary[]
  get(conversationId: string, options?: { before?: string; limit?: number }): ChatPage
  send(req: ChatSendRequest): ChatSendResult
  retry(conversationId: string): ChatSendResult
  cancel(conversationId: string): void
  delete(conversationId: string): void
  /** Settles when the conversation's current run (if any) has finished. */
  whenIdle(conversationId: string): Promise<void>
  /** App quit: stops every run, marks their answers `interrupted`, closes the database. */
  shutdown(): void
}

interface Run {
  controller: AbortController
  /** The conversation was deleted: the run's end writes and pushes nothing. */
  removed: boolean
  done: Promise<void>
}

/** Cuts `text` to `max` characters with an ellipsis (`''` when nothing fits). */
function clip(text: string, max: number): string {
  if (max <= 0) return ''
  return text.length <= max ? text : text.slice(0, max - 1) + '…'
}

function turnSize(turn: ChatHistoryTurn): number {
  return turn.question.length + turn.contextLabel.length + turn.answer.length
}

/**
 * Keeps the newest turns that fit `budget` characters, oldest first. The
 * oldest kept turn is shortened to what is left (its starts kept: answers
 * lead with the answer), or dropped when too little is left to be useful.
 */
export function trimChatHistory(
  turns: ChatHistoryTurn[],
  budget: number = MAX_CHAT_HISTORY_LEN,
): ChatHistoryTurn[] {
  const kept: ChatHistoryTurn[] = []
  let left = budget
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i]
    const size = turnSize(turn)
    if (size <= left) {
      kept.unshift(turn)
      left -= size
      continue
    }
    if (left >= MIN_SHORTENED_TURN) {
      const contextLabel = clip(turn.contextLabel, Math.floor(left / 4))
      const question = clip(turn.question, Math.floor((left - contextLabel.length) / 2))
      const answer = clip(turn.answer, left - contextLabel.length - question.length)
      kept.unshift({ question, contextLabel, answer })
    }
    break
  }
  return kept
}

/**
 * The done exchanges among `messages` (oldest first): a user message followed
 * by its done, non-empty answer. Failed, cancelled and interrupted answers
 * (and the question they answered) are skipped.
 */
export function historyTurns(messages: ChatMessage[]): ChatHistoryTurn[] {
  const turns: ChatHistoryTurn[] = []
  for (let i = 0; i + 1 < messages.length; i++) {
    const question = messages[i]
    const answer = messages[i + 1]
    if (question.role !== 'user' || answer.role !== 'assistant') continue
    if (answer.status !== 'done' || answer.text.trim().length === 0) continue
    turns.push({
      question: question.text,
      contextLabel: chatContextLabel(question.context),
      answer: answer.text,
    })
  }
  return turns
}

/** The answer in a progress snapshot or result: the `summary` section's markdown. */
function summaryText(sections: ReadonlyArray<DraftDidacticSection>): string {
  return sections.find((section) => section.kind === 'summary')?.markdown ?? ''
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.trim().length > 0 ? message : mt('ai.chat.empty')
}

export function createChatService(deps: ChatServiceDeps): ChatService {
  const { db, broadcast } = deps
  const now = deps.now ?? (() => new Date())
  const newId = deps.newId ?? randomUUID
  const flushIntervalMs = deps.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS
  /** Running answers, by conversation id. */
  const runs = new Map<string, Run>()
  let closed = false

  const iso = (): string => now().toISOString()

  function summary(conversation: StoredConversation): ChatConversationSummary {
    return { ...conversation, running: runs.has(conversation.id) }
  }

  function requireConversation(conversationId: string): StoredConversation {
    const conversation = db.getConversation(conversationId)
    if (!conversation) throw new Error(mt('ai.chat.notFound'))
    return conversation
  }

  function pushConversation(conversationId: string): ChatConversationSummary | null {
    const conversation = db.getConversation(conversationId)
    if (!conversation) return null
    const result = summary(conversation)
    broadcast({ type: 'conversation', conversation: result })
    return result
  }

  /**
   * Starts answering `question` with `answer` (already saved as `streaming`).
   * Registered synchronously, so a second send in the same tick sees it.
   */
  function startRun(
    conversation: StoredConversation,
    question: ChatMessage,
    answer: ChatMessage,
    history: ChatHistoryTurn[],
  ): void {
    const run: Run = {
      controller: new AbortController(),
      removed: false,
      done: Promise.resolve(),
    }
    runs.set(conversation.id, run)
    run.done = execute(conversation, question, { ...answer }, history, run)
      // Only a database failure while saving the final state gets here: the
      // answer stays `streaming` and reads as `interrupted` on next start.
      .catch(() => console.warn('[chat] could not save an answer'))
      .finally(() => {
        if (runs.get(conversation.id) === run) runs.delete(conversation.id)
        if (!run.removed && !closed) pushConversation(conversation.id)
      })
  }

  async function execute(
    conversation: StoredConversation,
    question: ChatMessage,
    answer: ChatMessage,
    history: ChatHistoryTurn[],
    run: Run,
  ): Promise<void> {
    const signal = run.controller.signal
    const key = conversation.prKey
    const live = (): boolean => !run.removed && !closed

    let activity: AnalysisActivityItem[] | undefined
    let lastFlushAt = 0
    let timer: ReturnType<typeof setTimeout> | null = null
    let dirty = false
    let settled = false

    const push = (withActivity: boolean): void => {
      broadcast({
        type: 'message',
        prKey: key,
        message: { ...answer },
        ...(withActivity && activity ? { activity } : {}),
      })
    }

    // Saves and pushes the text so far (at most once per interval).
    const flush = (): void => {
      timer = null
      if (!dirty || settled || !live()) return
      dirty = false
      lastFlushAt = Date.now()
      answer.updatedAt = iso()
      try {
        db.updateMessage(answer.id, { text: answer.text, updatedAt: answer.updatedAt })
      } catch {
        // The final state is saved again at the end; a missed partial is harmless.
        console.warn('[chat] could not save a partial answer')
      }
      push(true)
    }
    const scheduleFlush = (): void => {
      dirty = true
      if (timer !== null) return
      const wait = lastFlushAt + flushIntervalMs - Date.now()
      if (wait <= 0) flush()
      else timer = setTimeout(flush, wait)
    }

    const settle = (
      status: 'done' | 'failed' | 'cancelled',
      text: string,
      error?: string,
    ): void => {
      settled = true
      if (timer !== null) clearTimeout(timer)
      timer = null
      if (!live()) return
      answer.text = text
      answer.status = status
      answer.updatedAt = iso()
      if (error !== undefined) answer.error = error
      else delete answer.error
      db.updateMessage(answer.id, {
        text,
        status,
        error: error ?? null,
        updatedAt: answer.updatedAt,
      })
      push(false)
    }

    try {
      const setup = await deps.prepareRun()
      if (signal.aborted) {
        settle('cancelled', answer.text)
        return
      }
      if (live()) {
        answer.generatedWith = setup.generatedWith
        db.updateMessage(answer.id, { generatedWith: setup.generatedWith, updatedAt: iso() })
      }
      const commentedCode = deps.readCommentedCode
        ? await deps
            .readCommentedCode(conversation.repo, conversation.number, question.context)
            .catch(() => ({}))
        : {}
      if (signal.aborted) {
        settle('cancelled', answer.text)
        return
      }
      const result = await setup.service.analyzePullRequest(
        { repo: conversation.repo, number: conversation.number },
        {
          language: answer.language,
          signal,
          chat: { text: question.text, context: question.context, history, commentedCode },
          onProgress: (sections, meta) => {
            if (meta.done || settled) return
            answer.text = summaryText(sections)
            if (meta.activity) activity = meta.activity
            scheduleFlush()
          },
        },
      )
      // A provider may end quietly on abort: a cancel always wins.
      if (signal.aborted) {
        settle('cancelled', answer.text)
        return
      }
      const text = summaryText(result.sections)
      if (text.trim().length === 0) settle('failed', answer.text, mt('ai.chat.empty'))
      else settle('done', text)
    } catch (error) {
      if (signal.aborted) settle('cancelled', answer.text)
      else settle('failed', answer.text, errorMessage(error))
    }
  }

  /**
   * Starts the run, then pushes the conversation (now `running`) and the
   * messages that changed, in that order: a new conversation is known to the
   * renderer before its messages.
   */
  function begin(
    conversation: StoredConversation,
    question: ChatMessage,
    answer: ChatMessage,
    changed: ChatMessage[],
  ): ChatSendResult {
    const history = trimChatHistory(
      historyTurns(
        db
          .listMessages(conversation.id)
          .filter((message) => message.id !== question.id && message.id !== answer.id),
      ),
    )
    startRun(conversation, question, answer, history)
    const result: ChatSendResult = {
      conversation: summary(requireConversation(conversation.id)),
      userMessage: question,
      assistantMessage: answer,
    }
    broadcast({ type: 'conversation', conversation: result.conversation })
    for (const message of changed) {
      broadcast({ type: 'message', prKey: conversation.prKey, message })
    }
    return result
  }

  return {
    list(repo, number) {
      return db.listConversations(prKey(repo, number)).map(summary)
    },

    get(conversationId, options) {
      const conversation = requireConversation(conversationId)
      const page = db.getPage(conversationId, options)
      return { conversation: summary(conversation), ...page }
    },

    send(req) {
      if (runs.size >= MAX_CONCURRENT_CHAT_RUNS) throw new Error(mt('ai.chat.tooMany'))
      const key = prKey(req.repo, req.number)
      const createdAt = iso()
      let conversation: StoredConversation
      if (req.conversationId !== undefined) {
        const existing = db.getConversation(req.conversationId)
        // Another PR's conversation reads as missing: ids never cross PRs.
        if (!existing || existing.prKey !== key) throw new Error(mt('ai.chat.notFound'))
        if (runs.has(existing.id)) throw new Error(mt('ai.chat.busy'))
        conversation = existing
      } else {
        const id = newId()
        db.createConversation({
          id,
          prKey: key,
          repo: req.repo,
          number: req.number,
          title: conversationTitle(req.text),
          createdAt,
        })
        conversation = requireConversation(id)
      }

      const question: ChatMessage = {
        id: newId(),
        conversationId: conversation.id,
        role: 'user',
        text: req.text,
        context: req.context,
        status: 'done',
        createdAt,
        updatedAt: createdAt,
      }
      const answer: ChatMessage = {
        id: newId(),
        conversationId: conversation.id,
        role: 'assistant',
        text: '',
        context: [],
        status: 'streaming',
        language: deps.currentLanguage(),
        createdAt,
        updatedAt: createdAt,
      }
      db.transaction(() => {
        db.insertMessage(question)
        db.insertMessage(answer)
        db.touchConversation(conversation.id, createdAt)
      })
      return begin(conversation, question, answer, [question, answer])
    },

    retry(conversationId) {
      const conversation = requireConversation(conversationId)
      if (runs.has(conversationId)) throw new Error(mt('ai.chat.busy'))
      if (runs.size >= MAX_CONCURRENT_CHAT_RUNS) throw new Error(mt('ai.chat.tooMany'))
      const [question, last] = db.lastMessages(conversationId, 2)
      const retryable =
        question?.role === 'user' &&
        last?.role === 'assistant' &&
        (last.status === 'failed' || last.status === 'cancelled' || last.status === 'interrupted')
      if (!retryable) throw new Error(mt('ai.chat.notRetryable'))

      const updatedAt = iso()
      // The same message, reset: it keeps its id and place in the conversation.
      const answer: ChatMessage = {
        id: last.id,
        conversationId,
        role: 'assistant',
        text: '',
        context: [],
        status: 'streaming',
        language: deps.currentLanguage(),
        createdAt: last.createdAt,
        updatedAt,
      }
      db.transaction(() => {
        db.updateMessage(answer.id, {
          text: '',
          status: 'streaming',
          error: null,
          generatedWith: null,
          language: answer.language,
          updatedAt,
        })
        db.touchConversation(conversationId, updatedAt)
      })
      return begin(conversation, question, answer, [answer])
    },

    cancel(conversationId) {
      runs.get(conversationId)?.controller.abort()
    },

    delete(conversationId) {
      const conversation = db.getConversation(conversationId)
      const run = runs.get(conversationId)
      if (run) {
        // Stays in `runs` until it settles (`whenIdle`); its end writes nothing.
        run.removed = true
        run.controller.abort()
      }
      if (!conversation) return
      db.deleteConversation(conversationId)
      broadcast({ type: 'deleted', prKey: conversation.prKey, conversationId })
    },

    whenIdle(conversationId) {
      return runs.get(conversationId)?.done ?? Promise.resolve()
    },

    shutdown() {
      if (closed) return
      closed = true
      for (const run of runs.values()) run.controller.abort()
      runs.clear()
      try {
        db.interruptStreaming(iso())
      } finally {
        db.close()
      }
    },
  }
}
