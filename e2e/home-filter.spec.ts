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
import type { TestInfo } from '@playwright/test'

/**
 * The Home filter bar (mock Azure org "contoso" signed in as Ada, plus the
 * GitHub mock "shopwave" as mgarcia via `MINERVA_MOCK_GH_AUTH=signed_in`, so
 * both providers feed the pickers).
 *
 * Contoso facts used below: Linus Pauling authored the open #104, #110
 * (storefront-web), #111 (platform-infra) and #113 (storefront-web), none a
 * draft; tag `checkout-v2` is on #101 (orders-api), #104, #110 and #111; the
 * only open draft is Ada's #103. No GitHub PR is by Linus or tagged
 * `checkout-*`, so the counts do not depend on shopwave.
 */

const LINUS = 'azure:linus@contoso.example'

const overview = (page: Page) => page.getByTestId('home-overview')
const bar = (page: Page) => page.getByTestId('home-filter-bar')
const input = (page: Page) => page.getByTestId('home-filter-input')
const picker = (page: Page) => page.getByTestId('filter-picker')
const results = (page: Page) => page.getByTestId('home-filter-results')
const rows = (page: Page) => page.getByTestId('home-filter-row')
const chips = (page: Page) => bar(page).getByTestId('home-filter-chip')
const featuresSection = (page: Page) => overview(page).getByRole('region', { name: 'Features' })
const prHeader = (page: Page) => page.locator('header:has(h1)')

async function withApp(testInfo: TestInfo, run: (page: Page) => Promise<void>): Promise<void> {
  const app = await launchMinerva(testInfo.outputPath('user-data'), {
    env: { MINERVA_MOCK_GH_AUTH: 'signed_in' },
  })
  try {
    const page = await mainWindow(app)
    await setViewport(page, 1600, 1000)
    await expect(bar(page)).toBeVisible({ timeout: 20_000 })
    await run(page)
  } finally {
    await closeMinerva(app)
  }
}

/** Opens a facet's picker from its button and picks the option whose name matches. */
async function pick(page: Page, facet: string, option: RegExp, search?: string): Promise<void> {
  await page.getByTestId('home-filter-facet-' + facet).click()
  await expect(picker(page)).toBeVisible()
  if (search) await picker(page).getByRole('searchbox').fill(search)
  const item = picker(page).getByRole('menuitemcheckbox', { name: option })
  await item.click()
  await expect(item).toHaveAttribute('aria-checked', 'true')
  await page.keyboard.press('Escape')
  await expect(picker(page)).toHaveCount(0)
}

