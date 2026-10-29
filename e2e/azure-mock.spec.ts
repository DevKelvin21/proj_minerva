import {
  test as base,
  expect,
  attachScreenshot,
  closeMinerva,
  openPrDetails,
  openAnalysisTab,
  openReposView,
  launchMinerva,
  type MinervaApp,
} from './fixtures'
import type { Page } from './fixtures'

/**
 * Azure DevOps mock (`MINERVA_MOCK=1`): the REAL `AzureScmProvider` over the
 * in-memory fake REST server (org "contoso", project "Platform"). Covers the
 * list (with the provider icon), the detail, a built patch, a thread with an
 * Azure-only status, and the new channels through the preload API
 * (stacks with the orphan, file content, thread status, retarget). Every
 * write lands in the fake's memory only.
 *
 * Main confirms retargets (and new Azure orgs) with a native dialog. Tests
 * can't click it, so the app runs with `MINERVA_TEST_CONFIRM` (honored only
 * with `MINERVA_MOCK=1`): `accept` by default, `decline` in its own suite.
 */

const test = base.extend<{ confirmAnswer: 'accept' | 'decline'; minerva: MinervaApp }>({
  confirmAnswer: ['accept', { option: true }],
  minerva: async ({ confirmAnswer }, use, testInfo) => {
    const app = await launchMinerva(testInfo.outputPath('user-data'), {
      env: { MINERVA_TEST_CONFIRM: confirmAnswer },
    })
    await use(app)
    await closeMinerva(app)
  },
})

const aside = (page: Page) => page.locator('aside')
const AZURE_REPOS = [
  'contoso/Platform/orders-api',
  'contoso/Platform/storefront-web',
  'contoso/Platform/platform-infra',
]
const azureRepo = {
  provider: 'azure',
  organization: 'contoso',
  project: 'Platform',
  name: 'orders-api',
  repositoryId: '11111111-1111-4111-8111-111111111111',
  fullName: 'contoso/Platform/orders-api',
}

test('Azure repos listed with the Azure icon; detail, diff and thread statuses', async ({
  window,
}, testInfo) => {
  // Auth: the mock is signed in, and never exposes a credential.
  const auth = await window.evaluate(() => window.minerva.scm.getAuthStatus())
  expect(auth.azure).toMatchObject({
    provider: 'azure',
    state: 'signed_in',
    user: { login: 'ada@contoso.example', displayName: 'Ada Lovelace' },
    credentialSource: 'az-devops-pat',
  })
  expect(JSON.stringify(auth)).not.toMatch(/Basic |Bearer /)

  // Repos view: one group per Azure repo, each with the Azure provider icon.
  await openReposView(window)
  for (const fullName of AZURE_REPOS) {
    const header = aside(window).getByRole('button', { name: new RegExp(fullName) })
    await expect(header).toBeVisible()
    await expect(header.locator('[data-provider="azure"]')).toHaveCount(1)
  }
  await expect(aside(window).getByText('Fix cart rounding').first()).toBeVisible()
  await attachScreenshot(window, testInfo, 'azure-list')

  // Detail of #108.
  await aside(window).getByText('Fix cart rounding').first().click()
  await openPrDetails(window)
  await expect(window.getByText('Open in Azure DevOps').first()).toBeVisible()
  await expect(window.getByRole('list', { name: 'Reviewers' })).toContainText('Ada Lovelace')
  await expect(window.getByRole('list', { name: 'Work items' })).toContainText(
    'Cart total is off by a cent',
  )

  // Threads: Azure-only statuses render as badges.
  for (const status of ['pending', 'wont_fix', 'by_design', 'closed']) {
    await expect(window.locator('[data-thread-status="' + status + '"]').first()).toBeVisible()
  }
  await expect(window.getByText('Pending: should this accept readonly arrays?')).toBeVisible()
  // System and deleted threads are filtered out.
  await expect(window.getByText('Ada Lovelace voted 10')).toHaveCount(0)
  await expect(window.getByText('Never mind.')).toHaveCount(0)
  await attachScreenshot(window, testInfo, 'azure-conversation')

  // Files: the patch was built in main from blobs.
  await window
    .getByText(/^Files/)
    .first()
    .click()
  await expect(window.getByText('@@').first()).toBeVisible()
  await expect(
    window.getByText('Math.round(item.price * 100) * item.qty', { exact: false }).first(),
  ).toBeVisible()
  await attachScreenshot(window, testInfo, 'azure-diff')
})

