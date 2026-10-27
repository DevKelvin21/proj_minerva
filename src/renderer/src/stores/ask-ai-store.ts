/**
 * The reviewer's "Ask AI" conversations, one per diff line or comment thread
 * of a PR, kept for the session (memory only: quitting clears them).
 *
 * The store runs each question itself (`ask`), so closing the card while the
 * AI is thinking loses nothing: the answer lands in the conversation and
 * shows when the card opens again. One question at a time per conversation.
 */
import { create } from 'zustand'
import type { AskHistoryTurn, LineAnswer } from '../../../shared/types'
import { errorText } from '../lib/error-text'

/** What a conversation is about, so a diff can tell which of its lines have one. */
export type AskSubject =
  | { kind: 'line'; pr: string; path: string; side: 'LEFT' | 'RIGHT'; line: number }
  | { kind: 'thread'; pr: string; threadId: string }

export interface AskTurn {
  question: string
  answer: LineAnswer
}

export interface AskConversation {
  subject: AskSubject
  turns: AskTurn[]
  /** The question the AI is answering right now. */
  pending: string | null
  /** The last question failed: shown with Retry / Edit until the next ask. */
  failed: { question: string; message: string } | null
  /** Bumped by `clear`: an answer to a question asked before it is dropped. */
  epoch: number
}

/** Runs one question with the earlier exchanges of its conversation. */
export type AskRunner = (question: string, history: AskHistoryTurn[]) => Promise<LineAnswer>

interface AskAiState {
  conversations: ReadonlyMap<string, AskConversation>
  ask: (subject: AskSubject, question: string, run: AskRunner) => Promise<void>
  /** Drops the failed question's error (Edit puts it back in the box). */
  dismissFailure: (subject: AskSubject) => void
  clear: (subject: AskSubject) => void
}

export function askKey(subject: AskSubject): string {
  return subject.kind === 'line'
    ? `${subject.pr}|line|${subject.side}|${subject.line}|${subject.path}`
    : `${subject.pr}|thread|${subject.threadId}`
}

const EMPTY = (subject: AskSubject, epoch = 0): AskConversation => ({
  subject,
  turns: [],
  pending: null,
  failed: null,
  epoch,
})

export const useAskAiStore = create<AskAiState>((set, get) => {
  function update(key: string, change: (c: AskConversation) => AskConversation): void {
    const current = get().conversations.get(key)
    if (!current) return
    const next = new Map(get().conversations)
    next.set(key, change(current))
    set({ conversations: next })
  }

  return {
    conversations: new Map(),

    async ask(subject, question, run) {
      const key = askKey(subject)
      const existing = get().conversations.get(key)
      if (existing?.pending) return
      const conversation = existing ?? EMPTY(subject)
      const { epoch } = conversation
      const history = conversation.turns.map((t) => ({
        question: t.question,
        answer: t.answer.markdown,
      }))
      const next = new Map(get().conversations)
      next.set(key, { ...conversation, pending: question, failed: null })
      set({ conversations: next })
      try {
        const answer = await run(question, history)
        update(key, (c) =>
          c.epoch === epoch
            ? { ...c, turns: [...c.turns, { question, answer }], pending: null }
            : c,
        )
      } catch (err: unknown) {
        update(key, (c) =>
          c.epoch === epoch
            ? { ...c, pending: null, failed: { question, message: errorText(err) } }
            : c,
        )
      }
    },

    dismissFailure(subject) {
      update(askKey(subject), (c) => ({ ...c, failed: null }))
    },

    clear(subject) {
      update(askKey(subject), (c) => EMPTY(c.subject, c.epoch + 1))
    },
  }
})

/** The conversation about `subject`, or `undefined` before the first question. */
export function useAskConversation(subject: AskSubject | undefined): AskConversation | undefined {
  return useAskAiStore((s) => (subject ? s.conversations.get(askKey(subject)) : undefined))
}

/** Has something to show: an answer, a question being answered, or a failed one. */
export function isLiveConversation(conversation: AskConversation | undefined): boolean {
  if (!conversation) return false
  return (
    conversation.turns.length > 0 || conversation.pending !== null || conversation.failed !== null
  )
}
