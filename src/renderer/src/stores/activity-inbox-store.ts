/**
 * The activity inbox in the renderer: main's state (`activity:get`) kept
 * current by the `activityChanged` push. One subscription for the window's
 * lifetime (`start`, idempotent), shared by the sidebar's Inbox view, its tab
 * badge and the collapsed rail.
 *
 * Two errors, kept apart so each says what failed and can be retried: the
 * first load (`loadError`, cleared by any later state) and the last failed
 * mark-read (`markError`, which keeps its request for Retry).
 */
import { create } from 'zustand'
import type { ActivityState, MarkActivityReadRequest } from '../../../shared/activity'
import { errorText } from '../lib/error-text'

export interface ActivityMarkError {
  message: string
  request: MarkActivityReadRequest
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
}

let started = false

export const useActivityInboxStore = create<ActivityInboxState>((set, get) => ({
  state: null,
  loadError: null,
  markError: null,
  start: () => {
    if (started) return
    started = true
    window.minerva.events.onActivityChanged(({ state }) => set({ state, loadError: null }))
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
}))