async function rowNumbers(page: Page): Promise<string[]> {
  const keys = await rows(page).evaluateAll((nodes) =>
    nodes.map((node) => (node.getAttribute('data-pr-key') ?? '').replace(/^.*#/, '')),
  )
  return keys.sort()
}

// eslint-disable-next-line no-empty-pattern
test('author then tag: results, rows grouped by repo and the header sentence; a row opens the review', async ({}, testInfo) => {
  await withApp(testInfo, async (page) => {
    await expect(featuresSection(page)).toBeVisible({ timeout: 20_000 })

    // Author picker: "You" first, people with counts.
    await page.getByTestId('home-filter-facet-author').click()
    const authorItems = picker(page).getByRole('menuitemcheckbox')
    await expect(authorItems.first()).toContainText('You')
    await expect(picker(page).locator(`[data-option-key="${LINUS}"]`)).toHaveText(/Linus Pauling\s*4$/)
    await expect(picker(page)).toContainText('People with open PRs')
    await attachScreenshot(page, testInfo, 'author-picker')
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('home-filter-facet-author')).toBeFocused()

    await pick(page, 'author', /Linus Pauling/)
    await expect(page.getByTestId('home-filter-count')).toHaveText('4 pull requests')
    expect(await rowNumbers(page)).toEqual(['104', '110', '111', '113'])
    // Results replace the overview.
    await expect(featuresSection(page)).toHaveCount(0)
    await expect(results(page)).toContainText('Features and repositories are hidden while you filter.')

    // The tag picker narrows with its search box.
    await page.getByTestId('home-filter-facet-tag').click()
    await picker(page).getByRole('searchbox').fill('check')
    await expect(picker(page).getByRole('menuitemcheckbox')).toHaveCount(1)
    await expect(picker(page)).toContainText('Tags from GitHub labels and Azure DevOps tags.')
    await page.keyboard.press('Escape')
    await pick(page, 'tag', /checkout-v2/, 'check')

    await expect(page.getByTestId('home-filter-count')).toHaveText('3 pull requests')
    expect(await rowNumbers(page)).toEqual(['104', '110', '111'])
    await expect(page.getByTestId('home-filter-sentence')).toHaveText(
      'by Linus Pauling · tagged checkout-v2 · in 2 repositories',
    )
    const groups = page.getByTestId('home-filter-group')
    await expect(groups).toHaveCount(2)
    await expect(groups.filter({ hasText: 'storefront-web' }).getByTestId('home-filter-row')).toHaveCount(2)
    await expect(chips(page)).toHaveText([/AuthorLinus Pauling/, /Tagcheckout-v2/])
    await expect(page.getByTestId('home-filter-facet-author')).toHaveAccessibleName('Author, 1 picked')
    await attachScreenshot(page, testInfo, 'home-filter-results')

    // A row opens the review; the filter is still there back Home.
    await rows(page).filter({ hasText: 'submit button' }).click()
    await expect(prHeader(page)).toContainText('#104', { timeout: 20_000 })
    await page.getByTestId('home-button').click()
    await expect(page.getByTestId('home-filter-count')).toHaveText('3 pull requests')

    // Esc in the bar brings Home back.
    await input(page).focus()
    await page.keyboard.press('Escape')
    await expect(results(page)).toHaveCount(0)
    await expect(featuresSection(page)).toBeVisible()
    await expect(chips(page)).toHaveCount(0)
  })
})

// eslint-disable-next-line no-empty-pattern
test('typed tokens become chips on Enter; unknown ones stay as text', async ({}, testInfo) => {
  await withApp(testInfo, async (page) => {
    await input(page).fill('author:linus tag:checkout submit')
    // Not resolved yet: the pending tokens do not empty the results while typing.
    await expect(rows(page).filter({ hasText: 'submit validation' })).toBeVisible()
    await expect(rows(page).filter({ hasText: 'submit button' })).toBeVisible()
    await input(page).press('Enter')
    await expect(chips(page)).toHaveText([/AuthorLinus Pauling/, /Tagcheckout-v2/])
    await expect(input(page)).toHaveValue('submit')
    await expect(page.getByTestId('home-filter-count')).toHaveText('1 pull request')
    expect(await rowNumbers(page)).toEqual(['104'])
    await expect(page.getByTestId('home-filter-sentence')).toHaveText(
      'by Linus Pauling · tagged checkout-v2 · “submit” · in 1 repository',
    )
    await attachScreenshot(page, testInfo, 'typed-tokens')

    // An unknown facet and a value nobody has stay in the field.
    await input(page).fill('nope:x author:zzz')
    await input(page).press('Enter')
    await expect(input(page)).toHaveValue('nope:x author:zzz')
    await expect(chips(page)).toHaveCount(2)

    // Backspace in an empty field drops the last chip; Clear restores Home.
    await input(page).fill('')
    await input(page).press('Backspace')
    await expect(chips(page)).toHaveText([/AuthorLinus Pauling/])
    await page.getByTestId('home-filter-clear').click()
    await expect(results(page)).toHaveCount(0)
  })
})

// eslint-disable-next-line no-empty-pattern
test('nothing matches: the empty state names the filter to drop and removes it', async ({}, testInfo) => {
  await withApp(testInfo, async (page) => {
    await pick(page, 'author', /Linus Pauling/)
    await pick(page, 'status', /Draft/)
    const empty = page.getByTestId('home-filter-empty')
    await expect(empty).toContainText('No open pull requests match.')
    await expect(page.getByTestId('home-filter-without')).toHaveText(
      'Without Status: Draft there would be 4.',
    )
    await expect(page.getByTestId('home-filter-count')).toHaveText('0 pull requests')
    await attachScreenshot(page, testInfo, 'home-filter-empty')
    await page.getByTestId('home-filter-drop').click()
    await expect(page.getByTestId('home-filter-drop')).toHaveCount(0)
    await expect(page.getByTestId('home-filter-count')).toHaveText('4 pull requests')
    await expect(chips(page)).toHaveText([/AuthorLinus Pauling/])
  })
})

// eslint-disable-next-line no-empty-pattern
test('saved views: save, clear and reapply, update and delete', async ({}, testInfo) => {
  await withApp(testInfo, async (page) => {
    await pick(page, 'author', /Linus Pauling/)
    await pick(page, 'tag', /checkout-v2/, 'checkout')
    await page.getByTestId('home-view-save').click()
    const name = page.getByLabel('View name')
    await expect(name).toHaveValue('Linus Pauling · checkout-v2')
    await name.fill('Checkout v2 · Linus')
    await name.press('Enter')

    const view = page.getByTestId('home-saved-view')
    await expect(view).toHaveCount(1)
    await expect(view).toHaveText('Checkout v2 · Linus3')
    await expect(view).toHaveAttribute('aria-pressed', 'true')
    const stored = await page.evaluate(() => localStorage.getItem('minerva.homeViews'))
    expect(Object.values(JSON.parse(stored ?? '{}') as Record<string, { name: string }>)[0].name).toBe(
      'Checkout v2 · Linus',
    )

    // Clear brings Home back and keeps the view; clicking it reapplies it.
    await page.getByTestId('home-filter-clear').click()
    await expect(featuresSection(page)).toBeVisible()
    await expect(view).toHaveAttribute('aria-pressed', 'false')
    await view.click()
    await expect(page.getByTestId('home-filter-count')).toHaveText('3 pull requests')
    await expect(chips(page)).toHaveText([/AuthorLinus Pauling/, /Tagcheckout-v2/])
    await attachScreenshot(page, testInfo, 'saved-view')

    // Edit it: "Update view" writes the new filters into it.
    await chips(page).filter({ hasText: 'checkout-v2' }).getByRole('button').click()
    await page.getByTestId('home-view-update').click()
    await expect(view).toHaveText('Checkout v2 · Linus4')
    await expect(page.getByTestId('home-view-update')).toHaveCount(0)

    await page.getByTestId('home-view-delete').click()
    await expect(view).toHaveCount(0)
    expect(await page.evaluate(() => localStorage.getItem('minerva.homeViews'))).toBe('{}')
  })
})

// eslint-disable-next-line no-empty-pattern
test('filter from a card: the author on a PR card, the tag on a feature card; the card still opens', async ({}, testInfo) => {
  await withApp(testInfo, async (page) => {
    // The feature card's tag adds "Tag: checkout-v2".
    const feature = page.locator('[data-testid="feature-card"][data-feature-key="azure:contoso:checkout-v2"]')
    const tagButton = feature.locator('[data-filter-tag="checkout-v2"]')
    await expect(tagButton).toHaveAttribute('title', 'Show PRs tagged checkout-v2')
    await tagButton.click()
    await expect(chips(page)).toHaveText([/Tagcheckout-v2/])
    await expect(page.getByTestId('home-filter-count')).toHaveText('4 pull requests')
    await page.getByTestId('home-filter-clear').click()

    // On a repo page, the author name of a card adds "Author: …" and goes Home.
    await page.getByTestId('repo-card').filter({ hasText: 'storefront-web' }).click()
    const card = page.locator('[data-testid="pr-card"], [data-testid="stack-card"]').filter({ hasText: '#113' })
    const author = card.locator('[data-filter-author]')
    await expect(author).toHaveAttribute('title', 'Show PRs by Linus Pauling')
    await attachScreenshot(page, testInfo, 'card-author-button')
    await author.click()
    await expect(overview(page)).toBeVisible()
    await expect(chips(page)).toHaveText([/AuthorLinus Pauling/])
    await expect(page.getByTestId('home-filter-count')).toHaveText('4 pull requests')

    // The card body still opens its PR (the title is the card's button).
    await page.getByTestId('home-filter-clear').click()
    await page.getByTestId('repo-card').filter({ hasText: 'storefront-web' }).click()
    await card.getByRole('button', { name: /#113/ }).click()
    await expect(prHeader(page)).toContainText('#113', { timeout: 20_000 })
  })
})

// eslint-disable-next-line no-empty-pattern
test('tiled window: the facet buttons fold into one Filters button that opens the same pickers', async ({}, testInfo) => {
  await withApp(testInfo, async (page) => {
    await setViewport(page, 700, 800)
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    )
    const folded = page.getByTestId('home-filter-folded')
    await expect(folded).toBeVisible()
    await expect(page.getByTestId('home-filter-facet-author')).toHaveCount(0)

    await folded.click()
    await page.getByRole('menuitem', { name: 'Author' }).click()
    await expect(picker(page)).toBeVisible()
    await picker(page).getByRole('menuitemcheckbox', { name: /Linus Pauling/ }).click()
    await page.keyboard.press('Escape')
    await expect(picker(page)).toHaveCount(0)
    await expect(folded).toBeFocused()

    await folded.click()
    await page.getByRole('menuitem', { name: 'Tag' }).click()
    await picker(page).getByRole('searchbox').fill('checkout')
    await picker(page).getByRole('menuitemcheckbox', { name: /checkout-v2/ }).click()
    await page.keyboard.press('Escape')

    await expect(folded).toHaveAccessibleName('Filters, 2 picked')
    await expect(chips(page)).toHaveText([/AuthorLinus Pauling/, /Tagcheckout-v2/])
    await expect(page.getByTestId('home-filter-count')).toHaveText('3 pull requests')
    expect(await rowNumbers(page)).toEqual(['104', '110', '111'])
    await attachScreenshot(page, testInfo, 'home-filter-tiled')
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    ).toBeLessThanOrEqual(0)

    // Back to full width: the buttons come back with their counts.
    await setViewport(page, 1600, 1000)
    await expect(page.getByTestId('home-filter-facet-tag')).toHaveAccessibleName('Tag, 1 picked')
    await expect(folded).toHaveCount(0)
  })
})
