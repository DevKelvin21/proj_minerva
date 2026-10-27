import {
  test,
  expect,
  launchMinerva,
  closeMinerva,
  mainWindow,
  setViewport,
  attachScreenshot,
} from './fixtures'
import type { Page } from './fixtures'

/**
 * Home dashboard (mock Azure org "contoso", signed in as Ada; GitHub mock
 * "shopwave" as mgarcia when `MINERVA_MOCK_GH_AUTH=signed_in`):
 * - overview with feature cards (tags shared across repos of ONE org) and
 *   repo cards; repo page with viewer filters, text filter and the stack
 *   board; feature page with rename / hide; the review view's stack
 *   navigator; the hideable docked sidebar; tiled sizes.
 *
 * Contoso facts used below: Ada authored #101-#103 (orders-api), is a
 * required reviewer on #105 (orders-api), #106 (platform-infra), #108
 * (storefront-web), optional on #104/#110 (storefront-web), uninvolved in
 * #111 (platform-infra), #112 (orders-api), #113 (storefront-web). Tag
 * `checkout-v2`: #101, #104, #110, #111; tag `bug`: #108, #112.
 */

const CHECKOUT_KEY = 'azure:contoso:checkout-v2'
const BUG_KEY = 'azure:contoso:bug'
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'

const overview = (page: Page) => page.getByTestId('home-overview')
const repoPage = (page: Page) => page.getByTestId('repo-page')
const featurePage = (page: Page) => page.getByTestId('feature-page')
const repoCard = (page: Page, name: string) =>
  page.getByTestId('repo-card').filter({ hasText: name })
const featureCard = (page: Page, key: string) =>
  page.locator(`[data-testid="feature-card"][data-feature-key="${key}"]`)
const filterChip = (page: Page, id: string) => page.getByTestId('repo-filter-' + id)
const sidebar = (page: Page) => page.getByRole('complementary', { name: 'Pull request list' })
const prHeader = (page: Page) => page.locator('header:has(h1)')

/**
 * The main window WITHOUT `mainWindow()`'s wait for the PR list: after a
 * relaunch with the sidebar collapsed there is no list text to wait for.
 */
async function rawWindow(app: Awaited<ReturnType<typeof launchMinerva>>): Promise<Page> {
  let page = app.context.pages().find((p) => !p.url().includes('#didactic'))
  if (!page) page = await app.context.waitForEvent('page', { timeout: 15_000 })
  await page.waitForLoadState('domcontentloaded')
  await expect(page.getByTestId('home-button')).toBeVisible({ timeout: 20_000 })
  return page
}

/**
 * "Needs my review" per repo name, computed from the dashboard answer the UI
 * renders (required reviewer with no vote yet): the mock's vote states are
 * main's business, the cards must agree with whatever it reports.
 */
async function needsReviewByRepo(page: Page): Promise<Record<string, number>> {
  return page.evaluate(async () => {
    const result = await window.minerva.scm.getDashboard()
    const counts: Record<string, number> = {}
    for (const pr of result.pullRequests) {
      const viewer = pr.viewer
      if (!viewer || viewer.reviewer !== 'required') continue
      const vote = viewer.vote ?? 'none'
      if (vote !== 'none') continue
      counts[pr.repo.name] = (counts[pr.repo.name] ?? 0) + 1
    }
    return counts
  })
}

async function openRepo(page: Page, name: string): Promise<void> {
  await repoCard(page, name).click({ timeout: 20_000 })
  await expect(repoPage(page)).toBeVisible()
}

/** Visible cards whose text contains `needle` (after the viewer filter). */
const visibleCards = (page: Page) =>
  page.locator('[data-testid="pr-card"], [data-testid="stack-card"]')