test('Azure: renamed + binary files, and an outdated thread', async ({ window }, testInfo) => {
  await aside(window).getByText('Rename network module').first().click()
  await window
    .getByText(/^Files/)
    .first()
    .click()
  await expect(window.getByText('virtual-network').first()).toBeVisible()
  await window.getByText('logo.png').first().click()
  await expect(window.getByText(/No preview available|[Ss]in vista previa/).first()).toBeVisible()
  await attachScreenshot(window, testInfo, 'azure-rename-binary')

  await aside(window).getByText('Checkout v2: submit validation').first().click()
  await expect(window.getByText('Validate the status before saving.')).toBeVisible()
  await expect(window.getByText('Outdated').first()).toBeVisible()
})

test('Azure channels via the preload: stacks + orphan, file content, status, retarget', async ({
  window,
}) => {
  // scm:getStacks: the mock stacks, with #105 orphaned (its parent #100 merged).
  const stacks = await window.evaluate(() => window.minerva.scm.getStacks())
  expect(stacks.errors).toEqual([])
  const azureStacks = stacks.stacks.filter(
    (stack: { repo: { provider: string } }) => stack.repo.provider === 'azure',
  )
  const summary = azureStacks.map(
    (stack: {
      repo: { name: string }
      root: { number: number; orphan?: unknown }
      size: number
      groupKey?: string
    }) => ({
      repo: stack.repo.name,
      root: stack.root.number,
      size: stack.size,
      group: stack.groupKey,
      orphan: stack.root.orphan,
    }),
  )
  expect(summary).toEqual([
    {
      repo: 'orders-api',
      root: 101,
      size: 3,
      group: 'azure:contoso:feature/checkout-v2-models',
      orphan: undefined,
    },
    {
      repo: 'orders-api',
      root: 105,
      size: 1,
      group: undefined,
      orphan: {
        parent: { number: 100, title: 'Add refunds table', mergedInto: 'main' },
        targetBranchExists: true,
        suggestedBase: 'main',
      },
    },
    {
      repo: 'storefront-web',
      root: 110,
      size: 2,
      group: 'azure:contoso:feature/checkout-v2-models',
      orphan: undefined,
    },
  ])

  // scm:getFileContent: both sides of the file a comment sits outside the hunks of.
  const content = await window.evaluate(
    (repo) =>
      window.minerva.scm.getFileContent({
        repo,
        number: 102,
        path: 'src/Services/CheckoutService.cs',
        side: 'head',
      }),
    azureRepo,
  )
  expect(content.isBinary).toBe(false)
  expect(content.content).toContain('// Line 12: kept as context.')

  // scm:setThreadStatus with an Azure-only status.
  const thread = await window.evaluate(
    (repo) =>
      window.minerva.scm.setThreadStatus({ repo, number: 105, threadId: '1', status: 'by_design' }),
    azureRepo,
  )
  expect(thread).toMatchObject({ id: '1', status: 'by_design', isResolved: true })

  // scm:retarget: a stale expected base is a CONFLICT; the right one fixes the orphan.
  const conflict = await window.evaluate(
    (repo) =>
      window.minerva.scm
        .retarget({ repo, number: 105, expectedCurrentBase: 'develop', newBase: 'main' })
        .then(
          () => 'no error',
          (error: Error) => error.message,
        ),
    azureRepo,
  )
  expect(conflict).toContain('[SCM:CONFLICT]')

  const retargeted = await window.evaluate(
    (repo) =>
      window.minerva.scm.retarget({
        repo,
        number: 105,
        expectedCurrentBase: 'feature/refund-schema',
        newBase: 'main',
      }),
    azureRepo,
  )
  expect(retargeted).toMatchObject({ outcome: 'retargeted', pr: { number: 105, baseRef: 'main' } })

  const after = await window.evaluate(() => window.minerva.scm.getStacks())
  expect(
    after.stacks.some((stack: { root: { number: number } }) => stack.root.number === 105),
  ).toBe(false)
})

