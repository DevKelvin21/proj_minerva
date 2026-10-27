import { beforeEach, describe, expect, it } from 'vitest'
import type { AskHistoryTurn, LineAnswer } from '../../../shared/types'
import { askKey, useAskAiStore, type AskSubject } from './ask-ai-store'

const line: AskSubject = { kind: 'line', pr: 'gh:o/r#1', path: 'src/a.ts', side: 'RIGHT', line: 4 }
const thread: AskSubject = { kind: 'thread', pr: 'gh:o/r#1', threadId: 't1' }

function answer(markdown: string): LineAnswer {
  return {
    markdown,
    language: 'en',
    generatedWith: { provider: 'opencode', model: 'opencode/big-pickle', options: {} },
  }
}

function deferred(): {
  promise: Promise<LineAnswer>
  resolve: (a: LineAnswer) => void
  reject: (e: unknown) => void
} {
  let resolve!: (a: LineAnswer) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<LineAnswer>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const conversation = (subject: AskSubject) =>
  useAskAiStore.getState().conversations.get(askKey(subject))

describe('ask-ai-store', () => {
  beforeEach(() => useAskAiStore.setState({ conversations: new Map() }))

  it('keeps every exchange and sends the earlier ones with a follow-up', async () => {
    const seen: AskHistoryTurn[][] = []
    const run = async (question: string, history: AskHistoryTurn[]): Promise<LineAnswer> => {
      seen.push(history)
      return answer('A to ' + question)
    }
    await useAskAiStore.getState().ask(line, 'first?', run)
    await useAskAiStore.getState().ask(line, 'second?', run)
    expect(conversation(line)?.turns.map((t) => t.question)).toEqual(['first?', 'second?'])
    expect(seen).toEqual([[], [{ question: 'first?', answer: 'A to first?' }]])
    // Conversations are per subject.
    expect(conversation(thread)).toBeUndefined()
  })

  it('shows the pending question, and one question at a time', async () => {
    const d = deferred()
    const done = useAskAiStore.getState().ask(thread, 'why?', () => d.promise)
    expect(conversation(thread)?.pending).toBe('why?')
    await useAskAiStore.getState().ask(thread, 'again?', async () => answer('never'))
    d.resolve(answer('because'))
    await done
    expect(conversation(thread)?.pending).toBeNull()
    expect(conversation(thread)?.turns.map((t) => t.answer.markdown)).toEqual(['because'])
  })

  it('a failure keeps the question until it is dismissed or asked again', async () => {
    await useAskAiStore.getState().ask(line, 'why?', async () => {
      throw new Error('[SCM:NETWORK] offline')
    })
    expect(conversation(line)?.failed).toEqual({ question: 'why?', message: 'offline' })
    useAskAiStore.getState().dismissFailure(line)
    expect(conversation(line)?.failed).toBeNull()
  })

  it('clear empties the conversation and drops an answer asked before it', async () => {
    await useAskAiStore.getState().ask(line, 'first?', async () => answer('one'))
    useAskAiStore.getState().clear(line)
    expect(conversation(line)?.turns).toEqual([])

    const d = deferred()
    const done = useAskAiStore.getState().ask(line, 'late?', () => d.promise)
    useAskAiStore.getState().clear(line)
    d.resolve(answer('too late'))
    await done
    expect(conversation(line)?.turns).toEqual([])
  })
})