test('overview: feature and repo cards; Home from a repo page and a feature page lands on the overview', async ({
  window,
}, testInfo) => {
  await setViewport(window, 1600, 1000)
  await expect(overview(window)).toBeVisible()

  const checkout = featureCard(window, CHECKOUT_KEY)
  await expect(checkout).toBeVisible({ timeout: 20_000 })
  await expect(checkout).toContainText('3 repositories')
  await expect(checkout).toContainText('4 PRs')
  await expect(checkout).toContainText('of 4 approved')
  // `bug` is shared by orders-api and storefront-web only, within contoso.
  const bug = featureCard(window, BUG_KEY)
  await expect(bug).toBeVisible()
  await expect(bug).toContainText('orders-api')
  await expect(bug).toContainText('storefront-web')
  await expect(bug).not.toContainText('shopwave')

  const ordersApi = repoCard(window, 'orders-api')
  await expect(ordersApi).toContainText('5 open')
  await expect(ordersApi).toContainText('3 yours')
  await expect(ordersApi).toContainText('1 stack')
  await expect(ordersApi).toContainText('1 orphan')
  await expect(repoCard(window, 'storefront-web')).toContainText('2 optional')
  // "N to review" badges and the header total follow the data main reports.
  const needsReview = await needsReviewByRepo(window)
  for (const name of ['orders-api', 'storefront-web', 'platform-infra']) {
    const count = needsReview[name] ?? 0
    if (count > 0) await expect(repoCard(window, name)).toContainText(count + ' to review')
    else await expect(repoCard(window, name)).not.toContainText('to review')
  }
  const total = Object.values(needsReview).reduce((sum, n) => sum + n, 0)
  if (total > 0) {
    await expect(overview(window)).toContainText(total + ' need')
  } else {
    await expect(overview(window)).not.toContainText('your review')
  }
  await attachScreenshot(window, testInfo, 'home-overview')

  // Home button from a repo page and from a feature page: both land on the overview.
  await openRepo(window, 'orders-api')
  await window.getByTestId('home-button').click()
  await expect(overview(window)).toBeVisible()
  await expect(repoPage(window)).toHaveCount(0)
  await checkout.click()
  await expect(featurePage(window)).toBeVisible()
  await window.getByTestId('home-button').click()
  await expect(overview(window)).toBeVisible()
  await expect(featurePage(window)).toHaveCount(0)
})

test('repo page: filter chips with counts, results per role, reset to All on another repo', async ({
  window,
}, testInfo) => {
  await setViewport(window, 1600, 1000)
  await openRepo(window, 'orders-api')
  await expect(window.getByTestId('stack-board')).toBeVisible({ timeout: 20_000 })
  for (const [id, count] of [
    ['all', '5'],
    ['required', '1'],
    ['optional', '0'],
    ['mine', '3'],
    ['unassigned', '1'],
  ] as const) {
    await expect(filterChip(window, id)).toContainText(count)
  }
  await expect(filterChip(window, 'all')).toHaveAttribute('aria-pressed', 'true')
  await attachScreenshot(window, testInfo, 'repo-page')

  // Required: only the orphan #105 stack stays; the chain is hidden.
  await filterChip(window, 'required').click()
  await expect(visibleCards(window).filter({ hasText: '#105' })).toBeVisible()
  await expect(visibleCards(window).filter({ hasText: '#101' })).toHaveCount(0)
  await expect(repoPage(window)).toContainText('1 stack hidden by the filter')
  await expect(repoPage(window)).toContainText('No pull request matches')

  // Mine: the chain #101-#103 shows, #105 and #112 do not.
  await filterChip(window, 'mine').click()
  await expect(visibleCards(window).filter({ hasText: '#101' })).toBeVisible()
  await expect(visibleCards(window).filter({ hasText: '#103' })).toBeVisible()
  await expect(visibleCards(window).filter({ hasText: '#105' })).toHaveCount(0)
  await expect(visibleCards(window).filter({ hasText: '#112' })).toHaveCount(0)

  // Not assigned to me: only #112 (a loose PR); no stack qualifies.
  await filterChip(window, 'unassigned').click()
  await expect(visibleCards(window).filter({ hasText: '#112' })).toBeVisible()
  await expect(window.getByTestId('stack-card')).toHaveCount(0)

  // Optional reviewer on storefront-web: #104 and #110 (its stack), nothing else.
  await window.getByTestId('home-back').click()
  await openRepo(window, 'storefront-web')
  // Another repo starts at "All".
  await expect(filterChip(window, 'all')).toHaveAttribute('aria-pressed', 'true')
  await expect(filterChip(window, 'optional')).toContainText('2')
  await expect(filterChip(window, 'required')).toContainText('1')
  await filterChip(window, 'optional').click()
  await expect(visibleCards(window).filter({ hasText: '#104' })).toBeVisible()
  await expect(visibleCards(window).filter({ hasText: '#110' })).toBeVisible()
  await expect(visibleCards(window).filter({ hasText: '#108' })).toHaveCount(0)
  await expect(visibleCards(window).filter({ hasText: '#113' })).toHaveCount(0)

  // Text filter narrows the loose list.
  await filterChip(window, 'all').click()
  await window.getByLabel('Filter the pull requests of this repository').fill('lazy')
  await expect(visibleCards(window).filter({ hasText: '#113' })).toBeVisible()
  await expect(visibleCards(window).filter({ hasText: '#108' })).toHaveCount(0)
})

