/**
 * The side-panel chat ("Ask" tab) in the renderer: what main has told us
 * about each PR's saved conversations, plus the reviewer's unsent draft.
 *
 * - `lists[prKey]`: the PR's conversation summaries, newest first.
 * - `transcripts[conversationId]`: the ids of the loaded messages (oldest
 *   first) and whether older ones exist; `messages[id]` holds each message.
 *   A streaming answer only replaces its own entry in `messages`, so its row
 *   (which selects by id) is the only one that re-renders per chunk.
 * - `activity[messageId]`: the live tool log of a streaming answer.
 * - `active[prKey]`: the open conversation; `null`/absent = a new one.
 * - `drafts[prKey]`: the context items gathered from the diff and the text
 *   typed in the composer. Session memory only.
 *
 * Main owns the conversations (`chat:*`, `chatEvent`): the renderer never
 * sends history, and every change main pushes lands here through
 * `applyEvent` (subscribed once, `useChatEvents`).
 */
import { create } from 'zustand'
import type {
  ChatContextItem,
  ChatConversationSummary,
  ChatEvent,
  ChatMessage,
  ChatPage,
  ChatSendResult,
} from '../../../shared/chat'
import { MAX_CHAT_CONTEXT_ITEMS, MAX_CHAT_MESSAGE_LEN } from '../../../shared/chat'
import type { AnalysisActivityItem } from '../../../shared/events'
import { prKey, type RepoRef } from '../../../shared/scm'
import { errorText } from '../lib/error-text'
import { fitContext } from '../lib/chat-context'

export interface ConversationList {
  /** Newest first; `null` until the first `chat:list` answer. */
  items: ChatConversationSummary[] | null
  loading: boolean
  error: string | null
}

export interface Transcript {
  /** Loaded messages, oldest first. */
  ids: string[]
  /** The newest page arrived (or the conversation was started here): nothing to fetch. */
  loaded: boolean
  hasMore: boolean
  loading: boolean
  loadingOlder: boolean
  error: string | null
}

export interface ChatDraft {
  items: ChatContextItem[]
  text: string
}

interface ChatState {
  lists: Record<string, ConversationList>
  transcripts: Record<string, Transcript>
  messages: Record<string, ChatMessage>
  activity: Record<string, AnalysisActivityItem[]>
  active: Record<string, string | null>
  drafts: Record<string, ChatDraft>
  /** A send of this PR's draft is on its way to main. */
  sending: Record<string, boolean>
  /** The last failed action of this PR's panel (send, retry, stop, delete…), shown above the composer. */
  errors: Record<string, string | null>

  /** Asks main for the PR's conversations (again, if `force`). */
  loadList: (repo: RepoRef, number: number, force?: boolean) => Promise<void>
  /** Loads the newest page of a conversation, once (again, if `force`). */
  loadConversation: (conversationId: string, force?: boolean) => Promise<void>
  loadOlder: (conversationId: string) => Promise<void>
  /** Opens a conversation (`null` = a new one) and loads it. */
  setActive: (key: string, conversationId: string | null) => void
  setDraftText: (key: string, text: string) => void
  /** Adds an item (a line already there is replaced in place). `false` when the draft is full. */
  addContextItem: (key: string, item: ChatContextItem) => boolean
  removeContextItem: (key: string, itemId: string) => void
  /** Adds the thread, or removes it when already there. `false` when it could not be added (full). */
  toggleThreadItem: (key: string, item: ChatContextItem & { kind: 'thread' }) => boolean
  /** Sends the draft to the active conversation (or a new one). */
  send: (repo: RepoRef, number: number) => Promise<void>
  retry: (key: string, conversationId: string) => Promise<void>
  cancel: (key: string, conversationId: string) => Promise<void>
  remove: (key: string, conversationId: string) => Promise<void>
  dismissError: (key: string) => void
  applyEvent: (event: ChatEvent) => void
}

const EMPTY_DRAFT: ChatDraft = { items: [], text: '' }

function chatApi(): Window['minerva']['chat'] {
  return window.minerva.chat
}

/** The fresher of two copies of one message (events can overtake a page or a send result). */
function fresher(current: ChatMessage | undefined, incoming: ChatMessage): ChatMessage {
  if (!current) return incoming
  if (incoming.updatedAt > current.updatedAt) return incoming
  if (incoming.updatedAt < current.updatedAt) return current
  // Same timestamp: a settled copy wins over a streaming one, then the longer text.
  if (current.status === 'streaming' && incoming.status !== 'streaming') return incoming
  if (incoming.status === 'streaming' && current.status !== 'streaming') return current
  return incoming.text.length >= current.text.length ? incoming : current
}

