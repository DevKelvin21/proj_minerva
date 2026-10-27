/**
 * Watcher de PRs en background (T50/T51, F10): pollea `listPullRequests` a
 * intervalos regulares y emite `prListChanged` (`../../shared/events.ts`)
 * cuando detecta diferencias contra el snapshot del tick anterior. Vive en
 * `main` porque es quien tiene el registro de proveedores SCM y quien puede
 * empujar eventos a todas las ventanas — el renderer solo escucha
 * (`window.minerva.events.onPrListChanged`).
 *
 * Diseño deliberado (ver `.agents/PLAN.md` § "Iteración actual"):
 * - El PRIMER tick exitoso solo establece el snapshot baseline, SIN emitir
 *   evento — de lo contrario cada arranque de la app dispararía un aluvión
 *   de "PR nuevo" para todos los PRs existentes.
 * - Un PR produce A LO SUMO un `PrChange` por tick, con esta prioridad:
 *   cierre/merge > nuevos comentarios > cualquier otro `updatedAt` distinto.
 * - PRs que desaparecen del top-50 de la respuesta (paginado, archivado,
 *   etc.) NO generan `PrChange`: no hay forma de saber por qué desaparecieron
 *   y arriesgarse a reportar "cerrado" sería un falso positivo.
 * - `setTimeout` re-armado en vez de `setInterval`: permite variar el
 *   intervalo efectivo (backoff ante rate limit) sin acumular ticks
 *   superpuestos si un tick tarda más que el intervalo nominal.
 */
import type { PrChange, PrListChangedEvent } from '../../shared/events'
import { prKey, type ScmProviderId } from '../../shared/scm'
import type { PullRequestSummary, ScmListError } from '../../shared/types'
import { scmCodeOf } from './errors'

const DEFAULT_INTERVAL_MS = 60_000
const MAX_BACKOFF_MS = 15 * 60_000

/** One fan-out listing across providers (see `listAcrossProviders` in `./registry.ts`). */
export interface WatcherListResult {
  items: PullRequestSummary[]
  errors: ScmListError[]
  /** Providers that answered successfully, possibly with zero items. */
  okProviders: ScmProviderId[]
}

export interface PrWatcherDeps {
  /**
   * Lists every PR (typically `{ state: 'all' }`) across providers. Per-provider
   * failures arrive in `errors` (typed codes); the call itself may still
   * reject on an unexpected failure, which `tick()` also absorbs.
   */
  list: () => Promise<WatcherListResult>
  /** Pushes `prListChanged` to every window; no-op when there are none. */
  broadcast: (event: PrListChangedEvent) => void
  /**
   * Called with the changes right BEFORE `broadcast`, so caches the
   * renderer's refetch would hit (dashboard, scope, stacks) are dropped first.
   * A throw here never blocks the broadcast.
   */
  onChanges?: (event: PrListChangedEvent) => void
  /** Nominal interval between successful ticks (ms). Default 60s. */
  intervalMs?: number
}

export interface PrWatcher {
  start(): void
  stop(): void
}

/** One `PrChange` per PR, priority: close/merge > new comments > any other `updatedAt` change. */
function diffPr(previous: PullRequestSummary, next: PullRequestSummary): PrChange | null {
  const base = {
    prKey: prKey(next.repo, next.number),
    number: next.number,
    title: next.title,
    repo: next.repo,
  }

  if (previous.state === 'open' && next.state === 'closed') {
    return { ...base, type: 'pr_closed' }
  }
  if (previous.state === 'open' && next.state === 'merged') {
    return { ...base, type: 'pr_merged' }
  }
  if (
    next.state === previous.state &&
    next.commentCount !== null &&
    previous.commentCount !== null &&
    next.commentCount > previous.commentCount
  ) {
    return { ...base, type: 'new_comments' }
  }
  if (next.updatedAt !== previous.updatedAt) {
    return { ...base, type: 'updated' }
  }
  return null
}

