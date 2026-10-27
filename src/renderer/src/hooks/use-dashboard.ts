import { useCallback, useEffect, useMemo } from 'react'
import type { ScmAuthStatus, ScmProviderId } from '../../../shared/scm'
import type { PullRequestSummary, ScmListError } from '../../../shared/types'
import type { ViewerIdentity } from '../lib/dashboard'
import { useAppStore } from '../stores/app-store'
import { DASHBOARD_STALE_MS, useDashboardStore } from '../stores/dashboard-store'

interface UseDashboardResult {
  /** `null` until the first answer. */
  pullRequests: PullRequestSummary[] | null
  /** Providers that failed this time; the others' PRs are still listed. */
  providerErrors: ScmListError[]
  loading: boolean
  /** The whole call failed (IPC/main), not a single provider. */
  error: string | null
  /** ISO time main built the answer (may come from its short cache). */
  fetchedAt: string | null
  /** Forced refresh (skips main's cache; throttled, see `dashboard-store.ts`). */
  refresh: () => void
  /** Clears the unread flags of `pr` in the cached answer and seals it seen in main. */
  markSeen: (pr: PullRequestSummary) => void
}

/** Opaque signature of every provider's auth state (same idea as the Sidebar's list refetch). */
function authSignature(scmAuth: Record<ScmProviderId, ScmAuthStatus> | null): string {
  return scmAuth
    ? Object.values(scmAuth)
        .map((status) => status.provider + ':' + status.state + ':' + (status.user?.login ?? ''))
        .join(',')
    : ''
}

/**
 * Who the signed-in user is on each provider, for "my vote" lookups
 * (`lib/dashboard.ts`). Memoized on the logins, so a polling update of the
 * auth status with the same identity does not recompute the dashboard.
 */
export function useViewerIdentity(): ViewerIdentity {
  const github = useAppStore((s) => s.scmAuth?.github?.user?.login)
  const azure = useAppStore((s) => s.scmAuth?.azure?.user?.login)
  return useMemo(() => {
    const identity: ViewerIdentity = {}
    if (github) identity.github = github
    if (azure) identity.azure = azure
    return identity
  }, [github, azure])
}

/**
 * Home dashboard data (`scm:getDashboard`) from the shared cache in
 * `dashboard-store.ts`. Mounting reloads in the background when the cache is
 * missing, older than `DASHBOARD_STALE_MS`, fetched under another auth
 * state, or when a retarget bumped `scmDataVersion`. The PR watcher's
 * `prListChanged` also triggers a (non-forced) reload.
 */
export function useDashboard(): UseDashboardResult {
  const result = useDashboardStore((s) => s.result)
  const loading = useDashboardStore((s) => s.loading)
  const error = useDashboardStore((s) => s.error)
  const load = useDashboardStore((s) => s.load)
  const markSeenLocally = useDashboardStore((s) => s.markSeenLocally)
  const authKey = useAppStore((s) => authSignature(s.scmAuth))
  const version = useAppStore((s) => s.scmDataVersion)

  useEffect(() => {
    const state = useDashboardStore.getState()
    const stale =
      state.fetchedAt === null ||
      Date.now() - state.fetchedAt > DASHBOARD_STALE_MS ||
      state.authKey !== authKey ||
      state.dataVersion !== version
    if (stale) void load({ authKey, dataVersion: version })
  }, [authKey, version, load])

  useEffect(() => {
    return window.minerva.events.onPrListChanged(() => {
      // Tag the reload with the CURRENT auth/version (read at event time): an
      // untagged load would reuse the store's last key, which may belong to
      // the account the user just switched away from.
      const app = useAppStore.getState()
      void useDashboardStore
        .getState()
        .load({ authKey: authSignature(app.scmAuth), dataVersion: app.scmDataVersion })
    })
  }, [])

  const refresh = useCallback(() => {
    void load({ refresh: true, authKey, dataVersion: version })
  }, [load, authKey, version])

  const markSeen = useCallback(
    (pr: PullRequestSummary) => {
      markSeenLocally(pr)
      window.minerva.scm
        .markPrSeen({
          repo: pr.repo,
          number: pr.number,
          updatedAt: pr.updatedAt,
          commentCount: pr.commentCount,
        })
        .catch((err: unknown) => console.warn('Could not mark the PR as seen', err))
    },
    [markSeenLocally],
  )

  return {
    pullRequests: result?.pullRequests ?? null,
    providerErrors: result?.errors ?? [],
    loading,
    error,
    fetchedAt: result?.fetchedAt ?? null,
    refresh,
    markSeen,
  }
}
