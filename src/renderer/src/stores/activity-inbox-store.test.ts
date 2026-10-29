import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ActivityState,
  DismissActivityRequest,
  MarkActivityReadRequest,
} from '../../../shared/activity'

const get = vi.fn<() => Promise<ActivityState>>()
const markRead = vi.fn<(req: MarkActivityReadRequest) => Promise<ActivityState>>()
const dismiss = vi.fn<(req: DismissActivityRequest) => Promise<ActivityState>>()
let push: ((event: { state: ActivityState }) => void) | null = null
let pagehide: (() => void) | null = null

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
      activity: { get, markRead, dismiss },
      events: {
        onActivityChanged: (cb: (event: { state: ActivityState }) => void) => {
          push = cb
          return () => {}
        },
      },
    },
    addEventListener: (type: string, cb: () => void) => {
      if (type === 'pagehide') pagehide = cb
    },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  get.mockReset()
  markRead.mockReset()
  dismiss.mockReset()
  pagehide = null
  vi.useRealTimers()
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

  describe('Done', () => {
    async function started() {
      get.mockResolvedValueOnce(ONE_UNREAD)
      const store = await loadStore()
      store.getState().start()
      await vi.waitFor(() => expect(store.getState().state).toEqual(ONE_UNREAD))
      vi.useFakeTimers()
      return store
    }

    it('hides at once and tells main only after the Undo window', async () => {
      const store = await started()
      dismiss.mockResolvedValueOnce(EMPTY)
      store.getState().dismiss(['a', 'b'], { kind: 'group', number: 7, count: 2 })
      expect([...store.getState().hiddenIds]).toEqual(['a', 'b'])
      expect(store.getState().pendingDismiss?.notice).toEqual({ kind: 'group', number: 7, count: 2 })
      await vi.advanceTimersByTimeAsync(4999)
      expect(dismiss).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      expect(dismiss).toHaveBeenCalledWith({ ids: ['a', 'b'] })
      expect(store.getState().pendingDismiss).toBeNull()
      expect(store.getState().hiddenIds.size).toBe(0)
      expect(store.getState().state).toEqual(EMPTY)
    })

    it('Undo brings the items back and main never hears of it', async () => {
      const store = await started()
      store.getState().dismiss(['a'], { kind: 'item' })
      expect(store.getState().undoDismiss()).toEqual(['a'])
      expect(store.getState().hiddenIds.size).toBe(0)
      await vi.advanceTimersByTimeAsync(10_000)
      expect(dismiss).not.toHaveBeenCalled()
      expect(store.getState().undoDismiss()).toEqual([])
    })

    it('holding the toast pauses the window; letting go restarts it', async () => {
      const store = await started()
      dismiss.mockResolvedValue(EMPTY)
      store.getState().dismiss(['a'], { kind: 'item' })
      store.getState().holdDismiss(true)
      await vi.advanceTimersByTimeAsync(20_000)
      expect(dismiss).not.toHaveBeenCalled()
      store.getState().holdDismiss(false)
      await vi.advanceTimersByTimeAsync(5000)
      expect(dismiss).toHaveBeenCalledTimes(1)
    })

    it('a second Done (or the page going away) sends the pending one right away', async () => {
      const store = await started()
      dismiss.mockResolvedValue(EMPTY)
      store.getState().dismiss(['a'], { kind: 'item' })
      store.getState().dismiss(['b'], { kind: 'item' })
      expect(dismiss).toHaveBeenCalledWith({ ids: ['a'] })
      expect(store.getState().pendingDismiss?.ids).toEqual(['b'])
      pagehide?.()
      expect(dismiss).toHaveBeenLastCalledWith({ ids: ['b'] })
      expect(store.getState().pendingDismiss).toBeNull()
    })

    it('a failed dismiss shows the items again, and Retry hides and sends them again', async () => {
      const store = await started()
      dismiss.mockRejectedValueOnce(new Error('disk full'))
      store.getState().dismiss(['a'], { kind: 'item' })
      store.getState().flushDismiss()
      await vi.waitFor(() =>
        expect(store.getState().dismissError).toEqual({ message: 'disk full', ids: ['a'] }),
      )
      expect(store.getState().hiddenIds.size).toBe(0)

      dismiss.mockResolvedValueOnce(EMPTY)
      await store.getState().retryDismiss()
      expect(dismiss).toHaveBeenLastCalledWith({ ids: ['a'] })
      expect(store.getState().dismissError).toBeNull()
      expect(store.getState().state).toEqual(EMPTY)
    })
  })
})