/**
 * Diffs the previous snapshot against the new items. `new_pr` is only
 * reported for providers that already had a baseline: a provider that failed
 * on the first tick (or was enabled later) would otherwise flood the UI with
 * "new PR" for every existing one.
 */
function diffSnapshots(
  previous: Map<string, PullRequestSummary>,
  next: PullRequestSummary[],
  baselined: ReadonlySet<ScmProviderId>,
): PrChange[] {
  const changes: PrChange[] = []
  for (const pr of next) {
    const key = prKey(pr.repo, pr.number)
    const prev = previous.get(key)
    if (!prev) {
      if (baselined.has(pr.repo.provider)) {
        changes.push({
          type: 'new_pr',
          prKey: key,
          number: pr.number,
          title: pr.title,
          repo: pr.repo,
        })
      }
      continue
    }
    const change = diffPr(prev, pr)
    if (change) changes.push(change)
  }
  return changes
}

export function createPrWatcher(deps: PrWatcherDeps): PrWatcher {
  const nominalIntervalMs =
    deps.intervalMs && deps.intervalMs > 0 ? deps.intervalMs : DEFAULT_INTERVAL_MS

  let timer: ReturnType<typeof setTimeout> | null = null
  let snapshot: Map<string, PullRequestSummary> | null = null
  const baselined = new Set<ScmProviderId>()
  let currentBackoffMs = nominalIntervalMs
  let stopped = true

  function scheduleNext(delayMs: number): void {
    if (stopped) return
    timer = setTimeout(() => {
      void tick()
    }, delayMs)
  }

  /** Reacts to typed provider errors: silent skip when signed out, backoff on rate limit. */
  function handleErrors(errors: { code: string | null; detail: unknown }[]): boolean {
    let rateLimited = false
    for (const { code, detail } of errors) {
      if (code === 'UNAUTHENTICATED' || code === 'CLI_UNAVAILABLE') {
        // No session: not a transient API problem, retry at the nominal interval.
      } else if (code === 'RATE_LIMITED') {
        rateLimited = true
      } else {
        console.error('[pr-watcher] tick error, retrying next interval:', detail)
      }
    }
    if (rateLimited) {
      currentBackoffMs = Math.min(currentBackoffMs * 2, MAX_BACKOFF_MS)
      console.warn('[pr-watcher] rate limited, backing off to', currentBackoffMs, 'ms')
    }
    return rateLimited
  }

  async function tick(): Promise<void> {
    try {
      const result = await deps.list()
      const rateLimited = handleErrors(
        result.errors.map((error) => ({ code: error.code, detail: error.message })),
      )
      // Any provider succeeding resets an earlier backoff, unless one is still rate limited.
      if (!rateLimited && result.okProviders.length > 0) currentBackoffMs = nominalIntervalMs

      const failed = new Set(result.errors.map((error) => error.provider))
      const nextSnapshot = new Map(result.items.map((pr) => [prKey(pr.repo, pr.number), pr]))
      if (snapshot) {
        const changes = diffSnapshots(snapshot, result.items, baselined)
        // A provider that failed this tick keeps its previous entries, so its
        // PRs don't come back as "new" once it recovers.
        for (const [key, pr] of snapshot) {
          if (failed.has(pr.repo.provider) && !nextSnapshot.has(key)) nextSnapshot.set(key, pr)
        }
        if (changes.length > 0) {
          const event = { changes }
          try {
            deps.onChanges?.(event)
          } catch (error) {
            console.warn('[pr-watcher] onChanges failed:', error)
          }
          deps.broadcast(event)
        }
      }
      // First tick establishes the baseline silently (no broadcast).
      if (snapshot || result.okProviders.length > 0) snapshot = nextSnapshot
      for (const provider of result.okProviders) baselined.add(provider)
    } catch (error) {
      handleErrors([{ code: scmCodeOf(error), detail: error }])
    } finally {
      scheduleNext(currentBackoffMs)
    }
  }

  return {
    start(): void {
      if (!stopped) return
      stopped = false
      void tick()
    },
    stop(): void {
      stopped = true
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
    },
  }
}