test('feature page: Esc cancels a rename, reset to tag, hide and show again', async ({
  window,
}, testInfo) => {
  await setViewport(window, 1600, 1000)
  await featureCard(window, CHECKOUT_KEY).click({ timeout: 20_000 })
  const page = featurePage(window)
  await expect(page).toBeVisible()
  await expect(page.locator('[data-feature-repo]')).toHaveCount(3)
  await expect(page.getByTestId('pr-card').filter({ hasText: '#101' })).toBeVisible()
  await expect(page.getByTestId('pr-card').filter({ hasText: '#111' })).toBeVisible()

  // Esc in the name field cancels the edit (and does NOT leave the page).
  await window.getByTestId('feature-rename').click()
  await window.getByLabel('Feature name').fill('Never saved')
  await window.keyboard.press('Escape')
  await expect(page).toBeVisible()
  await expect(page.locator('h1')).toHaveText('checkout-v2')

  await window.getByTestId('feature-rename').click()
  await window.getByLabel('Feature name').fill('Checkout rewrite')
  await window.keyboard.press('Enter')
  await expect(page.locator('h1')).toHaveText('Checkout rewrite')
  await expect(page.getByTestId('feature-tag')).toContainText('checkout-v2')
  await attachScreenshot(window, testInfo, 'feature-renamed')

  // Reset to the tag name.
  await window.getByTestId('feature-rename').click()
  await window.getByRole('button', { name: 'Use the tag name' }).click()
  await expect(page.locator('h1')).toHaveText('checkout-v2')
  expect(await window.evaluate(() => localStorage.getItem('minerva.featureNames'))).toBe('{}')

  // Hide the group: gone from the overview, listed under "1 hidden — Show".
  await window.getByTestId('feature-hide').click()
  await expect(page).toContainText('Hidden from the overview')
  await window.getByTestId('home-back').click()
  await expect(featureCard(window, CHECKOUT_KEY)).toHaveCount(0)
  await expect(featureCard(window, BUG_KEY)).toBeVisible()
  const toggle = window.getByTestId('features-hidden-toggle')
  await expect(toggle).toContainText('1 hidden')
  await toggle.click()
  const hiddenCard = window.locator(`[data-testid="feature-card-hidden"][data-feature-key="${CHECKOUT_KEY}"]`)
  await expect(hiddenCard).toBeVisible()
  await hiddenCard.getByTestId('feature-unhide').click()
  await expect(featureCard(window, CHECKOUT_KEY)).toBeVisible()
  await expect(toggle).toHaveCount(0)
  expect(await window.evaluate(() => localStorage.getItem('minerva.hiddenFeatures'))).toBe('[]')
})

