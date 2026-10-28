/**
 * The activity inbox in the renderer: main's state (`activity:get`) kept
 * current by the `activityChanged` push. One subscription for the window's
 * lifetime (`start`, idempotent), shared by the sidebar's Inbox view, its tab
 * badge and the collapsed rail.
 */
import { create } from 'zustand'
import type { ActivityState, MarkActivityReadRequest } from '../../../shared/activity'
import { errorText } from '../lib/error-text'

interface ActivityInboxState {
  /** `null` until the first answer. */
  state: ActivityState | null
  error: string | null
  start: () => void
  markRead: (req: MarkActivityReadRequest) => Promise<void>
}

let started = false

export const useActivityInboxStore = create<ActivityInboxState>((set) => ({
  state: null,
  error: null,
  start: () => {
    if (started) return
    started = true
    window.minerva.events.onActivityChanged(({ state }) => set({ state, error: null }))
    window.minerva.activity
      .get()
      .then((state) => set((current) => (current.state ? {} : { state, error: null })))
      .catch((error: unknown) => set({ error: errorText(error) }))
  },
  markRead: async (req) => {
    try {
      set({ state: await window.minerva.activity.markRead(req), error: null })
    } catch (error: unknown) {
      set({ error: errorText(error) })
    }
  },
}))
