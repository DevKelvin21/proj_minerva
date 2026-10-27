import { describe, expect, it, vi } from 'vitest'
import { githubRepo } from '../../shared/scm-guards'
import { ScmError } from './errors'
import type { ScmProvider, ScopePullRequest } from './provider'
import { createScmRegistry } from './registry'
import { createScopeCache } from './scope-cache'
import type { StackInputPr } from './stacks'
import { createStacksService, scopeToStackInput, stacksForProvider } from './stacks-service'

const repo = githubRepo('acme', 'api')

const open = (number: number, headRef: string, baseRef: string): ScopePullRequest => ({
  summary: {
    id: 'acme/api#' + number,
    number,
    title: 'PR ' + number,
    author: { login: 'octo' },
    repo,
    state: 'open',
    isDraft: false,
    createdAt: '2026-10-10T00:00:00Z',
    updatedAt: '2026-10-10T00:00:00Z',
    headRef,
    baseRef,
    headSha: '',
    webUrl: '',
    commentCount: 0,
    reviewDecision: null,
    ciStatus: null,
    additions: 0,
    deletions: 0,
    changedFiles: 0,
  },
})

function fake(overrides: Partial<ScmProvider> = {}): ScmProvider {
  const notUsed = (): never => {
    throw new Error('not used')
  }
  return {
    id: 'github',
    getAuthStatus: notUsed,
    listPullRequests: notUsed,
    getPullRequestDetail: notUsed,
    getPullRequestFiles: notUsed,
    getCommentThreads: notUsed,
    postComment: notUsed,
    writeSnapshot: notUsed,
    setThreadStatus: notUsed,
    getFileContent: notUsed,
    updatePullRequestBase: notUsed,
    listScopePullRequests: async () => [
      open(1, 'feature/a', 'main'),
      open(2, 'feature/b', 'feature/a'),
      open(3, 'feature/orphan', 'feature/done'),
      open(4, 'feature/lonely', 'feature/never-merged'),
    ],
    listMergedBySourceBranch: async (_repo, branch) =>
      branch === 'feature/done'
        ? [
            {
              repo,
              number: 9,
              title: 'Done',
              headRef: 'feature/done',
              baseRef: 'main',
              state: 'merged',
              isDraft: false,
              mergedInto: 'main',
              createdAt: '2026-10-01T00:00:00Z',
              closedAt: '2026-10-15T00:00:00Z',
            },
          ]
        : [],
    branchExists: async () => false,
    ...overrides,
  }
}

describe('scopeToStackInput', () => {
  it('keeps what stack detection needs, and the fork flag only when set', () => {
    expect(scopeToStackInput(open(1, 'feature/a', 'main'))).toEqual({
      repo,
      number: 1,
      title: 'PR 1',
      headRef: 'feature/a',
      baseRef: 'main',
      state: 'open',
      isDraft: false,
      createdAt: '2026-10-10T00:00:00Z',
    })
    expect(scopeToStackInput({ ...open(2, 'patch-1', 'main'), headIsFork: true }).headIsFork).toBe(
      true,
    )
  })

  it('never stacks a fork PR onto a same-named branch', async () => {
    const stacks = await stacksForProvider(
      fake({
        // #1 comes from a fork whose branch happens to be named feature/a too;
        // without the flag it would win as the lowest-numbered parent.
        listScopePullRequests: async () => [
          { ...open(1, 'feature/a', 'main'), headIsFork: true },
          open(2, 'feature/a', 'main'),
          open(3, 'feature/b', 'feature/a'),
        ],
      }),
    )
    const chain = (number: number): number[] => {
      const root = stacks.find((stack) => stack.root.number === number)?.root
      const out: number[] = []
      const walk = (node: typeof root): void => {
        if (!node) return
        out.push(node.number)
        node.children.forEach(walk)
      }
      walk(root)
      return out
    }
    expect(chain(2)).toEqual([2, 3])
    expect(chain(1)).toEqual([])
  })
})

