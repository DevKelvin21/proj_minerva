import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  test,
  expect,
  attachScreenshot,
  closeMinerva,
  launchMinerva,
  setViewport,
  type MinervaApp,
  type Page,
} from './fixtures'

/**
 * Provider-aware UI: the header, the connection indicator, the sidebar's
 * sign-in and search help and the PR detail follow the ENABLED providers.
 *
 * The `gh` probe is real even with mock data, so GitHub's state is forced
 * with `MINERVA_MOCK_GH_AUTH` (and Azure's with `MINERVA_MOCK_AZURE_AUTH`,
 * both honored only with `MINERVA_MOCK=1`). "GitHub disabled" is seeded in
 * the isolated userData's settings.json before launch.
 */

interface Seed {
  github: boolean
  language?: 'en' | 'es'
}

function seedSettings(userDataDir: string, seed: Seed): void {
  mkdirSync(userDataDir, { recursive: true })
  const settings = {
    aiProvider: 'opencode',
    models: {},
    scm: {
      github: { enabled: seed.github },
      azure: {
        enabled: true,
        organizations: [{ organization: 'contoso', projects: ['Platform'] }],
      },
    },
    ...(seed.language ? { language: seed.language } : {}),
  }
  writeFileSync(join(userDataDir, 'settings.json'), JSON.stringify(settings, null, 2))
}

async function launch(
  userDataDir: string,
  seed: Seed | null,
  env: Record<string, string>,
): Promise<{ app: MinervaApp; page: Page }> {
  if (seed) seedSettings(userDataDir, seed)
  const app = await launchMinerva(userDataDir, { env })
  let page = app.context.pages().find((p) => !p.url().includes('#didactic'))
  if (!page) page = await app.context.waitForEvent('page', { timeout: 15_000 })
  await page.waitForLoadState('domcontentloaded')
  // xl tier: every chip shows its identity and "via …" badge.
  await setViewport(page, 1600, 1000)
  return { app, page }
}

const chip = (page: Page, provider: 'github' | 'azure') =>
  page.locator('header [data-auth-provider="' + provider + '"]')
const indicator = (page: Page) => page.getByTestId('scm-connection')
/** Signed-in providers live in the title bar's accounts menu; this opens it. */
async function openAccounts(page: Page): Promise<void> {
  const button = page.getByTestId('accounts-menu')
  if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click()
  await expect(page.locator('#accounts-menu-panel')).toBeVisible()
}
const aside = (page: Page) => page.locator('aside[aria-label]')
/** Rendered text only (not aria-labels or titles). */
const visibleText = (page: Page) => page.evaluate(() => document.body.innerText)

async function openSettings(page: Page): Promise<void> {
  await page
    .locator('button:has(svg.lucide-settings), button:has([class*="lucide-settings"])')
    .first()
    .click()
  await expect(page.getByTestId('azure-devops-settings')).toBeVisible()
}