function sortSummaries(items: ChatConversationSummary[]): ChatConversationSummary[] {
  return [...items].sort((a, b) =>
    a.updatedAt === b.updatedAt ? 0 : a.updatedAt > b.updatedAt ? -1 : 1,
  )
}

function upsertSummary(
  lists: Record<string, ConversationList>,
  summary: ChatConversationSummary,
): Record<string, ConversationList> {
  const list = lists[summary.prKey]
  if (!list?.items) return lists
  const rest = list.items.filter((c) => c.id !== summary.id)
  return { ...lists, [summary.prKey]: { ...list, items: sortSummaries([summary, ...rest]) } }
}

function withMessages(
  messages: Record<string, ChatMessage>,
  incoming: readonly ChatMessage[],
): Record<string, ChatMessage> {
  const next = { ...messages }
  for (const message of incoming) next[message.id] = fresher(next[message.id], message)
  return next
}

/** `ids` with `id` appended unless already there (same array when nothing changes). */
function appendId(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids : [...ids, id]
}

function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record
  const next = { ...record }
  delete next[key]
  return next
}

const NEW_TRANSCRIPT: Transcript = {
  ids: [],
  loaded: false,
  hasMore: false,
  loading: false,
  loadingOlder: false,
  error: null,
}

export const useChatStore = create<ChatState>((set, get) => {
  function setError(key: string, error: unknown): void {
    set((s) => ({ errors: { ...s.errors, [key]: errorText(error) } }))
  }

  function patchTranscript(conversationId: string, patch: Partial<Transcript>): void {
    set((s) => {
      const current = s.transcripts[conversationId] ?? NEW_TRANSCRIPT
      return { transcripts: { ...s.transcripts, [conversationId]: { ...current, ...patch } } }
    })
  }

  /** A `chat:send`/`chat:retry` answer: summary, both messages, and the transcript's order. */
  function applySendResult(result: ChatSendResult): void {
    const { conversation, userMessage, assistantMessage } = result
    set((s) => {
      // No transcript yet = a conversation this send just started: nothing older to fetch.
      const transcript = s.transcripts[conversation.id] ?? { ...NEW_TRANSCRIPT, loaded: true }
      // A retry replaces the last answer: drop any other answer after the question.
      const at = transcript.ids.indexOf(userMessage.id)
      const before = at >= 0 ? transcript.ids.slice(0, at) : transcript.ids
      const ids = [...before, userMessage.id, assistantMessage.id]
      const dropped = at >= 0 ? transcript.ids.slice(at + 1).filter((id) => !ids.includes(id)) : []
      let messages = withMessages(s.messages, [userMessage, assistantMessage])
      let activity = s.activity
      for (const id of dropped) {
        messages = withoutKey(messages, id)
        activity = withoutKey(activity, id)
      }
      const lists = s.lists[conversation.prKey]?.items
        ? upsertSummary(s.lists, conversation)
        : {
            ...s.lists,
            [conversation.prKey]: {
              items: [conversation],
              loading: false,
              error: null,
            },
          }
      return {
        lists,
        messages,
        activity,
        transcripts: { ...s.transcripts, [conversation.id]: { ...transcript, ids } },
      }
    })
  }

  function mergePage(conversationId: string, page: ChatPage, older: boolean): void {
    set((s) => {
      const current = s.transcripts[conversationId] ?? NEW_TRANSCRIPT
      const pageIds = page.messages.map((m) => m.id)
      const others = current.ids.filter((id) => !pageIds.includes(id))
      // An older page goes before what is loaded. The newest page replaces it,
      // keeping only messages pushed while it was on its way (newer than it).
      const newestInPage = page.messages[page.messages.length - 1]?.createdAt ?? ''
      const ids = older
        ? [...pageIds, ...others]
        : [
            ...pageIds,
            ...others.filter((id) => (s.messages[id]?.createdAt ?? '') >= newestInPage),
          ]
      return {
        messages: withMessages(s.messages, page.messages),
        lists: upsertSummary(s.lists, page.conversation),
        transcripts: {
          ...s.transcripts,
          [conversationId]: {
            ...current,
            ids,
            loaded: true,
            // Either way the page says whether anything older than it exists.
            hasMore: page.hasMore,
            loading: false,
            loadingOlder: false,
            error: null,
          },
        },
      }
    })
  }

  return {
    lists: {},
    transcripts: {},
    messages: {},
    activity: {},
    active: {},
    drafts: {},
    sending: {},
    errors: {},

    async loadList(repo, number, force = false) {
      const key = prKey(repo, number)
      const existing = get().lists[key]
      if (existing && (existing.loading || (existing.items && !force))) return
      set((s) => ({
        lists: {
          ...s.lists,
          [key]: { items: existing?.items ?? null, loading: true, error: null },
        },
      }))
      try {
        const items = await chatApi().list({ repo, number })
        set((s) => {
          // Summaries pushed while the list was loading are as fresh as these.
          const pushed = (s.lists[key]?.items ?? []).filter(
            (c) => !items.some((item) => item.id === c.id),
          )
          return {
            lists: {
              ...s.lists,
              [key]: { items: sortSummaries([...items, ...pushed]), loading: false, error: null },
            },
          }
        })
      } catch (err: unknown) {
        set((s) => ({
          lists: {
            ...s.lists,
            [key]: { items: s.lists[key]?.items ?? null, loading: false, error: errorText(err) },
          },
        }))
      }
    },

    async loadConversation(conversationId, force = false) {
      const existing = get().transcripts[conversationId]
      if (existing && (existing.loading || (existing.loaded && !force))) return
      patchTranscript(conversationId, { loading: true, error: null })
      try {
        const page = await chatApi().get({ conversationId })
        mergePage(conversationId, page, false)
      } catch (err: unknown) {
        patchTranscript(conversationId, { loading: false, error: errorText(err) })
      }
    },

    async loadOlder(conversationId) {
      const transcript = get().transcripts[conversationId]
      if (!transcript || !transcript.hasMore || transcript.loadingOlder || transcript.loading) return
      const before = transcript.ids[0]
      if (!before) return
      patchTranscript(conversationId, { loadingOlder: true, error: null })
      try {
        const page = await chatApi().get({ conversationId, before })
        mergePage(conversationId, page, true)
      } catch (err: unknown) {
        patchTranscript(conversationId, { loadingOlder: false, error: errorText(err) })
      }
    },

    setActive(key, conversationId) {
      set((s) => ({ active: { ...s.active, [key]: conversationId } }))
      if (conversationId) void get().loadConversation(conversationId)
    },

    setDraftText(key, text) {
      set((s) => {
        const draft = s.drafts[key] ?? EMPTY_DRAFT
        return {
          drafts: { ...s.drafts, [key]: { ...draft, text: text.slice(0, MAX_CHAT_MESSAGE_LEN) } },
        }
      })
    },

    addContextItem(key, item) {
      const draft = get().drafts[key] ?? EMPTY_DRAFT
      const same = draft.items.findIndex((existing) => sameTarget(existing, item))
      if (same >= 0) {
        const items = [...draft.items]
        items[same] = item
        set((s) => ({ drafts: { ...s.drafts, [key]: { ...draft, items } } }))
        return true
      }
      if (draft.items.length >= MAX_CHAT_CONTEXT_ITEMS) return false
      set((s) => ({ drafts: { ...s.drafts, [key]: { ...draft, items: [...draft.items, item] } } }))
      return true
    },

    removeContextItem(key, itemId) {
      set((s) => {
        const draft = s.drafts[key]
        if (!draft) return {}
        return {
          drafts: {
            ...s.drafts,
            [key]: { ...draft, items: draft.items.filter((item) => item.id !== itemId) },
          },
        }
      })
    },

    toggleThreadItem(key, item) {
      const draft = get().drafts[key] ?? EMPTY_DRAFT
      const existing = draft.items.find((other) => sameTarget(other, item))
      if (existing) {
        get().removeContextItem(key, existing.id)
        return true
      }
      return get().addContextItem(key, item)
    },

    async send(repo, number) {
      const key = prKey(repo, number)
      const state = get()
      const draft = state.drafts[key] ?? EMPTY_DRAFT
      const text = draft.text.trim()
      if (!text || state.sending[key]) return
      const conversationId = state.active[key] ?? null
      if (conversationId && isConversationBusy(state, key, conversationId)) return
      set((s) => ({ sending: { ...s.sending, [key]: true }, errors: { ...s.errors, [key]: null } }))
      try {
        const result = await chatApi().send({
          repo,
          number,
          ...(conversationId ? { conversationId } : {}),
          text,
          context: fitContext(draft.items),
        })
        applySendResult(result)
        set((s) => ({
          // The reviewer may have opened another conversation meanwhile: only follow from where it was sent.
          active:
            (s.active[key] ?? null) === conversationId
              ? { ...s.active, [key]: result.conversation.id }
              : s.active,
          drafts: { ...s.drafts, [key]: EMPTY_DRAFT },
        }))
      } catch (err: unknown) {
        setError(key, err)
      } finally {
        set((s) => ({ sending: { ...s.sending, [key]: false } }))
      }
    },

    async retry(key, conversationId) {
      set((s) => ({ errors: { ...s.errors, [key]: null } }))
      try {
        applySendResult(await chatApi().retry({ conversationId }))
      } catch (err: unknown) {
        setError(key, err)
      }
    },

    async cancel(key, conversationId) {
      try {
        await chatApi().cancel({ conversationId })
      } catch (err: unknown) {
        setError(key, err)
      }
    },

    async remove(key, conversationId) {
      try {
        await chatApi().delete({ conversationId })
        get().applyEvent({ type: 'deleted', prKey: key, conversationId })
      } catch (err: unknown) {
        setError(key, err)
      }
    },

    dismissError(key) {
      set((s) => ({ errors: { ...s.errors, [key]: null } }))
    },

    applyEvent(event) {
      if (event.type === 'conversation') {
        set((s) => ({ lists: upsertSummary(s.lists, event.conversation) }))
        return
      }
      if (event.type === 'deleted') {
        set((s) => {
          const list = s.lists[event.prKey]
          const transcript = s.transcripts[event.conversationId]
          let messages = s.messages
          let activity = s.activity
          for (const id of transcript?.ids ?? []) {
            messages = withoutKey(messages, id)
            activity = withoutKey(activity, id)
          }
          return {
            lists: list?.items
              ? {
                  ...s.lists,
                  [event.prKey]: {
                    ...list,
                    items: list.items.filter((c) => c.id !== event.conversationId),
                  },
                }
              : s.lists,
            transcripts: withoutKey(s.transcripts, event.conversationId),
            messages,
            activity,
            active:
              s.active[event.prKey] === event.conversationId
                ? { ...s.active, [event.prKey]: null }
                : s.active,
          }
        })
        return
      }
      const { message, activity } = event
      set((s) => {
        const merged = fresher(s.messages[message.id], message)
        const transcript = s.transcripts[message.conversationId]
        const nextActivity =
          merged.status === 'streaming' && activity
            ? { ...s.activity, [message.id]: activity }
            : merged.status === 'streaming'
              ? s.activity
              : withoutKey(s.activity, message.id)
        return {
          messages: merged === s.messages[message.id] ? s.messages : { ...s.messages, [message.id]: merged },
          activity: nextActivity,
          // A transcript the panel knows grows; others get it with their first page.
          transcripts:
            transcript
              ? {
                  ...s.transcripts,
                  [message.conversationId]: {
                    ...transcript,
                    ids: appendId(transcript.ids, message.id),
                  },
                }
              : s.transcripts,
        }
      })
    },
  }
})

/** Two items about the same line, or the same thread. */
function sameTarget(a: ChatContextItem, b: ChatContextItem): boolean {
  if (a.kind === 'thread' && b.kind === 'thread') return a.threadId === b.threadId
  if (a.kind === 'line' && b.kind === 'line')
    return a.path === b.path && a.side === b.side && a.line === b.line
  return false
}

/** An answer of this conversation is being written (summary or a loaded message says so). */
export function isConversationBusy(
  state: Pick<ChatState, 'lists' | 'transcripts' | 'messages'>,
  key: string,
  conversationId: string,
): boolean {
  const summary = state.lists[key]?.items?.find((c) => c.id === conversationId)
  if (summary?.running) return true
  const ids = state.transcripts[conversationId]?.ids ?? []
  const lastId = ids[ids.length - 1]
  return lastId !== undefined && state.messages[lastId]?.status === 'streaming'
}

/** The PR's draft (stable empty one when nothing was gathered yet). */
export function useChatDraft(key: string): ChatDraft {
  return useChatStore((s) => s.drafts[key] ?? EMPTY_DRAFT)
}