// eslint-disable-next-line no-empty-pattern
test('a feature rename and the collapsed sidebar survive an app relaunch', async ({}, testInfo) => {
  const userDataDir = testInfo.outputPath('user-data')
  const app1 = await launchMinerva(userDataDir)
  try {
    const win1 = await mainWindow(app1)
    await setViewport(win1, 1600, 1000)
    await featureCard(win1, CHECKOUT_KEY).click({ timeout: 20_000 })
    await win1.getByTestId('feature-rename').click()
    await win1.getByLabel('Feature name').fill('Checkout rewrite')
    await win1.keyboard.press('Enter')
    await expect(featurePage(win1).locator('h1')).toHaveText('Checkout rewrite')
    await win1.getByTestId('sidebar-toggle').click()
    await expect(sidebar(win1)).toHaveCount(0)
  } finally {
    await closeMinerva(app1)
  }

  const app2 = await launchMinerva(userDataDir)
  try {
    const win2 = await rawWindow(app2)
    await setViewport(win2, 1600, 1000)
    await expect(sidebar(win2)).toHaveCount(0)
    await expect(win2.getByTestId('sidebar-toggle')).toHaveAttribute('aria-expanded', 'false')
    await expect(featureCard(win2, CHECKOUT_KEY)).toContainText('Checkout rewrite', {
      timeout: 20_000,
    })
    await win2.getByTestId('sidebar-toggle').click()
    await expect(sidebar(win2)).toBeVisible()
  } finally {
    await closeMinerva(app2)
  }
})

test('docked sidebar: TitleBar toggle and Cmd/Ctrl+B, ignored while typing in the search box', async ({
  window,
}) => {
  await setViewport(window, 1600, 1000)
  await expect(sidebar(window)).toBeVisible()
  const toggle = window.getByTestId('sidebar-toggle')
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await toggle.click()
  await expect(sidebar(window)).toHaveCount(0)
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  expect(await window.evaluate(() => localStorage.getItem('minerva.sidebarCollapsed'))).toBe('true')

  await window.keyboard.press(MOD + '+b')
  await expect(sidebar(window)).toBeVisible()

  // Typing in the search box: the shortcut is left to the field.
  const search = window.getByLabel('Search pull requests')
  await search.click()
  await search.fill('cart')
  await window.keyboard.press(MOD + '+b')
  await expect(sidebar(window)).toBeVisible()
  await search.fill('')
  await window.keyboard.press('Tab')
  await window.keyboard.press(MOD + '+b')
  await expect(sidebar(window)).toHaveCount(0)
  await window.keyboard.press(MOD + '+b')
  await expect(sidebar(window)).toBeVisible()
})