test('Settings shows the Azure DevOps section with auth and the mock org', async ({
  window,
}, testInfo) => {
  await window
    .locator('button:has(svg.lucide-settings), button:has([class*="lucide-settings"])')
    .first()
    .click()
  await window.getByTestId('settings-nav-azure').click()
  await expect(window.getByTestId('settings-current-page')).toHaveText('Azure DevOps')
  const section = window.getByTestId('azure-devops-settings')
  await expect(section).toBeVisible()
  await expect(section.locator('[data-azure-auth="signed_in"]')).toContainText(
    'Signed in as Ada Lovelace (ada@contoso.example) via the PAT saved by az devops login.',
  )
  await expect(section.getByRole('checkbox', { name: 'Enable Azure DevOps' })).toBeChecked()
  await expect(section.locator('#azure-org')).toHaveValue('contoso')
  await section.getByRole('button', { name: 'Load projects' }).click()
  await expect(section.getByRole('list', { name: 'Azure DevOps projects' })).toContainText(
    'Platform',
  )
  await attachScreenshot(window, testInfo, 'azure-settings')

  // Turning Azure off removes its PRs from the list (the registry honors the flag).
  await section.getByRole('checkbox', { name: 'Enable Azure DevOps' }).uncheck()
  await section.getByRole('button', { name: 'Save' }).click()
  await expect(section.locator('[data-azure-auth="disabled"]')).toBeVisible()
  const settings = await window.evaluate(() => window.minerva.scm.getSettings())
  expect(settings.providers.azure.enabled).toBe(false)
  const listed = await window.evaluate(() => window.minerva.scm.listPullRequests({}))
  expect(
    listed.items.some((pr: { repo: { provider: string } }) => pr.repo.provider === 'azure'),
  ).toBe(false)
})

test('AI (MINERVA_MOCK_AI=1) analyzes an Azure PR through the real context pipeline', async ({
  window,
}, testInfo) => {
  const webRepo = {
    ...azureRepo,
    name: 'storefront-web',
    repositoryId: '22222222-2222-4222-8222-222222222222',
    fullName: 'contoso/Platform/storefront-web',
  }
  const analysis = await window.evaluate(
    (repo) => window.minerva.ai.analyzePullRequest({ repo, number: 108 }),
    webRepo,
  )
  const detail = await window.evaluate(
    (repo) => window.minerva.scm.getPullRequestDetail({ repo, number: 108 }),
    webRepo,
  )
  expect(analysis.headSha).toBe(detail.headSha)
  expect(analysis.sections[0].kind).toBe('summary')
  expect(analysis.sections[0].markdown).toContain('repository snapshot ready')
  expect(analysis.sections[0].markdown).toContain('src/cart/total.ts')

  // And the panel shows it for the PR.
  await aside(window).getByText('Fix cart rounding').first().click()
  await openAnalysisTab(window)
  await expect(window.getByText('repository snapshot ready').first()).toBeVisible()
  await openPrDetails(window)
  await expect(window.getByText('Open in Azure DevOps').first()).toBeVisible()
  await attachScreenshot(window, testInfo, 'azure-ai-summary')
})

test.describe('when the user declines the native confirmation', () => {
  test.use({ confirmAnswer: 'decline' })

  test('retarget answers cancelled and writes nothing', async ({ window }) => {
    const result = await window.evaluate(
      (repo) =>
        window.minerva.scm.retarget({
          repo,
          number: 105,
          expectedCurrentBase: 'feature/refund-schema',
          newBase: 'main',
        }),
      azureRepo,
    )
    expect(result).toEqual({ outcome: 'cancelled' })

    const detail = await window.evaluate(
      (repo) => window.minerva.scm.getPullRequestDetail({ repo, number: 105 }),
      azureRepo,
    )
    expect(detail.baseRef).toBe('feature/refund-schema')
    const stacks = await window.evaluate(() => window.minerva.scm.getStacks({ refresh: true }))
    expect(
      stacks.stacks.find((stack: { root: { number: number } }) => stack.root.number === 105)?.root
        .orphan?.suggestedBase,
    ).toBe('main')
  })

  test('a new Azure organization is not saved, and its projects are not loaded', async ({
    window,
  }) => {
    const before = await window.evaluate(() => window.minerva.scm.getSettings())
    const after = await window.evaluate(() =>
      window.minerva.scm.setProviderSettings({
        azure: { enabled: true, organizations: [{ organization: 'fabrikam', projects: ['Web'] }] },
      }),
    )
    expect(after).toEqual(before)
    expect(after.azureSettingsSource).toBe('none')

    const projects = await window.evaluate(() =>
      window.minerva.scm.listAzureProjects({ organization: 'fabrikam' }).then(
        () => 'loaded',
        (error: Error) => error.message,
      ),
    )
    expect(projects).toContain('[SCM:FORBIDDEN]')
    // The configured mock org needs no confirmation.
    await expect(
      window.evaluate(() => window.minerva.scm.listAzureProjects({ organization: 'contoso' })),
    ).resolves.toEqual({ projects: ['Platform'] })
  })
})
