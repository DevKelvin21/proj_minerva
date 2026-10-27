import { describe, expect, it, vi } from 'vitest'
import type { AzureRepoRef, RepoRef } from '../../shared/scm'
import { githubRepo } from '../../shared/scm-guards'
import type { PullRequestSummary } from '../../shared/types'
import { createDashboardService, mergeDashboardLists } from './dashboard-service'
import { ScmError } from './errors'
import type { ScmProvider, ScopePullRequest } from './provider'
import { createScmRegistry } from './registry'
import { createScopeCache } from './scope-cache'
import { createStacksService } from './stacks-service'

const api = githubRepo('acme', 'api')
const far = githubRepo('acme', 'far-away')

function pr(
  repo: RepoRef,
  number: number,
  extra: Partial<PullRequestSummary> = {},
): PullRequestSummary {
  return {
    id: repo.fullName + '#' + number,
    number,
    title: 'PR ' + number,
    author: { login: 'octo' },
    repo,
    state: 'open',
    isDraft: false,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    headRef: 'feature/' + number,
    baseRef: 'main',
    headSha: '',
    webUrl: '',
    commentCount: 0,
    reviewDecision: null,
    ciStatus: null,
    additions: 0,
    deletions: 0,
    changedFiles: 0,
    ...extra,
  }
}

const scoped = (summary: PullRequestSummary): ScopePullRequest => ({ summary })

function fake(id: 'github' | 'azure', overrides: Partial<ScmProvider> = {}): ScmProvider {
  const notUsed = (): never => {
    throw new Error('not used')
  }
  return {
    id,
    getAuthStatus: notUsed,
    listPullRequests: async () => [],
    getPullRequestDetail: notUsed,
    getPullRequestFiles: notUsed,
    getCommentThreads: notUsed,
    postComment: notUsed,
    writeSnapshot: notUsed,
    setThreadStatus: notUsed,
    getFileContent: notUsed,
    branchExists: async () => true,
    updatePullRequestBase: notUsed,
    listScopePullRequests: async () => [],
    listMergedBySourceBranch: async () => [],
    ...overrides,
  }
}

describe('mergeDashboardLists', () => {
  it('unions scope and involved lists by prKey, open only; the involved record wins', () => {
    const labels = [{ name: 'checkout-v2', color: '14b8a6' }]
    const viewer = { isAuthor: true, reviewer: null }
    const merged = mergeDashboardLists(
      [pr(api, 1, { labels, title: 'old title' }), pr(api, 2)],
      [
        // Same PR, richer date, no labels reported: labels come from the scope record.
        pr(api, 1, { updatedAt: '2026-10-09T00:00:00.000Z', viewer, title: 'new title' }),
        // Outside the scope (e.g. GitHub past MAX_STACK_REPOS).
        pr(far, 7),
        // Not open: never on the dashboard.
        pr(api, 3, { state: 'merged' }),
      ],
    )
    expect(merged.map((item) => item.id)).toEqual(['acme/api#1', 'acme/api#2', 'acme/far-away#7'])
    expect(merged[0]).toMatchObject({
      title: 'new title',
      updatedAt: '2026-10-09T00:00:00.000Z',
      labels,
      viewer,
    })
  })

  it('keeps the involved fields when both have them, and the same number in two repos apart', () => {
    const merged = mergeDashboardLists(
      [pr(api, 1, { labels: [{ name: 'a' }], reviewers: [] })],
      [pr(api, 1, { labels: [{ name: 'b' }] }), pr(far, 1)],
    )
    expect(merged).toHaveLength(2)
    expect(merged[0].labels).toEqual([{ name: 'b' }])
    expect(merged[0].reviewers).toEqual([])
  })
})

