/**
 * Shared cache of `scm:getDashboard` for the renderer (home overview, repo
 * pages, feature pages and the review view's stack navigator all read the
 * SAME answer), modeled on `stacks-store.ts`:
 *
 * Stale-while-revalidate: a reload keeps the previous `result` on screen and
 * only flips `loading`. One request at a time (`inFlight`); a forced refresh
 * (`{ refresh: true }`, skips main's cache) is throttled here too, because
 * main rate-limits it — inside the window it falls back to a normal read.
 *
 * Account switch while a request is running: a plain read only JOINS the
 * running request when it was started for the same auth signature and a
 * data version at least as new; otherwise it queues a fresh read behind it.
 * A result whose auth signature / data version is no longer the latest one
 * asked for is discarded (never shown under the newer identity).
 *
 * The custom feature names and the hidden feature groups live here as well,
 * persisted in `localStorage` and validated on read (`parseFeatureNames`,
 * `parseHiddenFeatures`): the stored text is untrusted. Names are kept in a
 * prototype-less map so a label named `constructor` is plain data.
 */
import { create } from 'zustand'
import { prKey } from '../../../shared/scm'
import type { DashboardResult, PullRequestSummary } from '../../../shared/types'
import { errorText } from '../lib/error-text'
import {
  cloneFeatureNames,
  HIDDEN_FEATURES_MAX,
  isFeatureKey,
  normalizeFeatureName,
  parseFeatureNames,
  parseHiddenFeatures,
  type FeatureNames,
} from '../lib/dashboard'

/** Older than this, a consumer mounting triggers a background reload. Matches main's cache. */
export const DASHBOARD_STALE_MS = 60_000
/** Minimum time between two forced refreshes. */
export const DASHBOARD_FORCED_REFRESH_MIN_MS = 10_000

const FEATURE_NAMES_KEY = 'minerva.featureNames'
const HIDDEN_FEATURES_KEY = 'minerva.hiddenFeatures'

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // Session-only when storage is unavailable.
  }
}

interface DashboardState {
  result: DashboardResult | null
  loading: boolean
  /** The whole call failed (IPC/main). Per-provider failures are in `result.errors`. */
  error: string | null
  /** `Date.now()` of the last successful answer. */
  fetchedAt: number | null
  /** Auth signature the result was fetched under; a different one means "reload". */
  authKey: string | null
  /** `scmDataVersion` (app store) the result was fetched under; bumped by a retarget. */
  dataVersion: number
  /** `featureKey` -> custom display name (prototype-less). */
  featureNames: FeatureNames
  /** `featureKey`s the user hid from the overview. */
  hiddenFeatures: readonly string[]
  load: (options?: { refresh?: boolean; authKey?: string; dataVersion?: number }) => Promise<void>
  /** Clears the unread flags of one PR locally (the seen-store in main is told by the opener). */
  markSeenLocally: (pr: PullRequestSummary) => void
  /** Sets (or, with `null`/blank, removes) the custom name of a feature group. */
  setFeatureName: (key: string, name: string | null) => void
  setFeatureHidden: (key: string, hidden: boolean) => void
}

let inFlight: Promise<void> | null = null
/** Auth signature / `dataVersion` the running request was started for. */
let inFlightAuthKey: string | null = null
let inFlightVersion = 0
/** The newest auth signature / `dataVersion` any caller asked for: older answers are discarded. */
let latestAuthKey: string | null = null
let latestVersion = 0
let lastForcedAt = 0

export const useDashboardStore = create<DashboardState>((set, get) => ({
  result: null,
  loading: false,
  error: null,
  fetchedAt: null,
  authKey: null,
  dataVersion: 0,
  featureNames: parseFeatureNames(readStorage(FEATURE_NAMES_KEY)),
  hiddenFeatures: parseHiddenFeatures(readStorage(HIDDEN_FEATURES_KEY)),

  load: (options = {}) => {
    const now = Date.now()
    let refresh = options.refresh === true
    if (refresh && now - lastForcedAt < DASHBOARD_FORCED_REFRESH_MIN_MS) refresh = false
    const authKey = options.authKey ?? get().authKey
    const dataVersion = Math.max(options.dataVersion ?? get().dataVersion, 0)
    latestAuthKey = authKey
    latestVersion = Math.max(latestVersion, dataVersion)
    const isStale = (): boolean => authKey !== latestAuthKey || dataVersion < latestVersion

    // A plain read joins the request already running only when that one was
    // started for the same identity and a data version at least as new;
    // a forced one (or a different identity / a retarget) waits for it and
    // then asks again.
    const joinable =
      inFlight !== null && !refresh && inFlightAuthKey === authKey && inFlightVersion >= dataVersion
    if (joinable) return inFlight!
    if (refresh) lastForcedAt = now

    const previous = inFlight ?? Promise.resolve()
    const run = previous.then(async () => {
      if (isStale()) return
      set({ loading: true, error: null })
      try {
        const result = await window.minerva.scm.getDashboard(refresh ? { refresh: true } : undefined)
        if (isStale()) return
        set({ result, fetchedAt: Date.now(), authKey, dataVersion, loading: false })
      } catch (error: unknown) {
        if (isStale()) return
        set({ error: errorText(error), loading: false })
      }
    })
    const tracked = run.finally(() => {
      if (inFlight === tracked) {
        inFlight = null
        inFlightAuthKey = null
      }
    })
    inFlight = tracked
    inFlightAuthKey = authKey
    inFlightVersion = dataVersion
    return tracked
  },

  markSeenLocally: (pr) =>
    set((state) => {
      if (!state.result) return {}
      const key = prKey(pr.repo, pr.number)
      const seen = { isNew: false, hasUpdates: false, hasNewComments: false }
      return {
        result: {
          ...state.result,
          pullRequests: state.result.pullRequests.map((item) =>
            prKey(item.repo, item.number) === key ? { ...item, unread: seen } : item,
          ),
        },
      }
    }),

  setFeatureName: (key, name) =>
    set((state) => {
      if (!isFeatureKey(key)) return {}
      const next = cloneFeatureNames(state.featureNames)
      const normalized = name === null ? null : normalizeFeatureName(name)
      if (normalized === null) delete next[key]
      else next[key] = normalized
      writeStorage(FEATURE_NAMES_KEY, JSON.stringify(next))
      return { featureNames: next }
    }),

  setFeatureHidden: (key, hidden) =>
    set((state) => {
      if (!isFeatureKey(key)) return {}
      const without = state.hiddenFeatures.filter((item) => item !== key)
      const next = hidden ? [...without, key].slice(-HIDDEN_FEATURES_MAX) : without
      writeStorage(HIDDEN_FEATURES_KEY, JSON.stringify(next))
      return { hiddenFeatures: next }
    }),
}))
