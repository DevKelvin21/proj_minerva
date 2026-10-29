import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatEvent, ChatLineContext, ChatSendRequest } from '../../shared/chat'
import type { AnalysisActivityItem } from '../../shared/events'
import { prKey } from '../../shared/scm'
import { githubRepo } from '../../shared/scm-guards'
import type { AnalysisGenerationInfo } from '../../shared/types'
import type { AiService, AnalyzePullRequestOptions, ChatHistoryTurn } from '../ai/service'
import { openChatDb, type ChatDb } from './chat-db'
import {
  createChatService,
  historyTurns,
  MAX_CONCURRENT_CHAT_RUNS,
  trimChatHistory,
  type ChatService,
} from './chat-service'

const repo = githubRepo('shopwave', 'api')
const KEY = prKey(repo, 482)
const SEAL: AnalysisGenerationInfo = { provider: 'claude-code', model: 'claude-x', options: {} }

const line: ChatLineContext = {
  kind: 'line',
  id: 'l1',
  path: 'src/a.ts',
  side: 'new',
  line: 3,
  code: 'const a = 1',
  note: '',
}

interface FakeCall {
  options: AnalyzePullRequestOptions
  progress(text: string, activity?: AnalysisActivityItem[]): void
  finish(text: string): void
  fail(message: string): void
}

/**
 * An AiService the test drives: each run waits until the test finishes or
 * fails it. `ignoreAbort` = a provider that ends quietly instead of rejecting.
 */
function fakeAi(state: { ignoreAbort: boolean } = { ignoreAbort: false }): {
  service: AiService
  calls: FakeCall[]
  state: { ignoreAbort: boolean }
} {
  const calls: FakeCall[] = []
  const service: AiService = {
    analyzePullRequest: (_req, options = {}) =>
      new Promise((resolve, reject) => {
        options.signal?.addEventListener('abort', () => {
          if (!state.ignoreAbort) reject(new Error('aborted'))
        })
        calls.push({
          options,
          progress: (text, activity) =>
            options.onProgress?.([{ kind: 'summary', markdown: text, streaming: true }], {
              done: false,
              phase: 'writing',
              activity,
            }),
          finish: (text) =>
            resolve({
              prId: KEY,
              headSha: 'abc',
              generatedAt: '2026-10-28T00:00:00.000Z',
              sections: text.length > 0 ? [{ kind: 'summary', markdown: text }] : [],
            }),
          fail: (message) => reject(new Error(message)),
        })
      }),
  }
  return { service, calls, state }
}

let db: ChatDb
let ai: ReturnType<typeof fakeAi>
let events: ChatEvent[]
let chat: ChatService
let ids: number

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-10-28T10:00:00.000Z') })
  db = openChatDb(':memory:')
  ai = fakeAi()
  events = []
  ids = 0
  chat = createChatService({
    db,
    prepareRun: async () => ({ service: ai.service, generatedWith: SEAL }),
    currentLanguage: () => 'es',
    broadcast: (event) => events.push(event),
    newId: () => 'id' + ++ids,
  })
})

afterEach(() => {
  vi.useRealTimers()
})

function request(overrides: Partial<ChatSendRequest> = {}): ChatSendRequest {
  return { repo, number: 482, text: 'Why clamp the discount?', context: [line], ...overrides }
}

/** Lets the run reach the provider (`prepareRun` is async). */
async function started(count = 1): Promise<FakeCall> {
  await vi.advanceTimersByTimeAsync(0)
  expect(ai.calls).toHaveLength(count)
  return ai.calls[count - 1]
}

function messageEvents(): Extract<ChatEvent, { type: 'message' }>[] {
  return events.filter((event): event is Extract<ChatEvent, { type: 'message' }> => {
    return event.type === 'message'
  })
}

