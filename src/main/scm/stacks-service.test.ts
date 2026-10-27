import { describe, expect, it, vi } from 'vitest'
import { githubRepo } from '../../shared/scm-guards'
import { ScmError } from './errors'
import type { ScmProvider } from './provider'
import { createScmRegistry } from './registry'
import type { StackInputPr } from './stacks'
import { createStacksService, stacksForProvider } from './stacks-service'

const repo = githubRepo('acme', 'api')

const open = (number: number, headRef: string, baseRef: string): StackInputPr => ({
  repo,
  number,
  title: 'PR ' + number,
  headRef,
  baseRef,
  state: 'open',
  isDraft: false,
  createdAt: '2026-10-10T00:00:00Z',
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
    listStackCandidates: async () => [
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
    const listStackCandidates = vi.fn(fake().listStackCandidates)
    const service = createStacksService(createScmRegistry([fake({ listStackCandidates })]), {
      ttlMs: 60_000,
      now: () => clock,
    })

    const first = await service.get()
    expect(first.errors).toEqual([])
    expect(first.stacks).toHaveLength(2)
    await service.get()
    expect(listStackCandidates).toHaveBeenCalledTimes(1)

    clock += 61_000
    await service.get()
    expect(listStackCandidates).toHaveBeenCalledTimes(2)

    // A refresh right after a computation is served from the cache...
    await service.get({ refresh: true })
    expect(listStackCandidates).toHaveBeenCalledTimes(2)
    // ...and recomputes once the last result is older than minRefreshMs.
    clock += 10_000
    await service.get({ refresh: true })
    expect(listStackCandidates).toHaveBeenCalledTimes(3)

    service.invalidate()
    await service.get()
    expect(listStackCandidates).toHaveBeenCalledTimes(4)
  })

  it('reports a failing provider in errors without dropping the others', async () => {
    const azure = {
      ...fake(),
      id: 'azure' as const,
      listStackCandidates: async () => {
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
    const listStackCandidates = vi.fn(async () => {
      await gate
      return fake().listStackCandidates()
    })
    const service = createStacksService(createScmRegistry([fake({ listStackCandidates })]))
    const calls = [service.get({ refresh: true }), service.get({ refresh: true }), service.get()]
    release()
    const [a, b, c] = await Promise.all(calls)
    expect(listStackCandidates).toHaveBeenCalledTimes(1)
    expect(a).toBe(b)
    expect(b).toBe(c)
  })

  it('caps orphan lookups and reports it', async () => {
    const many = Array.from({ length: 5 }, (_, i) =>
      open(10 + i, 'feature/x' + i, 'feature/gone' + i),
    )
    const listMergedBySourceBranch = vi.fn(async () => [] as StackInputPr[])
    const service = createStacksService(
      createScmRegistry([
        fake({ listStackCandidates: async () => many, listMergedBySourceBranch }),
      ]),
      { maxLookups: 3 },
    )
    const result = await service.get()
    expect(listMergedBySourceBranch).toHaveBeenCalledTimes(3)
    expect(result.orphanLookupsCapped).toEqual({ checked: 3, total: 5 })

    const uncapped = await createStacksService(createScmRegistry([fake()])).get()
    expect(uncapped.orphanLookupsCapped).toBeUndefined()
  })
})
