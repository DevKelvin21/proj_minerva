/**
 * The activity inbox in the renderer: main's state (`activity:get`) kept
 * current by the `activityChanged` push. One subscription for the window's
 * lifetime (`start`, idempotent), shared by the sidebar's Inbox view, its tab
 * badge and the collapsed rail.
 *
 * Two errors, kept apart so each says what failed and can be retried: the
 * first load (`loadError`, cleared by any later state) and the last failed
 * mark-read (`markError`, which keeps its request for Retry).
 *
 * "Done" is optimistic: `dismiss` hides the items here at once (`hiddenIds`)
 * and offers Undo (`pendingDismiss`) for `DISMISS_UNDO_MS`; only then does
 * `activity:dismiss` reach main. A second Done, or the page going away,
 * sends the pending one right away. A failed dismiss shows the items again
 * and keeps its ids for Retry (`dismissError`).
 */
import { create } from 'zustand'
import type { ActivityState, MarkActivityReadRequest } from '../../../shared/activity'
import { errorText } from '../lib/error-text'

export interface ActivityMarkError {
  message: string
  request: MarkActivityReadRequest
}

/** How long the Undo of a "Done" is offered before main is told. */
export const DISMISS_UNDO_MS = 5000

/** What the Undo toast says was removed (the component words it). */
export type DismissNotice =
  | { kind: 'item' }
  | { kind: 'group'; number: number; count: number }
  | { kind: 'read'; count: number }

export interface PendingDismiss {
  ids: string[]
  notice: DismissNotice
}

export interface ActivityDismissError {
  message: string
  ids: string[]
}

interface ActivityInboxState {
  /** `null` until the first answer. */
  state: ActivityState | null
  loadError: string | null
  markError: ActivityMarkError | null
  start: () => void
  /** Asks main for the state again (Retry after a failed first load). */
  load: () => Promise<void>
  markRead: (req: MarkActivityReadRequest) => Promise<void>
  /** Runs the failed mark-read again. */
  retryMarkRead: () => Promise<void>
  /** Items hidden by a "Done" that main has not confirmed yet (pending or in flight). */
  hiddenIds: ReadonlySet<string>
  /** The "Done" that can still be undone (its toast). */
  pendingDismiss: PendingDismiss | null
  dismissError: ActivityDismissError | null
  /** Hides `ids` now; main hears about it once the Undo window is over. */
  dismiss: (ids: string[], notice: DismissNotice) => void
  /** Brings the pending items back; answers their ids (empty when nothing was pending). */
  undoDismiss: () => string[]
  /** Pauses the Undo window (pointer or focus on the toast) or restarts it. */
  holdDismiss: (hold: boolean) => void
  /** Sends the pending "Done" to main now. */
  flushDismiss: () => void
  retryDismiss: () => Promise<void>
}

let started = false
let dismissTimer: ReturnType<typeof setTimeout> | null = null

function clearDismissTimer(): void {
  if (dismissTimer !== null) clearTimeout(dismissTimer)
  dismissTimer = null
}

function without(set: ReadonlySet<string>, ids: readonly string[]): ReadonlySet<string> {
  const next = new Set(set)
  for (const id of ids) next.delete(id)
  return next
}

export const useActivityInboxStore = create<ActivityInboxState>((set, get) => ({
  state: null,
  loadError: null,
  markError: null,
  start: () => {
    if (started) return
    started = true
    window.minerva.events.onActivityChanged(({ state }) => set({ state, loadError: null }))
    // A reload or a closed window does not undo a "Done" the user saw happen.
    window.addEventListener('pagehide', () => get().flushDismiss())
    void get().load()
  },
  load: async () => {
    set({ loadError: null })
    try {
      const state = await window.minerva.activity.get()
      // A push may have landed while this was in flight: it is newer.
      set((current) => (current.state ? {} : { state }))
    } catch (error: unknown) {
      set((current) => (current.state ? {} : { loadError: errorText(error) }))
    }
  },
  markRead: async (request) => {
    try {
      set({ state: await window.minerva.activity.markRead(request), markError: null })
    } catch (error: unknown) {
      set({ markError: { message: errorText(error), request } })
    }
  },
  retryMarkRead: async () => {
    const failed = get().markError
    if (failed) await get().markRead(failed.request)
  },
  hiddenIds: new Set(),
  pendingDismiss: null,
  dismissError: null,
  dismiss: (ids, notice) => {
    if (ids.length === 0) return
    get().flushDismiss()
    set((current) => ({
      hiddenIds: new Set([...current.hiddenIds, ...ids]),
      pendingDismiss: { ids, notice },
      dismissError: null,
    }))
    dismissTimer = setTimeout(() => get().flushDismiss(), DISMISS_UNDO_MS)
  },
  undoDismiss: () => {
    const pending = get().pendingDismiss
    if (!pending) return []
    clearDismissTimer()
    set((current) => ({
      hiddenIds: without(current.hiddenIds, pending.ids),
      pendingDismiss: null,
    }))
    return pending.ids
  },
  holdDismiss: (hold) => {
    if (!get().pendingDismiss) return
    clearDismissTimer()
    if (!hold) dismissTimer = setTimeout(() => get().flushDismiss(), DISMISS_UNDO_MS)
  },
  flushDismiss: () => {
    const pending = get().pendingDismiss
    if (!pending) return
    clearDismissTimer()
    set({ pendingDismiss: null })
    void sendDismiss(pending.ids)
  },
  retryDismiss: async () => {
    const failed = get().dismissError
    if (!failed) return
    set((current) => ({
      hiddenIds: new Set([...current.hiddenIds, ...failed.ids]),
      dismissError: null,
    }))
    await sendDismiss(failed.ids)
  },
}))

/** Tells main; the items stay hidden until it answers (gone) or fails (shown again). */
async function sendDismiss(ids: string[]): Promise<void> {
  const set = useActivityInboxStore.setState
  try {
    const state = await window.minerva.activity.dismiss({ ids })
    set((current) => ({ state, hiddenIds: without(current.hiddenIds, ids) }))
  } catch (error: unknown) {
    set((current) => ({
      hiddenIds: without(current.hiddenIds, ids),
      dismissError: { message: errorText(error), ids },
    }))
  }
}