describe('chat-service send', () => {
  it('creates the conversation, saves both messages and answers in the background', async () => {
    const result = chat.send(request())
    expect(result.conversation).toMatchObject({
      id: 'id1',
      prKey: KEY,
      title: 'Why clamp the discount?',
      running: true,
      messageCount: 2,
    })
    expect(result.userMessage).toMatchObject({ role: 'user', status: 'done', context: [line] })
    expect(result.assistantMessage).toMatchObject({
      role: 'assistant',
      status: 'streaming',
      text: '',
      language: 'es',
    })
    // Conversation first, then its messages.
    expect(events.map((event) => event.type)).toEqual(['conversation', 'message', 'message'])

    const call = await started()
    expect(call.options.chat).toEqual({
      text: 'Why clamp the discount?',
      context: [line],
      history: [],
      commentedCode: {},
    })
    expect(call.options.language).toBe('es')
    call.finish('Because it keeps the total positive.')
    await chat.whenIdle('id1')

    const answer = db.getMessage(result.assistantMessage.id)
    expect(answer).toMatchObject({
      status: 'done',
      text: 'Because it keeps the total positive.',
      generatedWith: SEAL,
      language: 'es',
    })
    const last = events.at(-1)
    expect(last).toMatchObject({ type: 'conversation', conversation: { running: false } })
    expect(messageEvents().at(-1)?.message).toMatchObject({ status: 'done', generatedWith: SEAL })
    expect(messageEvents().at(-1)?.activity).toBeUndefined()
    expect(chat.list(repo, 482)).toEqual([
      expect.objectContaining({ id: 'id1', running: false, messageCount: 2 }),
    ])
    expect(chat.get('id1').messages.map((m) => m.role)).toEqual(['user', 'assistant'])
  })

  it('sends the code as commented that main read for the message, and goes on when it fails', async () => {
    const code = {
      commit: 'ab'.repeat(20),
      path: 'src/a.ts',
      firstLine: 1,
      lines: ['x'],
      start: 1,
      end: 1,
    }
    const reads: unknown[] = []
    let fail = false
    chat = createChatService({
      db,
      prepareRun: async () => ({ service: ai.service, generatedWith: SEAL }),
      readCommentedCode: async (...args) => {
        reads.push(args)
        if (fail) throw new Error('boom')
        return { l1: code }
      },
      currentLanguage: () => 'es',
      broadcast: (event) => events.push(event),
      newId: () => 'id' + ++ids,
    })
    chat.send(request())
    const call = await started()
    expect(reads).toEqual([[repo, 482, [line]]])
    expect(call.options.chat?.commentedCode).toEqual({ l1: code })
    call.finish('ok')
    await chat.whenIdle('id1')

    fail = true
    chat.send(request({ conversationId: 'id1' }))
    const second = await started(2)
    expect(second.options.chat?.commentedCode).toEqual({})
  })

  it('pushes each run stage once, forward only, and drops it when the answer settles', async () => {
    let report: ((stage: 'loading' | 'waiting') => void) | undefined
    chat = createChatService({
      db,
      prepareRun: async (reporter) => {
        report = reporter
        return { service: ai.service, generatedWith: SEAL }
      },
      currentLanguage: () => 'es',
      broadcast: (event) => events.push(event),
      newId: () => 'id' + ++ids,
    })
    chat.send(request())
    const call = await started()
    report?.('loading')
    report?.('waiting')
    // A provider reading the PR again mid-run does not move the stage back.
    report?.('loading')
    call.options.onProgress?.([], { done: false, phase: 'exploring' })
    call.progress('Because')
    await vi.advanceTimersByTimeAsync(100)
    const stages = messageEvents()
      .map((event) => event.stage)
      .filter((stage) => stage !== undefined)
    expect([...new Set(stages)]).toEqual(['loading', 'waiting', 'exploring', 'writing'])

    call.finish('Because it keeps the total positive.')
    await chat.whenIdle('id1')
    expect(messageEvents().at(-1)).toMatchObject({ message: { status: 'done' } })
    expect(messageEvents().at(-1)?.stage).toBeUndefined()
  })

  it('coalesces streaming to one event per interval with the full text, saved on each flush', async () => {
    const { assistantMessage } = chat.send(request())
    const call = await started()
    events = []
    const activity: AnalysisActivityItem[] = [
      { id: 'r', kind: 'read', label: 'Read a.ts', status: 'done' },
    ]
    call.progress('Be')
    call.progress('Beca', activity)
    call.progress('Becau', activity)
    call.progress('Because', activity)
    // The first one goes out at once; the rest wait for the interval.
    expect(messageEvents().map((e) => e.message.text)).toEqual(['Be'])
    expect(db.getMessage(assistantMessage.id)?.text).toBe('Be')
    await vi.advanceTimersByTimeAsync(50)
    expect(messageEvents().map((e) => e.message.text)).toEqual(['Be', 'Because'])
    expect(messageEvents()[1].activity).toEqual(activity)
    expect(messageEvents()[1].message.status).toBe('streaming')
    expect(db.getMessage(assistantMessage.id)?.text).toBe('Because')
    await vi.advanceTimersByTimeAsync(200)
    expect(messageEvents()).toHaveLength(2)

    call.finish('Because it is.')
    await chat.whenIdle('id1')
    expect(messageEvents().map((e) => e.message.text)).toEqual(['Be', 'Because', 'Because it is.'])
  })

  it('runs one answer per conversation, and rejects other PRs and unknown ids', async () => {
    const first = chat.send(request())
    expect(() => chat.send(request({ conversationId: first.conversation.id }))).toThrow(
      /still answering/,
    )
    expect(() => chat.retry(first.conversation.id)).toThrow(/still answering/)
    // Another conversation runs side by side.
    chat.send(request({ text: 'Other' }))
    expect(chat.list(repo, 482).map((c) => c.running)).toEqual([true, true])
    expect(() => chat.send(request({ number: 1, conversationId: first.conversation.id }))).toThrow(
      /no longer exists/,
    )
    expect(() => chat.send(request({ conversationId: 'nope' }))).toThrow(/no longer exists/)
    expect(() => chat.get('nope')).toThrow(/no longer exists/)
    await started(2)
  })

  it('caps the answers written at once across conversations', async () => {
    for (let i = 0; i < MAX_CONCURRENT_CHAT_RUNS; i++) chat.send(request({ text: 'Q' + i }))
    expect(() => chat.send(request({ text: 'One too many' }))).toThrow(/other conversations/)
    await started(MAX_CONCURRENT_CHAT_RUNS)
  })

  it('an empty answer fails with a message, a provider error keeps its text', async () => {
    chat.send(request())
    ;(await started()).finish('')
    await chat.whenIdle('id1')
    expect(db.getMessage('id3')).toMatchObject({
      status: 'failed',
      error: 'The AI finished without an answer to your message. Try sending it again.',
    })

    chat.send(request({ conversationId: 'id1', text: 'Again' }))
    const call = await started(2)
    call.progress('Half')
    call.fail('Claude Code did not answer in time.')
    await chat.whenIdle('id1')
    expect(db.getMessage('id5')).toMatchObject({
      status: 'failed',
      text: 'Half',
      error: 'Claude Code did not answer in time.',
    })
  })
})

