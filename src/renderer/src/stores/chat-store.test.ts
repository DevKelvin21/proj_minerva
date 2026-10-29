import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ChatContextItem,
  ChatLineContext,
  ChatConversationSummary,
  ChatMessage,
  ChatPage,
  ChatSendRequest,
  ChatSendResult,
} from '../../../shared/chat'
import { MAX_CHAT_CONTEXT_ITEMS } from '../../../shared/chat'
import { prKey, type RepoRef } from '../../../shared/scm'

const repo: RepoRef = { provider: 'github', owner: 'o', name: 'r', fullName: 'o/r' } as RepoRef
const KEY = prKey(repo, 1)

const list = vi.fn<(req: { repo: RepoRef; number: number }) => Promise<ChatConversationSummary[]>>()
const get = vi.fn<(req: { conversationId: string; before?: string }) => Promise<ChatPage>>()
const send = vi.fn<(req: ChatSendRequest) => Promise<ChatSendResult>>()
const retry = vi.fn<(req: { conversationId: string }) => Promise<ChatSendResult>>()
const cancel = vi.fn<(req: { conversationId: string }) => Promise<void>>()
const del = vi.fn<(req: { conversationId: string }) => Promise<void>>()

async function loadStore() {
  vi.resetModules()
  return (await import('./chat-store')).useChatStore
}

function summary(id: string, over: Partial<ChatConversationSummary> = {}): ChatConversationSummary {
  return {
    id,
    prKey: KEY,
    repo,
    number: 1,
    title: 'Title ' + id,
    messageCount: 2,
    lastMessagePreview: 'preview',
    running: false,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...over,
  }
}

function message(id: string, over: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id,
    conversationId: 'c1',
    role: 'assistant',
    text: '',
    context: [],
    status: 'done',
    createdAt: '2026-10-01T00:00:0' + id.slice(-1) + '.000Z',
    updatedAt: '2026-10-01T00:00:0' + id.slice(-1) + '.000Z',
    ...over,
  }
}

function sendResult(conversationId = 'c1'): ChatSendResult {
  return {
    conversation: summary(conversationId, { running: true }),
    userMessage: message('m1', { conversationId, role: 'user', text: 'Why?' }),
    assistantMessage: message('m2', { conversationId, status: 'streaming' }),
  }
}

const line = (n: number): ChatLineContext => ({
  kind: 'line',
  id: 'l' + n,
  path: 'src/a.ts',
  side: 'new',
  line: n,
  code: 'code ' + n,
  note: '',
})

