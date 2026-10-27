/** The `MINERVA_MOCK=1` Azure provider: fake server underneath, cheap snapshot, mock org forced. */
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { retargetPullRequest } from '../retarget'
import { stacksForProvider } from '../stacks-service'
import { createMockAzureProvider } from '.'
import { MOCK_ORG, REPOS } from './fixtures/universe'
import { mapRepo } from './mappers'

const apiRepo = mapRepo(REPOS.api, MOCK_ORG)

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'minerva-mock-azure-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('MockAzureScmProvider', () => {
  it('is signed in and lists the contoso universe whatever orgs are saved', async () => {
    const provider = createMockAzureProvider(
      () => ({ enabled: true, organizations: [{ organization: 'Skyllful', projects: ['X'] }] }),
      0,
    )
    expect((await provider.getAuthStatus()).state).toBe('signed_in')
    const prs = await provider.listPullRequests({})
    expect(new Set(prs.map((pr) => pr.repo.name))).toEqual(
      new Set(['orders-api', 'storefront-web', 'platform-infra']),
    )
  })

  it('writes the fixture files straight into the snapshot dir', async () => {
    const provider = createMockAzureProvider(() => ({ enabled: true, organizations: [] }), 0)
    const detail = await provider.getPullRequestDetail(apiRepo, 102)
    await provider.writeSnapshot({ repo: apiRepo, headSha: detail.headSha }, dir)
    expect((await readdir(dir)).sort()).toEqual(['README.md', 'src'])
    expect(await readFile(join(dir, 'src/Services/CheckoutService.cs'), 'utf8')).toContain(
      'OrderStatus.Submitted',
    )
  })

  it('keeps writes in memory: retarget fixes the orphan', async () => {
    const provider = createMockAzureProvider(() => ({ enabled: true, organizations: [] }), 0)
    const before = await stacksForProvider(provider)
    expect(before.find((stack) => stack.root.number === 105)?.root.orphan?.suggestedBase).toBe(
      'main',
    )

    await retargetPullRequest(
      provider,
      {
        repo: apiRepo,
        number: 105,
        expectedCurrentBase: 'feature/refund-schema',
        newBase: 'main',
      },
      async () => true,
    )
    const after = await stacksForProvider(provider)
    expect(after.find((stack) => stack.root.number === 105)).toBeUndefined()

    // A second, stale retarget is a CONFLICT (its base is no longer the expected one).
    await expect(
      retargetPullRequest(
        provider,
        {
          repo: apiRepo,
          number: 105,
          expectedCurrentBase: 'feature/refund-schema',
          newBase: 'main',
        },
        async () => true,
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
  })
})
