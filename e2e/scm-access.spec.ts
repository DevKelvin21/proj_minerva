import { test, expect, attachScreenshot, openPrDetails } from './fixtures'
import type { Page } from './fixtures'

/**
 * Source-control access. GitHub goes through the `gh` CLI token bridge only
 * (the OAuth device flow is gone). Azure DevOps runs on its mock here
 * (`azure-mock.spec.ts` covers it): signed in, org "contoso".
 *
 * With MINERVA_MOCK=1 the DATA is mock but the `gh` probe is REAL
 * (gh-cli-auth.ts: resolveCliPath + execFile + GET /user), so state checks
 * accept whatever the probe yields on this machine (signed_in /
 * cli_unavailable / cli_unauthenticated): we verify "gh branch", not a
 * specific session.
 *
 * The account step uses a login that exists in no `gh` (`--user` with an
 * unknown account always fails), so it's deterministic on any machine.
 */

const GHOST_ACCOUNT = 'minerva-e2e-missing-account'

const openSettingsModal = async (page: Page) => {
  await page
    .locator('button:has(svg.lucide-settings), button:has([class*="lucide-settings"])')
    .first()
    .click()
  await page.getByTestId('settings-nav-github').click()
  await expect(page.getByText('List pull requests from GitHub').first()).toBeVisible()
}

const card = (page: Page, label: string) => page.locator('button', { hasText: label }).first()

test('gh-only GitHub access, Azure mock signed in, and the account picker', async ({
  window,
}, testInfo) => {
  // 1. Contract: SCM settings expose the mock flag and the chosen account;
  //    the OAuth channels no longer exist.
  const initial = await window.evaluate(() => window.minerva.scm.getSettings())
  expect(initial).toEqual({
    mockScm: true,
    githubAccount: null,
    providers: {
      github: { enabled: true },
      azure: {
        enabled: true,
        organizations: [{ organization: 'contoso', projects: ['Platform'] }],
      },
    },
    azureSettingsSource: 'none',
  })
  const legacyChannels = await window.evaluate(() => ({
    auth: 'auth' in window.minerva,
    github: 'github' in window.minerva,
  }))
  expect(legacyChannels, 'auth:* and github:* channels are gone').toEqual({
    auth: false,
    github: false,
  })

  // 2. scm:getAuthStatus: GitHub on the gh branch, Azure mock signed in, no tokens.
  const auth = await window.evaluate(() => window.minerva.scm.getAuthStatus())
  expect(auth.github.provider).toBe('github')
  expect(
    ['signed_in', 'cli_unavailable', 'cli_unauthenticated'],
    'valid gh state (real probe on this machine)',
  ).toContain(auth.github.state)
  expect(auth.azure).toMatchObject({ provider: 'azure', state: 'signed_in' })
  expect(JSON.stringify(auth), 'auth status NEVER carries a token').not.toMatch(/gh[pousr]_/)

  // 3. Settings "Source control": gh guide, probe feedback, picker, Azure line.
  await openSettingsModal(window)
  await expect(window.getByText('Demo mode (MINERVA_MOCK)').first()).toBeVisible()
  // The sign-in help (install link + `gh auth login`) shows only while gh is signed out.
  if (auth.github.state === 'signed_in') {
    await expect(window.getByText('cli.github.com')).toHaveCount(0)
  } else {
    await expect(window.getByText('cli.github.com').first()).toBeVisible()
    await expect(window.getByText('gh auth login').first()).toBeVisible()
  }
  await expect(
    window.getByText(/via gh|GitHub CLI not found|No gh session|has no valid session/).first(),
    'real probe feedback',
  ).toBeVisible()
  await expect(card(window, 'gh active account'), 'default marked Active').toContainText('Active')
  await attachScreenshot(window, testInfo, 'scm-access-settings')
  await window.getByTestId('settings-nav-azure').click()
  await expect(window.getByTestId('azure-devops-settings')).toContainText(
    'Signed in as Ada Lovelace',
  )
  await window.getByTestId('settings-nav-github').click()

  // 4. Pick a specific account over IPC (the machine's real accounts are not
  //    predictable): persisted, and the probe names it in `detail`.
  await window.evaluate((login) => window.minerva.scm.setGithubAccount({ login }), GHOST_ACCOUNT)
  const withAccount = await window.evaluate(() => window.minerva.scm.getAuthStatus())
  expect(
    ['cli_unavailable', 'cli_unauthenticated'],
    'a missing account can never be signed_in',
  ).toContain(withAccount.github.state)
  if (withAccount.github.state === 'cli_unauthenticated') {
    expect(withAccount.github.detail, 'the status says WHICH account failed').toContain(
      GHOST_ACCOUNT,
    )
  }

  // 5. The UI shows the orphaned account instead of an invisible selection.
  //    Reload: step 4 wrote over raw IPC, which doesn't refresh the store.
  await window.reload()
  await expect(window.getByText('apply-coupon').first()).toBeVisible({ timeout: 20_000 })
  await openSettingsModal(window)
  await expect(card(window, GHOST_ACCOUNT)).toBeVisible()
  await expect(card(window, GHOST_ACCOUNT)).toContainText('No longer in gh')
  await attachScreenshot(window, testInfo, 'scm-access-orphaned-account')

  // 6. Back to "gh active account" THROUGH THE UI.
  await card(window, 'gh active account').click()
  await expect(card(window, 'gh active account')).toContainText('Active')
  const cleared = await window.evaluate(() =>
    window.minerva.scm.getSettings().then((s) => s.githubAccount),
  )
  expect(cleared, 'the chosen account was cleared').toBeNull()

  // 7. Close the modal: the TitleBar is on the gh branch, with no OAuth UI left
  //    (a signed-in provider shows in the accounts menu, a missing one in the bar).
  await window.keyboard.press('Escape')
  await window.getByTestId('accounts-menu').click()
  await expect
    .poll(
      () =>
        window.evaluate(() => {
          const t = document.body.textContent ?? ''
          return {
            gh:
              t.includes('via GitHub CLI') ||
              t.includes('GitHub CLI not found') ||
              t.includes('Waiting for session'),
            oauth: t.includes('Iniciar sesión con GitHub') || t.includes('login/device'),
          }
        }),
      { message: 'TitleBar on the gh branch, no OAuth branch' },
    )
    .toEqual({ gh: true, oauth: false })
})

test('repo groups show a provider marker and reviewers show their vote', async ({
  window,
}, testInfo) => {
  await expect(window.getByText('apply-coupon').first()).toBeVisible({ timeout: 20_000 })
  const aside = window.locator('aside[aria-label="Pull request list"]')
  await expect(aside.locator('[data-provider="github"]').first()).toBeVisible()

  // #470 (shopwave/api) is approved in the mock universe.
  await aside.getByText('#470').first().click()
  await openPrDetails(window)
  const reviewers = window.getByRole('list', { name: 'Reviewers' })
  await expect(reviewers.locator('[data-vote="approved"]')).toContainText('Approved')
  await expect(window.getByText('Open in GitHub').first()).toBeVisible()
  await attachScreenshot(window, testInfo, 'scm-reviewer-votes')
})
