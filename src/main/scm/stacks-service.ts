/**
 * `scm:getStacks`: stacked PRs across every enabled provider, with orphan
 * detection that does NOT depend on a capped "recent completed PRs" list.
 *
 * Per provider:
 * 1. `listScopePullRequests()`: every open PR of the provider's scope, read
 *    through the scope cache shared with the dashboard (`./scope-cache.ts`).
 * 2. Candidate roots: open PRs whose base is not another open PR's head in
 *    the same repo, and not a long-lived branch (`main`, `develop`, ...).
 * 3. For each distinct (repo, base) of those: `listMergedBySourceBranch` asks
 *    the server for merged PRs whose SOURCE is exactly that branch (Azure
 *    `searchCriteria.sourceRefName`, GitHub `head=` filter), and only when
 *    one exists, `branchExists` for the stale target.
 * 4. `buildStacks` (pure, `./stacks.ts`) does the rest.
 *
 * Lookups run with bounded concurrency and are capped (`maxLookups`, 100 per
 * provider; the result says so in `orphanLookupsCapped`); a failed lookup only
 * loses that orphan hint. One failing provider lands in `errors`, the others
 * still answer. Results are cached briefly (`ttlMs`, default 60 s) and
 * dropped by `invalidate()` after a retarget or a settings change (which also
 * drops the scope cache: the PRs themselves changed).
 *
 * `refresh: true` is single-flight (joins a computation in flight) and is
 * served from the cache when the last result is younger than
 * `minRefreshMs` (10 s), so a renderer loop can't fan out requests.
 */
import { repoKey, shortRef, type PrStack, type RepoRef } from '../../shared/scm'
import type { GetStacksResult, ScmListError } from '../../shared/types'
import { toScmError } from './errors'
import type { ScmProvider, ScopePullRequest } from './provider'
import type { ScmRegistry } from './registry'
import { createScopeCache, type ScopeCache } from './scope-cache'
import { buildStacks, isDefaultLongLivedBranch, type StackInputPr } from './stacks'

export interface StacksServiceOptions {
  /** Scope listing cache; pass the one shared with the dashboard. Default: a private one. */
  scope?: ScopeCache
  ttlMs?: number
  minRefreshMs?: number
  concurrency?: number
  maxLookups?: number
  now?: () => number
}

export interface StacksForProviderOptions {
  concurrency?: number
  /** Orphan lookups (distinct candidate base branches) per provider. */
  maxLookups?: number
  /** Called when lookups were capped. */
  onCapped?: (checked: number, total: number) => void
  /** Where the open scope PRs come from. Default: `provider.listScopePullRequests()`. */
  listScope?: () => Promise<ScopePullRequest[]>
}

export interface StacksService {
  get(options?: { refresh?: boolean }): Promise<GetStacksResult>
  invalidate(): void
}

const DEFAULT_TTL_MS = 60_000
const DEFAULT_MIN_REFRESH_MS = 10_000
const DEFAULT_CONCURRENCY = 6
export const DEFAULT_MAX_ORPHAN_LOOKUPS = 100

async function eachWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) await fn(items[next++])
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker))
}

/** The stack-detection view of a scope PR. */
export function scopeToStackInput({ summary, headIsFork }: ScopePullRequest): StackInputPr {
  const input: StackInputPr = {
    repo: summary.repo,
    number: summary.number,
    title: summary.title,
    headRef: summary.headRef,
    baseRef: summary.baseRef,
    state: summary.state,
    isDraft: summary.isDraft,
    createdAt: summary.createdAt,
  }
  if (headIsFork) input.headIsFork = true
  return input
}

/** Stacks of one provider (exported for tests). */
export async function stacksForProvider(
  provider: Pick<
    ScmProvider,
    'listScopePullRequests' | 'listMergedBySourceBranch' | 'branchExists'
  >,
  options: StacksForProviderOptions = {},
): Promise<PrStack[]> {
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY
  const maxLookups = options.maxLookups ?? DEFAULT_MAX_ORPHAN_LOOKUPS
  const scope = await (options.listScope ?? (() => provider.listScopePullRequests()))()
  const open = scope.map(scopeToStackInput).filter((pr) => pr.state === 'open')

  const openHeads = new Set(open.map((pr) => repoKey(pr.repo) + '\n' + shortRef(pr.headRef)))
  const lookups = new Map<string, { repo: RepoRef; branch: string }>()
  for (const pr of open) {
    const branch = shortRef(pr.baseRef)
    const key = repoKey(pr.repo) + '\n' + branch
    if (openHeads.has(key) || isDefaultLongLivedBranch(branch) || lookups.has(key)) continue
    lookups.set(key, { repo: pr.repo, branch })
  }

  const all = [...lookups.entries()]
  const selected = all.slice(0, maxLookups)
  if (selected.length < all.length) {
    console.warn('[stacks] orphan lookups capped:', selected.length, 'of', all.length)
    options.onCapped?.(selected.length, all.length)
  }

  const merged: StackInputPr[] = []
  const exists = new Map<string, boolean>()
  await eachWithConcurrency(selected, concurrency, async ([key, lookup]) => {
    try {
      const parents = await provider.listMergedBySourceBranch(lookup.repo, lookup.branch)
      merged.push(...parents)
      if (parents.length > 0) {
        exists.set(key, await provider.branchExists(lookup.repo, lookup.branch))
      }
    } catch (error) {
      console.warn('[stacks] orphan lookup failed:', toScmError(error).message)
    }
  })

  return buildStacks(open, merged, {
    branchExists: (repo, branch) => exists.get(repoKey(repo) + '\n' + shortRef(branch)),
  })
}

export function createStacksService(
  registry: ScmRegistry,
  options: StacksServiceOptions = {},
): StacksService {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
  const minRefreshMs = options.minRefreshMs ?? DEFAULT_MIN_REFRESH_MS
  const now = options.now ?? Date.now
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY
  const maxLookups = options.maxLookups ?? DEFAULT_MAX_ORPHAN_LOOKUPS
  const scope = options.scope ?? createScopeCache({ ttlMs, minRefreshMs, now })
  let cached: { at: number; result: GetStacksResult } | null = null
  let inFlight: Promise<GetStacksResult> | null = null
  let generation = 0

  const compute = async (refresh: boolean): Promise<GetStacksResult> => {
    const providers = registry.enabled()
    let capped: { checked: number; total: number } | null = null
    const onCapped = (checked: number, total: number): void => {
      capped = {
        checked: (capped?.checked ?? 0) + checked,
        total: (capped?.total ?? 0) + total,
      }
    }
    const settled = await Promise.allSettled(
      providers.map((provider) =>
        stacksForProvider(provider, {
          concurrency,
          maxLookups,
          onCapped,
          listScope: () => scope.get(provider, { refresh }),
        }),
      ),
    )
    const stacks: PrStack[] = []
    const errors: ScmListError[] = []
    settled.forEach((outcome, index) => {
      if (outcome.status === 'fulfilled') stacks.push(...outcome.value)
      else {
        const error = toScmError(outcome.reason)
        errors.push({ provider: providers[index].id, code: error.code, message: error.message })
      }
    })
    const result: GetStacksResult = { stacks, errors }
    if (capped) result.orphanLookupsCapped = capped
    return result
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