describe('chat-service cancel, retry, delete', () => {
  it('cancel aborts the run and keeps the partial text', async () => {
    const { assistantMessage } = chat.send(request())
    const call = await started()
    call.progress('Partial answer')
    chat.cancel('id1')
    expect(call.options.signal?.aborted).toBe(true)
    await chat.whenIdle('id1')
    expect(db.getMessage(assistantMessage.id)).toMatchObject({
      status: 'cancelled',
      text: 'Partial answer',
    })
    expect(db.getMessage(assistantMessage.id)?.error).toBeUndefined()
    expect(chat.list(repo, 482)[0].running).toBe(false)
    // Cancelling with nothing running is a no-op.
    chat.cancel('id1')
  })

  it('a cancel wins even if the provider then resolves', async () => {
    ai.state.ignoreAbort = true
    chat.send(request())
    const call = await started()
    chat.cancel('id1')
    call.finish('Too late')
    await chat.whenIdle('id1')
    expect(db.getMessage('id3')?.status).toBe('cancelled')
  })

  it('retry reruns the last question in the same answer message', async () => {
    const { assistantMessage } = chat.send(request())
    ;(await started()).fail('boom')
    await chat.whenIdle('id1')

    events = []
    const retried = chat.retry('id1')
    expect(retried.assistantMessage).toMatchObject({
      id: assistantMessage.id,
      status: 'streaming',
      text: '',
    })
    expect(retried.userMessage.text).toBe('Why clamp the discount?')
    expect(events.map((e) => e.type)).toEqual(['conversation', 'message'])
    expect(db.getMessage(assistantMessage.id)?.error).toBeUndefined()

    const call = await started(2)
    expect(call.options.chat?.text).toBe('Why clamp the discount?')
    expect(call.options.chat?.context).toEqual([line])
    call.finish('Second try.')
    await chat.whenIdle('id1')
    expect(db.getMessage(assistantMessage.id)).toMatchObject({
      status: 'done',
      text: 'Second try.',
    })
    expect(chat.get('id1').messages).toHaveLength(2)
    // Nothing to retry once the last answer is done.
    expect(() => chat.retry('id1')).toThrow(/no failed or stopped answer/)
  })

  it('delete cancels the run, drops the rows and pushes `deleted`', async () => {
    chat.send(request())
    const call = await started()
    events = []
    chat.delete('id1')
    expect(call.options.signal?.aborted).toBe(true)
    expect(events).toEqual([{ type: 'deleted', prKey: KEY, conversationId: 'id1' }])
    await chat.whenIdle('id1')
    // The run's end writes and pushes nothing for a deleted conversation.
    expect(events).toHaveLength(1)
    expect(db.getConversation('id1')).toBeNull()
    expect(db.getMessage('id2')).toBeNull()
    expect(chat.list(repo, 482)).toEqual([])
    // Deleting again is a no-op.
    chat.delete('id1')
    expect(events).toHaveLength(1)
  })

  it('shutdown stops runs, leaves their answers interrupted and closes the database', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'minerva-chat-'))
    try {
      const path = join(dir, 'chat.sqlite')
      const service = createChatService({
        db: openChatDb(path),
        prepareRun: async () => ({ service: ai.service, generatedWith: SEAL }),
        currentLanguage: () => 'en',
        broadcast: (event) => events.push(event),
      })
      const { assistantMessage } = service.send(request())
      const call = await started()
      call.progress('Half')
      events = []
      service.shutdown()
      expect(call.options.signal?.aborted).toBe(true)
      await vi.advanceTimersByTimeAsync(100)
      // Nothing is pushed or written after the database closed.
      expect(events).toEqual([])
      const reopened = openChatDb(path)
      expect(reopened.getMessage(assistantMessage.id)).toMatchObject({
        status: 'interrupted',
        text: 'Half',
      })
      reopened.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('chat-service history', () => {
  it('a follow-up carries the earlier done exchanges, skipping failed ones', async () => {
    chat.send(request({ text: 'First?' }))
    ;(await started(1)).finish('First answer.')
    await chat.whenIdle('id1')
    chat.send(request({ conversationId: 'id1', text: 'Second?', context: [] }))
    ;(await started(2)).fail('boom')
    await chat.whenIdle('id1')
    chat.send(request({ conversationId: 'id1', text: 'Third?', context: [] }))
    const call = await started(3)
    expect(call.options.chat?.history).toEqual([
      { question: 'First?', contextLabel: 'src/a.ts:3 (new)', answer: 'First answer.' },
    ])
  })

  it('historyTurns pairs questions with their done answers only', () => {
    const base = {
      conversationId: 'c',
      context: [],
      createdAt: '',
      updatedAt: '',
    }
    const turns = historyTurns([
      { ...base, id: '1', role: 'user', text: 'q1', status: 'done' },
      { ...base, id: '2', role: 'assistant', text: 'a1', status: 'done' },
      { ...base, id: '3', role: 'user', text: 'q2', status: 'done' },
      { ...base, id: '4', role: 'assistant', text: 'part', status: 'interrupted' },
      { ...base, id: '5', role: 'user', text: 'q3', status: 'done' },
      { ...base, id: '6', role: 'assistant', text: '  ', status: 'done' },
    ])
    expect(turns).toEqual([{ question: 'q1', contextLabel: '', answer: 'a1' }])
  })

  it('trimChatHistory keeps the newest turns and shortens the oldest kept one', () => {
    const turn = (n: number, size: number): ChatHistoryTurn => ({
      question: 'q' + n,
      contextLabel: '',
      answer: String(n).repeat(size - 2),
    })
    const turns = [turn(1, 1000), turn(2, 1000), turn(3, 1000)]
    expect(trimChatHistory(turns, 3000)).toEqual(turns)
    const trimmed = trimChatHistory(turns, 2500)
    expect(trimmed.map((t) => t.question)).toEqual(['q1', 'q2', 'q3'])
    expect(trimmed[0].answer.endsWith('…')).toBe(true)
    const size = trimmed.reduce(
      (sum, t) => sum + t.question.length + t.contextLabel.length + t.answer.length,
      0,
    )
    expect(size).toBeLessThanOrEqual(2500)
    // Too little left for the oldest: dropped, not shortened to nothing.
    expect(trimChatHistory(turns, 2100).map((t) => t.question)).toEqual(['q2', 'q3'])
    // A single huge newest turn is shortened to the budget.
    const [only] = trimChatHistory([turn(9, 50_000)], 24_000)
    expect(only.question.length + only.answer.length).toBeLessThanOrEqual(24_000)
  })
})