describe('stacksForProvider', () => {
  it('asks only for candidate roots, never for long-lived or stacked bases', async () => {
    const listMergedBySourceBranch = vi.fn(fake().listMergedBySourceBranch)
    const branchExists = vi.fn(async (_repo: unknown, _branch: string) => false)
    const stacks = await stacksForProvider(fake({ listMergedBySourceBranch, branchExists }))

    expect(listMergedBySourceBranch.mock.calls.map((call) => call[1]).sort()).toEqual([
      'feature/done',
      'feature/never-merged',
    ])
    // Branch existence is only looked up where an orphan was found.
    expect(branchExists.mock.calls.map((call) => call[1])).toEqual(['feature/done'])

    expect(stacks.map((stack) => [stack.root.number, stack.size])).toEqual([
      [1, 2],
      [3, 1],
    ])
    expect(stacks[1].root.orphan).toEqual({
      parent: { number: 9, title: 'Done', mergedInto: 'main' },
      targetBranchExists: false,
      suggestedBase: 'main',
    })
  })

  it('survives a failing orphan lookup (that hint is just lost)', async () => {
    const stacks = await stacksForProvider(
      fake({
        listMergedBySourceBranch: async () => {
          throw new ScmError('RATE_LIMITED', 'slow')
        },
      }),
    )
    expect(stacks.map((stack) => stack.root.number)).toEqual([1])
  })
})

describe('createStacksService', () => {
  it('caches for the TTL, refreshes on demand, and drops the cache on invalidate', async () => {
    let clock = 0
    const listScopePullRequests = vi.fn(fake().listScopePullRequests)
    const service = createStacksService(createScmRegistry([fake({ listScopePullRequests })]), {
      ttlMs: 60_000,
      now: () => clock,
    })

    const first = await service.get()
    expect(first.errors).toEqual([])
    expect(first.stacks).toHaveLength(2)
    await service.get()
    expect(listScopePullRequests).toHaveBeenCalledTimes(1)

    clock += 61_000
    await service.get()
    expect(listScopePullRequests).toHaveBeenCalledTimes(2)

    // A refresh right after a computation is served from the cache...
    await service.get({ refresh: true })
    expect(listScopePullRequests).toHaveBeenCalledTimes(2)
    // ...and recomputes once the last result is older than minRefreshMs.
    clock += 10_000
    await service.get({ refresh: true })
    expect(listScopePullRequests).toHaveBeenCalledTimes(3)

    service.invalidate()
    await service.get()
    expect(listScopePullRequests).toHaveBeenCalledTimes(4)
  })

  it('reports a failing provider in errors without dropping the others', async () => {
    const azure = {
      ...fake(),
      id: 'azure' as const,
      listScopePullRequests: async () => {
        throw new ScmError('UNAUTHENTICATED', 'no PAT')
      },
    }
    const service = createStacksService(createScmRegistry([fake(), azure]))
    const result = await service.get()
    expect(result.stacks.length).toBeGreaterThan(0)
    expect(result.errors).toEqual([
      { provider: 'azure', code: 'UNAUTHENTICATED', message: 'no PAT' },
    ])
  })

  it('refresh is single-flight: concurrent refreshes join one computation', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    const listScopePullRequests = vi.fn(async () => {
      await gate
      return fake().listScopePullRequests()
    })
    const service = createStacksService(createScmRegistry([fake({ listScopePullRequests })]))
    const calls = [service.get({ refresh: true }), service.get({ refresh: true }), service.get()]
    release()
    const [a, b, c] = await Promise.all(calls)
    expect(listScopePullRequests).toHaveBeenCalledTimes(1)
    expect(a).toBe(b)
    expect(b).toBe(c)
  })

  it('caps orphan lookups and reports it', async () => {
    const many: ScopePullRequest[] = Array.from({ length: 5 }, (_, i) =>
      open(10 + i, 'feature/x' + i, 'feature/gone' + i),
    )
    const listMergedBySourceBranch = vi.fn(async () => [] as StackInputPr[])
    const service = createStacksService(
      createScmRegistry([
        fake({ listScopePullRequests: async () => many, listMergedBySourceBranch }),
      ]),
      { maxLookups: 3 },
    )
    const result = await service.get()
    expect(listMergedBySourceBranch).toHaveBeenCalledTimes(3)
    expect(result.orphanLookupsCapped).toEqual({ checked: 3, total: 5 })

    const uncapped = await createStacksService(createScmRegistry([fake()])).get()
    expect(uncapped.orphanLookupsCapped).toBeUndefined()
  })

  it('reads the scope through the shared cache, and invalidate() drops it', async () => {
    const listScopePullRequests = vi.fn(fake().listScopePullRequests)
    const provider = fake({ listScopePullRequests })
    const scope = createScopeCache()
    await scope.get(provider)
    const service = createStacksService(createScmRegistry([provider]), { scope })
    await service.get()
    expect(listScopePullRequests).toHaveBeenCalledTimes(1)
    service.invalidate()
    await scope.get(provider)
    expect(listScopePullRequests).toHaveBeenCalledTimes(2)
  })
})