// eslint-disable-next-line no-empty-pattern
test('Azure only: Azure identity in the header, no GitHub text, Azure parity in the detail', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('user-data'), { github: false }, {})
  try {
    await expect(aside(page).getByText('Fix cart rounding').first()).toBeVisible({
      timeout: 20_000,
    })

    // Accounts menu: one chip, Azure, signed in, with how the credential was obtained.
    await expect(indicator(page)).toHaveAttribute('data-connection', 'connected', {
      timeout: 20_000,
    })
    await openAccounts(page)
    await expect(chip(page, 'azure')).toHaveAttribute('data-auth-state', 'ready')
    await expect(chip(page, 'azure')).toContainText('Ada Lovelace')
    await expect(chip(page, 'azure')).toContainText('via az devops PAT')
    await expect(chip(page, 'github')).toHaveCount(0)
    await expect(indicator(page)).toHaveAttribute('data-connection', 'connected')
    await expect(indicator(page)).toHaveText('Connected')
    await expect(indicator(page)).toHaveAttribute(
      'title',
      /Azure DevOps: signed in as Ada Lovelace/,
    )
    await expect(indicator(page)).not.toHaveAttribute('title', /GitHub/)
    await page.keyboard.press('Escape')
    await expect(page.locator('#accounts-menu-panel')).toHaveCount(0)

    // PR list chip in Azure terms: #105 has a -10 vote.
    const pr105 = aside(page).locator('button', { hasText: 'Refund ledger' })
    await expect(pr105.locator('[data-review]')).toHaveAttribute('data-review', 'rejected')
    await expect(pr105.locator('[data-review]')).toHaveAttribute('title', 'Rejected')

    // Detail #101: tags, auto-complete, branch policies (required + optional).
    await aside(page).getByText('Checkout v2: order status and currency').first().click()
    await expect(page.getByText('Open in Azure DevOps').first()).toBeVisible()
    await expect(page.getByRole('list', { name: 'Tags' })).toContainText('checkout-v2')
    await expect(page.locator('[data-auto-complete]')).toContainText(
      'Auto-complete set by Ada Lovelace',
    )
    const policies = page.getByRole('list', { name: 'Branch policies' })
    await expect(policies).toContainText('orders-api CI')
    await expect(policies).toContainText('Minimum number of reviewers')
    await expect(policies.locator('li', { hasText: 'Comment requirements' })).toContainText(
      'optional',
    )
    await expect(
      page.getByRole('list', { name: 'Reviewers' }).locator('li').first(),
    ).toHaveAttribute('data-required', 'true')
    await attachScreenshot(page, testInfo, 'azure-only-header-detail-en')

    // #102: a -5 vote reads "Waiting for author"; #105: conflicts + "Rejected".
    await aside(page).getByText('Checkout v2: submit validation').first().click()
    await expect(page.getByRole('list', { name: 'Reviewers' })).toContainText('Waiting for author')
    await aside(page).getByText('Refund ledger').first().click()
    await expect(page.locator('[data-merge-status="conflicts"]')).toHaveText('Merge conflicts')
    await expect(page.getByRole('list', { name: 'Reviewers' })).toContainText('Rejected')
    await attachScreenshot(page, testInfo, 'azure-only-conflicts-en')

    // Nothing visible names GitHub or its CLI.
    expect(await visibleText(page)).not.toMatch(/GitHub|gh auth/)

    // Settings: GitHub's install guide and account picker are gone while it is off.
    await openSettings(page)
    await expect(page.getByText('GitHub access').first()).toBeVisible()
    await expect(page.getByText('cli.github.com')).toHaveCount(0)
    await expect(page.getByText('gh active account')).toHaveCount(0)
    await page.keyboard.press('Escape')

    // Spanish.
    await page.evaluate(() => window.minerva.settings.setLanguage({ language: 'es' }))
    await openAccounts(page)
    await expect(chip(page, 'azure')).toContainText('vía PAT de az devops')
    await expect(indicator(page)).toHaveText('Conectado')
    await expect(page.getByRole('list', { name: 'Revisores' })).toContainText('Rechazado')
    await expect(page.locator('[data-merge-status="conflicts"]')).toHaveText('Conflictos de merge')
    await aside(page).getByText('Checkout v2: order status and currency').first().click()
    await expect(page.getByRole('list', { name: 'Directivas de rama' })).toContainText('opcional')
    expect(await visibleText(page)).not.toMatch(/GitHub|gh auth/)
    await attachScreenshot(page, testInfo, 'azure-only-header-detail-es')
  } finally {
    await closeMinerva(app)
  }
})

