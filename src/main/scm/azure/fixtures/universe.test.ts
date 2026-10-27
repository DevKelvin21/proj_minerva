import { describe, expect, it } from 'vitest'
import { buildStacks, flattenStack, type StackInputPr } from '../../stacks'
import { mapChangeEntry, mapPullRequestSummary, mapRepo, mapThreads } from '../mappers'
import { buildPatch } from '../patch-builder'
import {
  BRANCHES,
  CHANGES,
  ITERATIONS,
  MOCK_ORG,
  PULL_REQUESTS,
  THREADS,
  getMockBlob,
  gitBlobId,
  mockPullRequestsByStatus,
} from './universe'

function stackInput(status: 'active' | 'completed'): StackInputPr[] {
  return mockPullRequestsByStatus(status).map((raw) => {
    const pr = mapPullRequestSummary(raw, MOCK_ORG)
    return { ...pr, createdAt: raw.creationDate, closedAt: raw.closedDate }
  })
}

describe('mock universe', () => {
  it('is internally consistent: every PR has iterations and changes, every blob resolves', () => {
    for (const pr of PULL_REQUESTS) {
      expect(ITERATIONS[pr.pullRequestId]?.length).toBeGreaterThan(0)
      for (const entry of CHANGES[pr.pullRequestId] ?? []) {
        for (const id of [entry.item.objectId, entry.item.originalObjectId]) {
          if (!id) continue
          const bytes = getMockBlob(id)
          expect(bytes).not.toBeNull()
          expect(gitBlobId(bytes as Buffer)).toBe(id)
        }
      }
    }
  })

  it('uses a git-compatible blob id', () => {
    // `printf 'hello\n' | git hash-object --stdin`
    expect(gitBlobId(Buffer.from('hello\n'))).toBe('ce013625030ba8dba906f756967f9e9ca394464a')
  })

  it('builds patches for every change, including binary and pure rename', () => {
    const results = Object.values(CHANGES)
      .flat()
      .map((entry) => {
        const change = mapChangeEntry(entry)
        if (!change) throw new Error('folder entry in fixtures')
        const base = change.baseObjectId ? getMockBlob(change.baseObjectId) : null
        const head = change.headObjectId ? getMockBlob(change.headObjectId) : null
        return { change, built: buildPatch(base, head) }
      })
    const byPath = new Map(results.map((r) => [r.change.path, r]))

    expect(byPath.get('docs/logo.png')?.built.isBinary).toBe(true)
    const pureRename = byPath.get('modules/virtual-network/README.md')
    expect(pureRename?.change).toMatchObject({
      status: 'renamed',
      previousPath: 'modules/network/README.md',
    })
    expect(pureRename?.built.patch).toBeUndefined()
    expect(byPath.get('modules/virtual-network/main.tf')?.built).toMatchObject({
      additions: 1,
      deletions: 1,
    })
    expect(byPath.get('modules/network/legacy.tf')?.change.status).toBe('removed')
    expect(byPath.get('src/cart/legacy-layout.css')?.built.deletions).toBe(1)

    const service = byPath.get('src/Services/CheckoutService.cs')?.built.patch ?? ''
    // The line-12 comment in #102 sits on a context line OUTSIDE every hunk.
    expect(service.split('\n')[0]).toBe('@@ -14,6 +14,9 @@')
  })

  it('produces a 3-deep stack, an orphan, and a cross-repo group', () => {
    const stacks = buildStacks(stackInput('active'), stackInput('completed'), {
      branchExists: (repo, branch) =>
        repo.provider === 'azure' ? BRANCHES[repo.repositoryId]?.includes(branch) : undefined,
    })
    const summary = stacks.map((s) => ({
      repo: s.repo.name,
      chain: flattenStack(s.root).map((n) => n.number),
      group: s.groupKey,
      orphan: s.root.orphan,
    }))
    expect(summary).toEqual([
      {
        repo: 'orders-api',
        chain: [101, 102, 103],
        group: 'azure:contoso:feature/checkout-v2-models',
        orphan: undefined,
      },
      {
        repo: 'orders-api',
        chain: [105],
        group: undefined,
        orphan: {
          parent: { number: 100, title: 'Add refunds table', mergedInto: 'main' },
          targetBranchExists: true,
          suggestedBase: 'main',
        },
      },
      {
        repo: 'storefront-web',
        chain: [110, 104],
        group: 'azure:contoso:feature/checkout-v2-models',
        orphan: undefined,
      },
    ])
  })

  it('covers every thread status, filtering system and deleted items', () => {
    const pr108 = PULL_REQUESTS.find((pr) => pr.pullRequestId === 108)
    if (!pr108) throw new Error('fixture #108 missing')
    const threads = mapThreads(THREADS[108], mapRepo(pr108.repository, MOCK_ORG), 108)
    expect(threads.map((t) => t.status).sort()).toEqual(
      ['active', 'by_design', 'closed', 'pending', 'resolved', 'wont_fix'].sort(),
    )
    expect(threads.find((t) => t.id === '5')?.comments).toHaveLength(1)
    expect(threads.find((t) => t.id === '3')).toMatchObject({ side: 'LEFT', line: 2 })
    expect(threads.find((t) => t.id === '1')?.comments.map((c) => c.id)).toEqual([
      '1/1',
      '1/2',
      '1/3',
    ])
    expect(threads.some((t) => t.id === '7' || t.id === '8')).toBe(false)
  })

  it('has states open, merged and closed', () => {
    const states = new Set(PULL_REQUESTS.map((pr) => mapPullRequestSummary(pr, MOCK_ORG).state))
    expect([...states].sort()).toEqual(['closed', 'merged', 'open'])
  })
})
