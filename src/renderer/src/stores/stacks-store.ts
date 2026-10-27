/**
 * Shared cache of `scm:getStacks` for the renderer: the Stacks view and the
 * stack map in the PR header read the SAME result, so opening a PR never
 * triggers a second cold fetch (~10 s on a real org).
 *
 * Stale-while-revalidate: a reload keeps the previous `result` on screen and
 * only flips `loading`. One request at a time (`inFlight`); a forced refresh
 * (`{ refresh: true }`, skips main's 60 s cache) is throttled here too,
 * because main rate-limits it — inside the window it falls back to a normal
 * read, which main answers from its cache.
 */
import { create } from 'zustand'
import type { GetStacksResult, PullRequestSummary } from '../../../shared/types'
import type { RetargetFailure } from '../lib/retarget'

/**
 * Outcome of the last retarget that changed (or found changed) the data. It
 * lives here, not in the panel that started it, because the refresh that
 * follows usually unmounts that panel (a fixed orphan leaves the stacks).
 */
export type RetargetNote =
  | { kind: 'retargeted'; pr: PullRequestSummary; oldBase: string }
  | { kind: 'conflict'; prKey: string; number: number; failure: RetargetFailure }

/** Older than this, a consumer mounting triggers a background reload. Matches main's cache. */
export const STACKS_STALE_MS = 60_000
/** Minimum time between two forced refreshes. */
export const STACKS_FORCED_REFRESH_MIN_MS = 10_000

interface StacksState {
  result: GetStacksResult | null
  loading: boolean
  /** The whole call failed (IPC/main). Per-provider failures are in `result.errors`. */
  error: string | null
  /** `Date.now()` of the last successful answer. */
  fetchedAt: number | null
  /** Auth signature the result was fetched under; a different one means "reload". */
  authKey: string | null
  /** `scmDataVersion` (app store) the result was fetched under; bumped by a retarget. */
  dataVersion: number
  lastRetarget: RetargetNote | null
  load: (options?: { refresh?: boolean; authKey?: string; dataVersion?: number }) => Promise<void>
  noteRetarget: (note: RetargetNote) => void
  dismissRetargetNote: () => void
}

let inFlight: Promise<void> | null = null
/** `dataVersion` the running request was started for. */
let inFlightVersion = 0
let lastForcedAt = 0

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export const useStacksStore = create<StacksState>((set, get) => ({
  result: null,
  loading: false,
  error: null,
  fetchedAt: null,
  authKey: null,
  dataVersion: 0,
  lastRetarget: null,

  noteRetarget: (note) => set({ lastRetarget: note }),
  dismissRetargetNote: () => set({ lastRetarget: null }),

  load: (options = {}) => {
    const now = Date.now()
    let refresh = options.refresh === true
    if (refresh && now - lastForcedAt < STACKS_FORCED_REFRESH_MIN_MS) refresh = false
    const authKey = options.authKey ?? get().authKey
    const dataVersion = options.dataVersion ?? get().dataVersion
    // A plain read joins the request already running, unless that one started
    // before a retarget (older `dataVersion`); a forced one waits for it and
    // then asks again.
    if (inFlight && !refresh && inFlightVersion >= dataVersion) return inFlight
    if (refresh) lastForcedAt = now

    const previous = inFlight ?? Promise.resolve()
    const run = previous.then(async () => {
      set({ loading: true, error: null })
      try {
        const result = await window.minerva.scm.getStacks(refresh ? { refresh: true } : undefined)
        set({ result, fetchedAt: Date.now(), authKey, dataVersion, loading: false })
      } catch (error: unknown) {
        set({ error: toErrorMessage(error), loading: false })
      }
    })
    const tracked = run.finally(() => {
      if (inFlight === tracked) inFlight = null
    })
    inFlight = tracked
    inFlightVersion = dataVersion
    return tracked
  },
}))