describe('createDashboardService', () => {
  it('merges per provider, sorts by activity, and stamps fetchedAt', async () => {
    const contoso: AzureRepoRef = {
      provider: 'azure',
      organization: 'contoso',
      project: 'Platform',
      name: 'orders-api',
      repositoryId: '11111111-1111-4111-8111-111111111111',
      fullName: 'contoso/Platform/orders-api',
    }
    const github = fake('github', {
      listScopePullRequests: async () => [scoped(pr(api, 1)), scoped(pr(api, 2))],
      listPullRequests: async () => [
        pr(api, 2, { updatedAt: '2026-10-05T00:00:00.000Z' }),
        pr(far, 9),
      ],
    })
    const azure = fake('azure', {
      listScopePullRequests: async () => [
        scoped(pr(contoso, 101, { updatedAt: '2026-10-03T00:00:00.000Z' })),
      ],
    })
    const clock = Date.parse('2026-10-27T10:00:00Z')
    const service = createDashboardService(createScmRegistry([github, azure]), {
      now: () => clock,
    })
    const result = await service.get()
    expect(result.errors).toEqual([])
    expect(result.fetchedAt).toBe('2026-10-27T10:00:00.000Z')
    expect(result.pullRequests.map((item) => item.id)).toEqual([
      'acme/api#2',
      'contoso/Platform/orders-api#101',
      'acme/api#1',
      'acme/far-away#9',
    ])
  })

  it('reports provider failures as ScmListError, keeping what did answer', async () => {
    const github = fake('github', {
      // Scope failed, involved answered: those PRs still show, and the failure is reported.
      listScopePullRequests: async () => {
        throw new ScmError('RATE_LIMITED', 'slow down')
      },
      listPullRequests: async () => [pr(api, 1)],
    })
    const azure = fake('azure', {
      listScopePullRequests: async () => {
        throw new ScmError('UNAUTHENTICATED', 'no PAT')
      },
      listPullRequests: async () => {
        throw new ScmError('UNAUTHENTICATED', 'no PAT')
      },
    })
    const result = await createDashboardService(createScmRegistry([github, azure])).get()
    expect(result.pullRequests.map((item) => item.id)).toEqual(['acme/api#1'])
    expect(result.errors).toEqual([
      { provider: 'github', code: 'RATE_LIMITED', message: 'slow down' },
      { provider: 'azure', code: 'UNAUTHENTICATED', message: 'no PAT' },
    ])
  })

  it('only asks enabled providers', async () => {
    const azureScope = vi.fn(async () => [] as ScopePullRequest[])
    const registry = createScmRegistry(
      [fake('github'), fake('azure', { listScopePullRequests: azureScope })],
      (id) => id === 'github',
    )
    await createDashboardService(registry).get()
    expect(azureScope).not.toHaveBeenCalled()
  })

  it('caches for the TTL, throttles refresh, and drops the cache on invalidate', async () => {
    let clock = 0
    const listScopePullRequests = vi.fn(async () => [scoped(pr(api, 1))])
    const listPullRequests = vi.fn(async () => [pr(api, 1)])
    const service = createDashboardService(
      createScmRegistry([fake('github', { listScopePullRequests, listPullRequests })]),
      { now: () => clock },
    )
    const counts = (): number[] => [
      listScopePullRequests.mock.calls.length,
      listPullRequests.mock.calls.length,
    ]

    await service.get()
    await service.get()
    expect(counts()).toEqual([1, 1])

    // A refresh right after a computation is served from the cache...
    await service.get({ refresh: true })
    expect(counts()).toEqual([1, 1])
    // ...and recomputes once the last result is older than minRefreshMs.
    clock += 10_000
    await service.get({ refresh: true })
    expect(counts()).toEqual([2, 2])

    clock += 59_000
    await service.get()
    expect(counts()).toEqual([2, 2])
    clock += 1_000
    await service.get()
    expect(counts()).toEqual([3, 3])

    service.invalidate()
    await service.get()
    expect(counts()).toEqual([4, 4])
  })

  it('refresh is single-flight: concurrent calls join one computation', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    const listPullRequests = vi.fn(async () => {
      await gate
      return [pr(api, 1)]
    })
    const service = createDashboardService(
      createScmRegistry([fake('github', { listPullRequests })]),
    )
    const calls = [service.get({ refresh: true }), service.get({ refresh: true }), service.get()]
    release()
    const [a, b, c] = await Promise.all(calls)
    expect(listPullRequests).toHaveBeenCalledTimes(1)
    expect(a).toBe(b)
    expect(b).toBe(c)
  })

  it('an invalidate() during a computation keeps its result out of the cache', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    let calls = 0
    const listPullRequests = vi.fn(async () => {
      calls++
      if (calls === 1) await gate
      return [pr(api, calls)]
    })
    const service = createDashboardService(
      createScmRegistry([fake('github', { listPullRequests })]),
    )
    const stale = service.get()
    service.invalidate()
    release()
    expect((await stale).pullRequests.map((item) => item.number)).toEqual([1])
    expect((await service.get()).pullRequests.map((item) => item.number)).toEqual([2])
  })
})

describe('stacks + dashboard share one scope fetch', () => {
  function setup() {
    const listScopePullRequests = vi.fn(async () => [
      scoped(pr(api, 1, { headRef: 'feature/a' })),
      scoped(pr(api, 2, { headRef: 'feature/b', baseRef: 'feature/a' })),
    ])
    const registry = createScmRegistry([fake('github', { listScopePullRequests })])
    const scope = createScopeCache()
    return {
      listScopePullRequests,
      scope,
      stacks: createStacksService(registry, { scope }),
      dashboard: createDashboardService(registry, { scope }),
    }
  }

  it('one cold scope call for both views, also when they load concurrently', async () => {
    const { listScopePullRequests, stacks, dashboard } = setup()
    const [stackResult, dashboardResult] = await Promise.all([stacks.get(), dashboard.get()])
    expect(listScopePullRequests).toHaveBeenCalledTimes(1)
    expect(stackResult.stacks.map((stack) => stack.size)).toEqual([2])
    expect(dashboardResult.pullRequests).toHaveLength(2)
  })

  it('one call when both refresh together, and both see an invalidation', async () => {
    let clock = 0
    const listScopePullRequests = vi.fn(async () => [scoped(pr(api, 1))])
    const registry = createScmRegistry([fake('github', { listScopePullRequests })])
    const now = (): number => clock
    const scope = createScopeCache({ now })
    const stacks = createStacksService(registry, { scope, now })
    const dashboard = createDashboardService(registry, { scope, now })
    await stacks.get()
    await dashboard.get()
    expect(listScopePullRequests).toHaveBeenCalledTimes(1)

    clock += 10_000
    await Promise.all([stacks.get({ refresh: true }), dashboard.get({ refresh: true })])
    expect(listScopePullRequests).toHaveBeenCalledTimes(2)

    // A retarget invalidates stacks (and with them the shared scope).
    stacks.invalidate()
    dashboard.invalidate()
    await Promise.all([stacks.get(), dashboard.get()])
    expect(listScopePullRequests).toHaveBeenCalledTimes(3)
  })
})
