/**
 * `scm:getDashboard`: the home dashboard's data, across every enabled
 * provider (registry fan-out, `Promise.allSettled`).
 *
 * Per provider, the union of:
 * 1. the scope's open PRs (`listScopePullRequests`, read through the scope
 *    cache shared with the stacks view, so the cold fetch is paid once);
 * 2. the open PRs that involve the user (`listPullRequests({ state: 'open' })`),
 *    which may live outside the scope (GitHub: repos past `MAX_STACK_REPOS`).
 * Deduplicated by `prKey`. When both have a PR, the involved-list record wins
 * (Azure derives its `updatedAt` from the last push only there) and missing
 * `labels` / `reviewers` / `viewer` are filled from the scope record.
 *
 * A provider whose two listings both fail lands in `errors` (same
 * `ScmListError` shape as `scm:getStacks`); when only one fails, its PRs from
 * the other still show and the failure is reported too. `unread` is NOT set
 * here: the IPC handler decorates it from `seen-store`, like
 * `scm:listPullRequests`.
 *
 * Cached briefly (`ttlMs`, 60 s). `refresh: true` is single-flight and served
 * from the cache when the last result is younger than `minRefreshMs` (10 s),
 * like `./stacks-service.ts`. `invalidate()` drops it and the scope cache.
 */
import { prKey, type ScmProviderId } from '../../shared/scm'
import type { DashboardResult, PullRequestSummary, ScmListError } from '../../shared/types'
import { toScmError } from './errors'
import type { ScmProvider } from './provider'
import type { ScmRegistry } from './registry'
import { createScopeCache, type ScopeCache } from './scope-cache'

export interface DashboardServiceOptions {
  /** Scope listing cache; pass the one shared with the stacks service. Default: a private one. */
  scope?: ScopeCache
  ttlMs?: number
  minRefreshMs?: number
  now?: () => number
}

export interface DashboardService {
  get(options?: { refresh?: boolean }): Promise<DashboardResult>
  invalidate(): void
}

const DEFAULT_TTL_MS = 60_000
const DEFAULT_MIN_REFRESH_MS = 10_000

/** The involved-list record, completed with what only the scope record knows. */
function mergeRecords(scope: PullRequestSummary, involved: PullRequestSummary): PullRequestSummary {
  const merged: PullRequestSummary = { ...scope, ...involved }
  const labels = involved.labels ?? scope.labels
  const reviewers = involved.reviewers ?? scope.reviewers
  const viewer = involved.viewer ?? scope.viewer
  if (labels) merged.labels = labels
  if (reviewers) merged.reviewers = reviewers
  if (viewer) merged.viewer = viewer
  return merged
}

/**
 * Union of one provider's scope and involved lists, open PRs only, keyed by
 * `prKey` (exported for tests).
 */
export function mergeDashboardLists(
  scope: readonly PullRequestSummary[],
  involved: readonly PullRequestSummary[],
): PullRequestSummary[] {
  const byKey = new Map<string, PullRequestSummary>()
  for (const pr of scope) {
    if (pr.state === 'open') byKey.set(prKey(pr.repo, pr.number), pr)
  }
  for (const pr of involved) {
    if (pr.state !== 'open') continue
    const key = prKey(pr.repo, pr.number)
    const existing = byKey.get(key)
    byKey.set(key, existing ? mergeRecords(existing, pr) : pr)
  }
  return [...byKey.values()]
}

interface ProviderOutcome {
  items: PullRequestSummary[]
  error: ScmListError | null
}

async function dashboardForProvider(
  provider: ScmProvider,
  scope: ScopeCache,
  refresh: boolean,
): Promise<ProviderOutcome> {
  const [scoped, involved] = await Promise.allSettled([
    scope.get(provider, { refresh }),
    provider.listPullRequests({ state: 'open' }),
  ])
  const failure =
    scoped.status === 'rejected' ? scoped : involved.status === 'rejected' ? involved : null
  let error: ScmListError | null = null
  if (failure) {
    const scmError = toScmError(failure.reason)
    error = { provider: provider.id, code: scmError.code, message: scmError.message }
  }
  if (scoped.status === 'rejected' && involved.status === 'rejected') {
    return { items: [], error }
  }
  const items = mergeDashboardLists(
    scoped.status === 'fulfilled' ? scoped.value.map((item) => item.summary) : [],
    involved.status === 'fulfilled' ? involved.value : [],
  )
  return { items, error }
}

/** Newest activity first; ties by provider order, then number (stable output). */
function byActivity(order: Map<ScmProviderId, number>) {
  return (a: PullRequestSummary, b: PullRequestSummary): number =>
    b.updatedAt.localeCompare(a.updatedAt) ||
    (order.get(a.repo.provider) ?? 0) - (order.get(b.repo.provider) ?? 0) ||
    a.repo.fullName.localeCompare(b.repo.fullName) ||
    b.number - a.number
}

export function createDashboardService(
  registry: ScmRegistry,
  options: DashboardServiceOptions = {},
): DashboardService {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
  const minRefreshMs = options.minRefreshMs ?? DEFAULT_MIN_REFRESH_MS
  const now = options.now ?? Date.now
  const scope = options.scope ?? createScopeCache({ ttlMs, minRefreshMs, now })
  let cached: { at: number; result: DashboardResult } | null = null
  let inFlight: Promise<DashboardResult> | null = null
  let generation = 0

  const compute = async (refresh: boolean): Promise<DashboardResult> => {
    const providers = registry.enabled()
    const order = new Map(providers.map((provider, index) => [provider.id, index]))
    const settled = await Promise.allSettled(
      providers.map((provider) => dashboardForProvider(provider, scope, refresh)),
    )
    const pullRequests: PullRequestSummary[] = []
    const errors: ScmListError[] = []
    settled.forEach((outcome, index) => {
      if (outcome.status === 'fulfilled') {
        pullRequests.push(...outcome.value.items)
        if (outcome.value.error) errors.push(outcome.value.error)
      } else {
        const error = toScmError(outcome.reason)
        errors.push({ provider: providers[index].id, code: error.code, message: error.message })
      }
    })
    pullRequests.sort(byActivity(order))
    return { pullRequests, errors, fetchedAt: new Date(now()).toISOString() }
  }

  return {
    get(opts = {}) {
      const maxAge = opts.refresh ? minRefreshMs : ttlMs
      if (cached && now() - cached.at < maxAge) return Promise.resolve(cached.result)
      // Refresh or not, join the computation in flight (invalidate() drops it).
      if (inFlight) return inFlight
      const started = generation
      const promise = compute(opts.refresh === true)
        .then((result) => {
          // An invalidate() while computing means the result may predate a retarget.
          if (generation === started) cached = { at: now(), result }
          return result
        })
        .finally(() => {
          if (inFlight === promise) inFlight = null
        })
      inFlight = promise
      return promise
    },
    invalidate() {
      generation++
      cached = null
      inFlight = null
      scope.invalidate()
    },
  }
}