beforeEach(() => {
  for (const fn of [list, get, send, retry, cancel, del]) fn.mockReset()
  vi.stubGlobal('window', {
    minerva: { chat: { list, get, send, retry, cancel, delete: del } },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('drafts', () => {
  it('replaces a line already there, toggles threads, and refuses past the limit', async () => {
    const store = await loadStore()
    const s = () => store.getState()
    expect(s().addContextItem(KEY, line(1))).toBe(true)
    expect(s().addContextItem(KEY, { ...line(1), id: 'again', note: 'new note' })).toBe(true)
    expect(s().drafts[KEY].items).toEqual([{ ...line(1), id: 'again', note: 'new note' }])

    const thread: ChatContextItem & { kind: 'thread' } = {
      kind: 'thread',
      id: 't',
      threadId: 'th1',
      path: 'src/a.ts',
      side: 'new',
      outdated: false,
      comments: [{ author: 'a', body: 'b' }],
    }
    s().toggleThreadItem(KEY, thread)
    expect(s().drafts[KEY].items).toHaveLength(2)
    s().toggleThreadItem(KEY, { ...thread, id: 'other-id' })
    expect(s().drafts[KEY].items).toHaveLength(1)

    for (let i = 2; i <= MAX_CHAT_CONTEXT_ITEMS; i++) expect(s().addContextItem(KEY, line(i))).toBe(true)
    expect(s().addContextItem(KEY, line(99))).toBe(false)
    s().removeContextItem(KEY, 'l2')
    expect(s().drafts[KEY].items).toHaveLength(MAX_CHAT_CONTEXT_ITEMS - 1)
  })
})

describe('send', () => {
  it('starts a conversation, follows it, and clears the draft', async () => {
    const store = await loadStore()
    const s = () => store.getState()
    send.mockResolvedValue(sendResult())
    s().addContextItem(KEY, line(1))
    s().setDraftText(KEY, '  Why?  ')
    await s().send(repo, 1)

    expect(send).toHaveBeenCalledWith({ repo, number: 1, text: 'Why?', context: [line(1)] })
    expect(s().active[KEY]).toBe('c1')
    expect(s().transcripts.c1.ids).toEqual(['m1', 'm2'])
    expect(s().transcripts.c1.loaded).toBe(true)
    expect(s().lists[KEY].items?.map((c) => c.id)).toEqual(['c1'])
    expect(s().drafts[KEY]).toEqual({ items: [], text: '' })
    expect(s().sending[KEY]).toBe(false)
  })

  it('keeps the draft and shows the error when main refuses', async () => {
    const store = await loadStore()
    const s = () => store.getState()
    send.mockRejectedValue(new Error("Error invoking remote method 'chat:send': Error: Too long"))
    s().setDraftText(KEY, 'Why?')
    await s().send(repo, 1)
    expect(s().errors[KEY]).toBe('Too long')
    expect(s().drafts[KEY].text).toBe('Why?')
  })

  it('does not send to a conversation whose answer is still being written', async () => {
    const store = await loadStore()
    const s = () => store.getState()
    send.mockResolvedValue(sendResult())
    s().setDraftText(KEY, 'Why?')
    await s().send(repo, 1)
    s().setDraftText(KEY, 'And?')
    await s().send(repo, 1)
    expect(send).toHaveBeenCalledTimes(1)
  })
})

describe('events', () => {
  it('keeps a streaming answer\'s stage until it settles', async () => {
    const store = await loadStore()
    const s = () => store.getState()
    send.mockResolvedValue(sendResult())
    s().setDraftText(KEY, 'Why?')
    await s().send(repo, 1)
    expect(s().stage.m2).toBeUndefined()

    s().applyEvent({
      type: 'message',
      prKey: KEY,
      message: message('m2', { status: 'streaming', text: '', updatedAt: '2026-10-01T00:01:00.000Z' }),
      stage: 'loading',
    })
    expect(s().stage.m2).toBe('loading')
    // An event without a stage (a flush that lost the race) keeps the last one.
    s().applyEvent({
      type: 'message',
      prKey: KEY,
      message: message('m2', { status: 'streaming', text: '', updatedAt: '2026-10-01T00:01:01.000Z' }),
    })
    expect(s().stage.m2).toBe('loading')

    s().applyEvent({
      type: 'message',
      prKey: KEY,
      message: message('m2', { text: 'Done', updatedAt: '2026-10-01T00:02:00.000Z' }),
    })
    expect(s().stage.m2).toBeUndefined()
  })

  it('a streaming message only replaces its own entry; settling drops the activity', async () => {
    const store = await loadStore()
    const s = () => store.getState()
    send.mockResolvedValue(sendResult())
    s().setDraftText(KEY, 'Why?')
    await s().send(repo, 1)

    const ids = s().transcripts.c1.ids
    const user = s().messages.m1
    const activity = [{ id: 'a1', kind: 'read' as const, label: 'Read a.ts', status: 'running' as const }]
    s().applyEvent({
      type: 'message',
      prKey: KEY,
      message: message('m2', { status: 'streaming', text: 'Part', updatedAt: '2026-10-01T00:01:00.000Z' }),
      activity,
    })
    expect(s().messages.m2.text).toBe('Part')
    expect(s().messages.m1).toBe(user)
    expect(s().transcripts.c1.ids).toBe(ids)
    expect(s().activity.m2).toEqual(activity)

    s().applyEvent({
      type: 'message',
      prKey: KEY,
      message: message('m2', { text: 'Part and the rest', updatedAt: '2026-10-01T00:02:00.000Z' }),
    })
    expect(s().messages.m2.status).toBe('done')
    expect(s().activity.m2).toBeUndefined()

    // A late, older copy never wins over the settled one.
    s().applyEvent({
      type: 'message',
      prKey: KEY,
      message: message('m2', { status: 'streaming', text: 'Pa', updatedAt: '2026-10-01T00:01:30.000Z' }),
    })
    expect(s().messages.m2.text).toBe('Part and the rest')
  })

  it('summaries stay newest first; a deletion drops the conversation and its messages', async () => {
    const store = await loadStore()
    const s = () => store.getState()
    list.mockResolvedValue([
      summary('c2', { updatedAt: '2026-10-02T00:00:00.000Z' }),
      summary('c1'),
    ])
    await s().loadList(repo, 1)
    expect(s().lists[KEY].items?.map((c) => c.id)).toEqual(['c2', 'c1'])

    s().applyEvent({
      type: 'conversation',
      conversation: summary('c1', { updatedAt: '2026-10-03T00:00:00.000Z', running: true }),
    })
    expect(s().lists[KEY].items?.map((c) => c.id)).toEqual(['c1', 'c2'])

    get.mockResolvedValue({ conversation: summary('c1'), messages: [message('m1')], hasMore: false })
    s().setActive(KEY, 'c1')
    await vi.waitFor(() => expect(s().transcripts.c1?.loaded).toBe(true))
    s().applyEvent({ type: 'deleted', prKey: KEY, conversationId: 'c1' })
    expect(s().lists[KEY].items?.map((c) => c.id)).toEqual(['c2'])
    expect(s().active[KEY]).toBeNull()
    expect(s().messages.m1).toBeUndefined()
    expect(s().transcripts.c1).toBeUndefined()
  })
})

describe('paging', () => {
  it('loads a conversation once, then older pages before it', async () => {
    const store = await loadStore()
    const s = () => store.getState()
    get.mockResolvedValueOnce({
      conversation: summary('c1'),
      messages: [message('m3'), message('m4')],
      hasMore: true,
    })
    await s().loadConversation('c1')
    await s().loadConversation('c1')
    expect(get).toHaveBeenCalledTimes(1)
    expect(s().transcripts.c1.ids).toEqual(['m3', 'm4'])

    get.mockResolvedValueOnce({
      conversation: summary('c1'),
      messages: [message('m1'), message('m2')],
      hasMore: false,
    })
    await s().loadOlder('c1')
    expect(get).toHaveBeenLastCalledWith({ conversationId: 'c1', before: 'm3' })
    expect(s().transcripts.c1.ids).toEqual(['m1', 'm2', 'm3', 'm4'])
    expect(s().transcripts.c1.hasMore).toBe(false)
  })

  it('a retry replaces the failed answer', async () => {
    const store = await loadStore()
    const s = () => store.getState()
    get.mockResolvedValueOnce({
      conversation: summary('c1'),
      messages: [
        message('m1', { role: 'user', text: 'Why?' }),
        message('m2', { status: 'failed', error: 'boom' }),
      ],
      hasMore: false,
    })
    await s().loadConversation('c1')
    retry.mockResolvedValue({
      conversation: summary('c1', { running: true }),
      userMessage: message('m1', { role: 'user', text: 'Why?' }),
      assistantMessage: message('m5', { status: 'streaming' }),
    })
    await s().retry(KEY, 'c1')
    expect(s().transcripts.c1.ids).toEqual(['m1', 'm5'])
    expect(s().messages.m2).toBeUndefined()
  })
})
