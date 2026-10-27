import { describe, expect, it, vi } from 'vitest'
import { createMockAzureProvider } from '../scm/azure'
import { MOCK_ORG, REPOS } from '../scm/azure/fixtures/universe'
import { mapRepo } from '../scm/azure/mappers'
import { MockAiService } from './mock-service'
import type { PrContextSource } from './pr-context'

describe('MockAiService with a PrContextSource (Azure mock PR)', () => {
  it('runs detail -> files -> snapshot through the SCM layer and summarizes it', async () => {
    const azure = createMockAzureProvider(() => ({ enabled: true, organizations: [] }), 0)
    const repo = mapRepo(REPOS.web, MOCK_ORG)
    const ensureSnapshot = vi.fn(async () => '/tmp/snapshot-dir')
    const context: PrContextSource = {
      getDetail: (r, n) => azure.getPullRequestDetail(r, n),
      getFiles: (r, n) => azure.getPullRequestFiles(r, n),
      ensureSnapshot,
    }
    const progress = vi.fn()

    const result = await new MockAiService(context).analyzePullRequest(
      { repo, number: 108 },
      { onProgress: progress },
    )

    const detail = await azure.getPullRequestDetail(repo, 108)
    expect(result.headSha).toBe(detail.headSha)
    expect(ensureSnapshot).toHaveBeenCalledWith(repo, detail.headSha)
    expect(result.sections).toHaveLength(1)
    expect(result.sections[0].kind).toBe('summary')
    expect(result.sections[0].markdown).toContain('Fix cart rounding')
    expect(result.sections[0].markdown).toContain('`src/cart/total.ts` (modified, +2 / -1)')
    expect(progress).toHaveBeenLastCalledWith(expect.any(Array), { done: true })
  }, 15_000)

  it('without a context it still refuses PRs it has no fixture for', async () => {
    await expect(
      new MockAiService().analyzePullRequest({ repo: mapRepo(REPOS.web, MOCK_ORG), number: 108 }),
    ).rejects.toThrow(/demo/)
  })
})
