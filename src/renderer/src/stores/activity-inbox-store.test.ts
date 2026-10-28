import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActivityState, MarkActivityReadRequest } from '../../../shared/activity'

const get = vi.fn<() => Promise<ActivityState>>()
const markRead = vi.fn<(req: MarkActivityReadRequest) => Promise<ActivityState>>()
let push: ((event: { state: ActivityState }) => void) | null = null

const EMPTY: ActivityState = { items: [], unreadCount: 0 }
const ONE_UNREAD: ActivityState = { items: [], unreadCount: 1 }

async function loadStore() {
  vi.resetModules()
  return (await import('./activity-inbox-store')).useActivityInboxStore
}

beforeEach(() => {
  push = null
  vi.stubGlobal('window', {
    minerva: {
      activity: { get, markRead },
      events: {
        onActivityChanged: (cb: (event: { state: ActivityState }) => void) => {
          push = cb
          return () => {}
        },
      },
    },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  get.mockReset()
  markRead.mockReset()
})

describe('activity inbox store', () => {
  it('keeps a failed first load apart, and Retry loads again', async () => {
    get.mockRejectedValueOnce(new Error('main is busy'))
    const store = await loadStore()
    store.getState().start()
    await vi.waitFor(() => expect(store.getState().loadError).toBe('main is busy'))
    expect(store.getState().state).toBeNull()
    expect(store.getState().markError).toBeNull()

    get.mockResolvedValueOnce(ONE_UNREAD)
    await store.getState().load()
    expect(store.getState().loadError).toBeNull()
    expect(store.getState().state).toEqual(ONE_UNREAD)
  })

  it('a push clears a load error and wins over a slower first answer', async () => {
    let answer: (state: ActivityState) => void = () => {}
    get.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)))
    const store = await loadStore()
    store.getState().start()
    push?.({ state: ONE_UNREAD })
    answer(EMPTY)
    await vi.waitFor(() => expect(get).toHaveBeenCalled())
    await Promise.resolve()
    expect(store.getState().state).toEqual(ONE_UNREAD)
  })

  it('a failed mark-read is its own error, keeps the inbox, and Retry repeats the request', async () => {
    get.mockResolvedValueOnce(ONE_UNREAD)
    const store = await loadStore()
    store.getState().start()
    await vi.waitFor(() => expect(store.getState().state).toEqual(ONE_UNREAD))

    markRead.mockRejectedValueOnce(new Error('disk full'))
    await store.getState().markRead({ ids: ['a'] })
    expect(store.getState().markError).toEqual({ message: 'disk full', request: { ids: ['a'] } })
    expect(store.getState().loadError).toBeNull()
    expect(store.getState().state).toEqual(ONE_UNREAD)

    markRead.mockResolvedValueOnce(EMPTY)
    await store.getState().retryMarkRead()
    expect(markRead).toHaveBeenLastCalledWith({ ids: ['a'] })
    expect(store.getState().markError).toBeNull()
    expect(store.getState().state).toEqual(EMPTY)
  })
})