test('stack navigator: prev/next, next disabled on the last PR, cleared by a PR outside the stack; Continue reviewing keeps the tab', async ({
  window,
}, testInfo) => {
  await setViewport(window, 1600, 1000)
  await openRepo(window, 'orders-api')
  await expect(window.getByTestId('stack-board')).toBeVisible({ timeout: 20_000 })
  await window.getByRole('button', { name: 'Review stack' }).first().click()
  const position = window.getByTestId('stack-nav-position')
  await expect(position).toHaveText('1 of 3', { timeout: 20_000 })
  await expect(window.getByTestId('stack-nav-prev')).toBeDisabled()
  await expect(prHeader(window)).toContainText('#101')

  await window.getByTestId('stack-nav-next').click()
  await expect(position).toHaveText('2 of 3', { timeout: 20_000 })
  await expect(prHeader(window)).toContainText('#102')
  await window.getByTestId('stack-nav-next').click()
  await expect(position).toHaveText('3 of 3', { timeout: 20_000 })
  await expect(prHeader(window)).toContainText('#103')
  await expect(window.getByTestId('stack-nav-next')).toBeDisabled()
  await window.getByTestId('stack-nav-prev').click()
  await expect(position).toHaveText('2 of 3', { timeout: 20_000 })
  await attachScreenshot(window, testInfo, 'review-stack-nav')

  // Breadcrumb back to the repo page, Esc back to the overview.
  await window.getByTestId('review-breadcrumb').getByText('orders-api').click()
  await expect(repoPage(window)).toBeVisible()
  await window.keyboard.press('Escape')
  await expect(overview(window)).toBeVisible()

  // "Continue reviewing #102" restores the review with the tab that was open.
  await window.getByTestId('continue-review').click()
  await expect(prHeader(window)).toContainText('#102')
  await window.getByRole('button', { name: /^Files/ }).click()
  await expect(window.getByRole('button', { name: /^Files/ })).toHaveAttribute('aria-pressed', 'true')
  await window.getByTestId('home-button').click()
  await expect(overview(window)).toBeVisible()
  await expect(overview(window).getByTestId('continue-review')).toContainText('#102')
  await overview(window).getByTestId('continue-review').click()
  await expect(prHeader(window)).toContainText('#102')
  await expect(window.getByRole('button', { name: /^Files/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(window.getByTestId('stack-nav')).toBeVisible()

  // A PR of ANOTHER stack opened from the sidebar: its stack map shows, the navigator is gone.
  await sidebar(window).getByText('Checkout v2: client models').first().click()
  await expect(prHeader(window)).toContainText('#110')
  await expect(window.getByRole('region', { name: 'Stack' })).toBeVisible()
  await expect(window.getByTestId('stack-nav')).toHaveCount(0)
})

test('md tier: Esc closes the PR-list drawer without leaving the repo page', async ({ window }) => {
  await setViewport(window, 960, 800)
  await window.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  )
  await openRepo(window, 'orders-api')
  const drawerToggle = window.getByRole('button', { name: 'PR list' })
  await drawerToggle.click()
  await expect(sidebar(window)).toBeVisible()
  await window.keyboard.press('Escape')
  await expect(sidebar(window)).toHaveCount(0)
  await expect(repoPage(window)).toBeVisible()
  // A second Esc, with the drawer closed, does go back.
  await window.keyboard.press('Escape')
  await expect(overview(window)).toBeVisible()
})

test('tiled sizes: overview, repo page (vertical board) and feature page keep their content', async ({
  window,
}, testInfo) => {
  for (const viewport of [
    { name: '900x800', w: 900, h: 800, orientation: 'horizontal' },
    { name: '700x800', w: 700, h: 800, orientation: 'vertical' },
  ]) {
    await setViewport(window, viewport.w, viewport.h)
    await window.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    )
    await window.getByTestId('home-button').click()
    await expect(overview(window)).toBeVisible()
    await expect(featureCard(window, CHECKOUT_KEY)).toContainText('4 PRs', { timeout: 20_000 })
    await expect(repoCard(window, 'orders-api')).toContainText('1 orphan')
    await attachScreenshot(window, testInfo, 'overview-' + viewport.name)

    await openRepo(window, 'orders-api')
    const board = window.getByTestId('stack-board')
    await expect(board).toBeVisible({ timeout: 20_000 })
    await expect(board).toHaveAttribute('data-orientation', viewport.orientation)
    await expect(board.getByTestId('stack-card').filter({ hasText: '#103' })).toContainText(
      'submit endpoint',
    )
    await expect(repoPage(window)).toContainText('Parent #100 was completed into main')
    await attachScreenshot(window, testInfo, 'repo-' + viewport.name)

    await window.getByTestId('home-button').click()
    await featureCard(window, CHECKOUT_KEY).click()
    await expect(featurePage(window).locator('[data-feature-repo]')).toHaveCount(3)
    await expect(featurePage(window).getByTestId('pr-card').filter({ hasText: '#104' })).toContainText(
      'submit button',
    )
    await attachScreenshot(window, testInfo, 'feature-' + viewport.name)

    const overflow = await window.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    )
    expect(overflow, viewport.name + ': page overflows horizontally').toBeLessThanOrEqual(0)
  }
})

// eslint-disable-next-line no-empty-pattern
test('GitHub signed in: shopwave repos and the cross-repo `endpoint` label, scoped per provider', async ({}, testInfo) => {
  const app = await launchMinerva(testInfo.outputPath('user-data'), {
    env: { MINERVA_MOCK_GH_AUTH: 'signed_in' },
  })
  try {
    const win = await mainWindow(app)
    await setViewport(win, 1600, 1000)
    const api = repoCard(win, 'shopwave/api').or(repoCard(win, 'api').filter({ hasText: 'shopwave' }))
    await expect(api.first()).toBeVisible({ timeout: 20_000 })
    await expect(api.first()).toContainText('to review')
    const endpoint = featureCard(win, 'github:shopwave:endpoint')
    await expect(endpoint).toBeVisible()
    await expect(endpoint).toContainText('api')
    await expect(endpoint).toContainText('checkout-service')
    // Contoso's `bug` stays Azure-only even with GitHub data on screen.
    await expect(featureCard(win, BUG_KEY)).not.toContainText('shopwave')
    await attachScreenshot(win, testInfo, 'overview-both-providers')
  } finally {
    await closeMinerva(app)
  }
})
