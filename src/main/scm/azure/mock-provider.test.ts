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

  it('fails like a signed-out machine when MINERVA_MOCK_AZURE_AUTH asks for it', async () => {
    const saved = { mock: process.env.MINERVA_MOCK, auth: process.env.MINERVA_MOCK_AZURE_AUTH }
    process.env.MINERVA_MOCK = '1'
    try {
      for (const [value, state, code] of [
        ['unauthenticated', 'cli_unauthenticated', 'UNAUTHENTICATED'],
        ['cli_unavailable', 'cli_unavailable', 'CLI_UNAVAILABLE'],
      ] as const) {
        process.env.MINERVA_MOCK_AZURE_AUTH = value
        const provider = createMockAzureProvider(() => ({ enabled: true, organizations: [] }), 0)
        const status = await provider.getAuthStatus()
        expect(status.state).toBe(state)
        expect(status.detail).toContain(
          'az devops login --organization https://dev.azure.com/contoso',
        )
        await expect(provider.listPullRequests({})).rejects.toMatchObject({ code })
      }
    } finally {
      if (saved.mock === undefined) delete process.env.MINERVA_MOCK
      else process.env.MINERVA_MOCK = saved.mock
      if (saved.auth === undefined) delete process.env.MINERVA_MOCK_AZURE_AUTH
      else process.env.MINERVA_MOCK_AZURE_AUTH = saved.auth
    }
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