// eslint-disable-next-line no-empty-pattern
test('both providers: one chip each; a missing gh CLI reads as a partial connection', async ({}, testInfo) => {
  // Both signed in.
  const both = await launch(testInfo.outputPath('user-data-both'), null, {
    MINERVA_MOCK_GH_AUTH: 'signed_in',
  })
  try {
    await expect(both.page.getByText('apply-coupon').first()).toBeVisible({ timeout: 20_000 })
    await openAccounts(both.page)
    await expect(chip(both.page, 'github')).toHaveAttribute('data-auth-state', 'ready')
    await expect(chip(both.page, 'github')).toContainText('mgarcia')
    await expect(chip(both.page, 'github')).toContainText('via GitHub CLI')
    await expect(chip(both.page, 'azure')).toContainText('Ada Lovelace')
    await expect(chip(both.page, 'azure')).toContainText('via az devops PAT')
    await expect(indicator(both.page)).toHaveText('Connected')
    await attachScreenshot(both.page, testInfo, 'both-signed-in-en')

    // Tiled (md tier): the bar keeps only the accounts button; its title names everyone.
    await both.page.keyboard.press('Escape')
    await setViewport(both.page, 900, 800)
    await expect(chip(both.page, 'azure')).toHaveCount(0)
    await expect(indicator(both.page)).toHaveAttribute(
      'title',
      /Azure DevOps: signed in as Ada Lovelace via az devops PAT/,
    )
    await openAccounts(both.page)
    await expect(chip(both.page, 'azure')).toContainText('Ada Lovelace')
    await attachScreenshot(both.page, testInfo, 'both-signed-in-md')
  } finally {
    await closeMinerva(both.app)
  }

  // gh missing: Azure still lists, GitHub says why, the indicator is partial.
  const partial = await launch(testInfo.outputPath('user-data-partial'), null, {
    MINERVA_MOCK_GH_AUTH: 'cli_unavailable',
  })
  try {
    await expect(aside(partial.page).getByText('Fix cart rounding').first()).toBeVisible({
      timeout: 20_000,
    })
    await expect(chip(partial.page, 'github')).toHaveAttribute('data-auth-state', 'cli_unavailable')
    await expect(chip(partial.page, 'github')).toContainText('GitHub CLI not found')
    // GitHub needs the user, so its chip stays in the bar; Azure is in the menu.
    await expect(chip(partial.page, 'azure')).toHaveCount(0)
    await openAccounts(partial.page)
    await expect(chip(partial.page, 'azure')).toHaveAttribute('data-auth-state', 'ready')
    await expect(partial.page.locator('#accounts-menu-panel')).toContainText('GitHub: CLI not found')
    await expect(indicator(partial.page)).toHaveAttribute('data-connection', 'partial')
    await expect(indicator(partial.page)).toHaveText('Partially connected')
    await expect(indicator(partial.page)).toHaveAttribute('title', /GitHub: CLI not found/)
    await expect(
      aside(partial.page).locator('[data-error-code="CLI_UNAVAILABLE"]').first(),
    ).toContainText('GitHub')
    await attachScreenshot(partial.page, testInfo, 'partial-gh-missing-en')
    await partial.page.keyboard.press('Escape')

    await partial.page.evaluate(() => window.minerva.settings.setLanguage({ language: 'es' }))
    await expect(indicator(partial.page)).toHaveText('Conectado en parte')
    await expect(chip(partial.page, 'github')).toContainText('No se encontró GitHub CLI')
    await attachScreenshot(partial.page, testInfo, 'partial-gh-missing-es')
  } finally {
    await closeMinerva(partial.app)
  }
})

// eslint-disable-next-line no-empty-pattern
test('Azure only and signed out: Azure sign-in instructions, never GitHub ones', async ({}, testInfo) => {
  const { app, page } = await launch(
    testInfo.outputPath('user-data'),
    { github: false },
    { MINERVA_MOCK_AZURE_AUTH: 'unauthenticated' },
  )
  try {
    const signIn = page.getByTestId('sign-in-needed')
    await expect(signIn).toBeVisible({ timeout: 20_000 })
    await expect(signIn.locator('[data-sign-in="azure"]')).toContainText(
      'az devops login --organization https://dev.azure.com/contoso',
    )
    await expect(signIn.locator('[data-sign-in="github"]')).toHaveCount(0)

    await expect(chip(page, 'azure')).toHaveAttribute('data-auth-state', 'signed_out')
    await expect(chip(page, 'azure').getByRole('button')).toHaveText('az devops login')
    await expect(chip(page, 'github')).toHaveCount(0)
    await expect(indicator(page)).toHaveText('Not signed in')

    expect(await visibleText(page)).not.toMatch(/GitHub|gh auth/)
    await attachScreenshot(page, testInfo, 'azure-signed-out-en')

    await page.evaluate(() => window.minerva.settings.setLanguage({ language: 'es' }))
    await expect(indicator(page)).toHaveText('Sin sesión')
    await expect(signIn).toContainText('Inicia sesión con Azure CLI')
    expect(await visibleText(page)).not.toMatch(/GitHub|gh auth/)
    await attachScreenshot(page, testInfo, 'azure-signed-out-es')
  } finally {
    await closeMinerva(app)
  }
})
