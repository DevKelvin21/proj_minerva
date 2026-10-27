/**
 * `scm:getStacks`: stacked PRs across every enabled provider, with orphan
 * detection that does NOT depend on a capped "recent completed PRs" list.
 *
 * Per provider:
 * 1. `listStackCandidates()`: every open PR of the provider's scope.
 * 2. Candidate roots: open PRs whose base is not another open PR's head in
 *    the same repo, and not a long-lived branch (`main`, `develop`, ...).
 * 3. For each distinct (repo, base) of those: `listMergedBySourceBranch` asks
 *    the server for merged PRs whose SOURCE is exactly that branch (Azure
 *    `searchCriteria.sourceRefName`, GitHub `head=` filter), and only when
 *    one exists, `branchExists` for the stale target.
 * 4. `buildStacks` (pure, `./stacks.ts`) does the rest.
 *
 * Lookups run with bounded concurrency; a failed lookup only loses that
 * orphan hint. One failing provider lands in `errors`, the others still
 * answer. Results are cached briefly (`ttlMs`, default 60 s) and dropped by
 * `invalidate()` after a retarget or a settings change.
 */
import { repoKey, shortRef, type PrStack, type RepoRef } from '../../shared/scm'
import type { GetStacksResult, ScmListError } from '../../shared/types'
import { toScmError } from './errors'
import type { ScmProvider } from './provider'
import type { ScmRegistry } from './registry'
import { buildStacks, isDefaultLongLivedBranch, type StackInputPr } from './stacks'

export interface StacksServiceOptions {
  ttlMs?: number
  concurrency?: number
  now?: () => number
}

export interface StacksService {
  get(options?: { refresh?: boolean }): Promise<GetStacksResult>
  invalidate(): void
}

const DEFAULT_TTL_MS = 60_000
const DEFAULT_CONCURRENCY = 6

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

/** Stacks of one provider (exported for tests). */
export async function stacksForProvider(
  provider: Pick<ScmProvider, 'listStackCandidates' | 'listMergedBySourceBranch' | 'branchExists'>,
  concurrency = DEFAULT_CONCURRENCY,
): Promise<PrStack[]> {
  const open = (await provider.listStackCandidates()).filter((pr) => pr.state === 'open')

  const openHeads = new Set(open.map((pr) => repoKey(pr.repo) + '\n' + shortRef(pr.headRef)))
  const lookups = new Map<string, { repo: RepoRef; branch: string }>()
  for (const pr of open) {
    const branch = shortRef(pr.baseRef)
    const key = repoKey(pr.repo) + '\n' + branch
    if (openHeads.has(key) || isDefaultLongLivedBranch(branch) || lookups.has(key)) continue
    lookups.set(key, { repo: pr.repo, branch })
  }

  const merged: StackInputPr[] = []
  const exists = new Map<string, boolean>()
  await eachWithConcurrency([...lookups.entries()], concurrency, async ([key, lookup]) => {
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
  const now = options.now ?? Date.now
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY
  let cached: { at: number; result: GetStacksResult } | null = null
  let inFlight: Promise<GetStacksResult> | null = null
  let generation = 0

  const compute = async (): Promise<GetStacksResult> => {
    const providers = registry.enabled()
    const settled = await Promise.allSettled(
      providers.map((provider) => stacksForProvider(provider, concurrency)),
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
    return { stacks, errors }
  }

  return {
    get(opts = {}) {
      if (!opts.refresh && cached && now() - cached.at < ttlMs) {
        return Promise.resolve(cached.result)
      }
      if (inFlight && !opts.refresh) return inFlight
      const started = generation
      const promise = compute()
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
    },
  }
}
