/**
 * Short-lived, single-flight cache of each provider's scope listing
 * (`ScmProvider.listScopePullRequests`). The stacks view (`./stacks-service.ts`)
 * and the home dashboard (`./dashboard-service.ts`) both need every open PR of
 * the scope; on a real org that cold fetch is the expensive part (Azure: every
 * active PR of every configured project; GitHub: one search per 10 repos), so
 * they share it through one instance built in `./default-scm.ts`.
 *
 * Per provider id:
 * - a fetch in flight is joined by every caller (refresh or not);
 * - a result younger than `ttlMs` (60 s, same as the services' own caches)
 *   is served as is;
 * - `refresh: true` refetches only when the result is older than
 *   `minRefreshMs` (10 s), so two views refreshing together pay once;
 * - failures are not cached (the next call retries);
 * - `invalidate()` (retarget, settings or account change) drops everything,
 *   including fetches in flight: their results are not stored.
 */
import type { ScmProviderId } from '../../shared/scm'
import type { ScmProvider, ScopePullRequest } from './provider'

export interface ScopeCacheOptions {
  ttlMs?: number
  minRefreshMs?: number
  now?: () => number
}

export type ScopeSource = Pick<ScmProvider, 'id' | 'listScopePullRequests'>

export interface ScopeCache {
  get(provider: ScopeSource, options?: { refresh?: boolean }): Promise<ScopePullRequest[]>
  invalidate(): void
}

export const DEFAULT_SCOPE_TTL_MS = 60_000
export const DEFAULT_SCOPE_MIN_REFRESH_MS = 10_000

interface Entry {
  at: number
  items: ScopePullRequest[]
}

export function createScopeCache(options: ScopeCacheOptions = {}): ScopeCache {
  const ttlMs = options.ttlMs ?? DEFAULT_SCOPE_TTL_MS
  const minRefreshMs = options.minRefreshMs ?? DEFAULT_SCOPE_MIN_REFRESH_MS
  const now = options.now ?? Date.now
  const cached = new Map<ScmProviderId, Entry>()
  const inFlight = new Map<ScmProviderId, Promise<ScopePullRequest[]>>()
  let generation = 0

  return {
    get(provider, opts = {}) {
      const maxAge = opts.refresh ? minRefreshMs : ttlMs
      const hit = cached.get(provider.id)
      if (hit && now() - hit.at < maxAge) return Promise.resolve(hit.items)
      const pending = inFlight.get(provider.id)
      if (pending) return pending
      const started = generation
      const promise = provider
        .listScopePullRequests()
        .then((items) => {
          if (generation === started) cached.set(provider.id, { at: now(), items })
          return items
        })
        .finally(() => {
          if (inFlight.get(provider.id) === promise) inFlight.delete(provider.id)
        })
      inFlight.set(provider.id, promise)
      return promise
    },
    invalidate() {
      generation++
      cached.clear()
      inFlight.clear()
    },
  }
}
