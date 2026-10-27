import { useCallback, useEffect } from 'react'
import type { PrStack } from '../../../shared/scm'
import type { ScmListError } from '../../../shared/types'
import { useAppStore } from '../stores/app-store'
import { STACKS_STALE_MS, useStacksStore } from '../stores/stacks-store'

interface UseStacksResult {
  /** `null` until the first answer. */
  stacks: PrStack[] | null
  /** Providers that failed this time; the others' stacks are still listed. */
  providerErrors: ScmListError[]
  loading: boolean
  /** The whole call failed (IPC/main), not a single provider. */
  error: string | null
  /** Forced refresh (skips main's cache; throttled, see `stacks-store.ts`). */
  refresh: () => void
}

/** Opaque signature of every provider's auth state (same idea as the Sidebar's list refetch). */
function authSignature(scmAuth: ReturnType<typeof useAppStore.getState>['scmAuth']): string {
  return scmAuth
    ? Object.values(scmAuth)
        .map((status) => status.provider + ':' + status.state + ':' + (status.user?.login ?? ''))
        .join(',')
    : ''
}

/**
 * Stacked PRs of every enabled provider (`scm:getStacks`), from the shared
 * cache in `stacks-store.ts`. Mounting reloads in the background when the
 * cache is missing, older than `STACKS_STALE_MS`, fetched under another auth
 * state, or when a retarget bumped `scmDataVersion`. The PR watcher's
 * `prListChanged` also triggers a (non-forced) reload.
 */
export function useStacks(): UseStacksResult {
  const result = useStacksStore((s) => s.result)
  const loading = useStacksStore((s) => s.loading)
  const error = useStacksStore((s) => s.error)
  const load = useStacksStore((s) => s.load)
  const authKey = useAppStore((s) => authSignature(s.scmAuth))
  const version = useAppStore((s) => s.scmDataVersion)

  useEffect(() => {
    const state = useStacksStore.getState()
    const stale =
      state.fetchedAt === null ||
      Date.now() - state.fetchedAt > STACKS_STALE_MS ||
      state.authKey !== authKey ||
      state.dataVersion !== version
    if (stale) void load({ authKey, dataVersion: version })
  }, [authKey, version, load])

  useEffect(() => {
    return window.minerva.events.onPrListChanged(() => {
      void useStacksStore.getState().load()
    })
  }, [])

  const refresh = useCallback(() => {
    void load({ refresh: true, authKey, dataVersion: version })
  }, [load, authKey, version])

  return {
    stacks: result?.stacks ?? null,
    providerErrors: result?.errors ?? [],
    loading,
    error,
    refresh,
  }
}
