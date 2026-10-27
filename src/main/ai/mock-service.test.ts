import { describe, expect, it, vi } from 'vitest'
import { createMockAzureProvider } from '../scm/azure'
import { MOCK_ORG, REPOS } from '../scm/azure/fixtures/universe'
import { mapRepo } from '../scm/azure/mappers'
import { githubRepo } from '../../shared/scm-guards'
import type { AnalysisActivityItem } from '../../shared/events'
import { messageKeys } from '../../shared/locale'
import { MockAiService } from './mock-service'
import * as fixturesEn from './fixtures'
import * as fixturesEs from './fixtures.es'
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

describe('MockAiService language', () => {
  const repo = githubRepo('shopwave', 'api')

  it('serves the English fixtures by default and the Spanish ones for es, activity labels included', async () => {
    const labels = async (language?: 'en' | 'es'): Promise<string[]> => {
      const seen: string[] = []
      await new MockAiService().analyzePullRequest(
        { repo, number: 482 },
        {
          language,
          onProgress: (_sections, meta) => {
            for (const item of meta.activity ?? ([] as AnalysisActivityItem[])) seen.push(item.label)
          },
        },
      )
      return seen
    }
    const en = await new MockAiService().analyzePullRequest({ repo, number: 482 })
    const es = await new MockAiService().analyzePullRequest({ repo, number: 482 }, { language: 'es' })
    expect(en.sections[0].markdown).toContain('## What changes')
    expect(es.sections[0].markdown).toContain('## Qué cambia')
    expect(en.sections.map((s) => s.kind)).toEqual(es.sections.map((s) => s.kind))
    expect(await labels()).toContain('Read src/api/routes.ts')
    expect(await labels('es')).toContain('Leyó src/api/routes.ts')
  }, 20_000)

  it('the English and Spanish fixtures have the same PRs and section kinds', () => {
    expect(Object.keys(fixturesEn.richDidacticSections).sort()).toEqual(
      Object.keys(fixturesEs.richDidacticSections).sort(),
    )
    for (const [key, sections] of Object.entries(fixturesEn.richDidacticSections)) {
      const spanish = fixturesEs.richDidacticSections[key]
      expect(sections.map((s) => s.kind), key).toEqual(spanish.map((s) => s.kind))
      expect(messageKeys(sections).length, key).toBe(messageKeys(spanish).length)
    }
  })
})
