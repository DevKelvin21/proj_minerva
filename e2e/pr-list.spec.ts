import {
  test,
  expect,
  launchMinerva,
  closeMinerva,
  mainWindow,
  attachScreenshot,
  openRepoPage,
  setViewport,
} from './fixtures'
import type { Page } from './fixtures'

/**
 * Closed and merged PRs, which the dashboard (open only) does not carry:
 * the Home repo page's Open / Closed / All (`scm:listPullRequests`), its
 * refresh and unseen dots + markPrSeen, and main's watcher refreshing the
 * sidebar Queue without a manual refresh. The watcher case launches ITS
 * app with `MINERVA_WATCH_INTERVAL_MS=1500` (the 60 s default would time out).
 */

// Shopwave fixture titles used as signals.
const OPEN_PR = 'apply-coupon' // #482 shopwave/api, open, commentCount 2
const CLOSED_PR = 'GraphQL gateway proxy' // #455 shopwave/api, closed
const MERGED_PR = 'pagination to order history' // #185 shopwave/web, merged
const OTHER_REPO_MERGED = 'multi-currency support' // #68 shopwave/checkout-service, merged
const WATCHED_PR = 'race condition in payment webhook' // open, for the watcher

const repoPage = (page: Page) => page.getByTestId('repo-page')
const cards = (page: Page) => repoPage(page).getByTestId('pr-card')
const card = (page: Page, title: string) => cards(page).filter({ hasText: title })
const stateButton = (page: Page, state: 'open' | 'closed' | 'all') =>
  page.getByTestId('repo-state-' + state)
const history = (page: Page) => page.getByTestId('repo-history')

/** Dots / comment counter of the sidebar list row whose text contains `title`. */
const itemInfo = (page: Page, title: string) =>
  page.evaluate((t) => {
    const item = [...document.querySelectorAll('aside button')].find((b) =>
      (b as HTMLElement).innerText.includes(t),
    ) as HTMLElement | undefined
    if (!item) return null
    // Comment counter: the ONE span of the row that wraps an svg and whose
    // text is only digits (MessageSquare + count). Not includes(digit) over
    // the whole text: +adds/-dels and #number give false positives.
    const counter = [...item.querySelectorAll('span')].find(
      (s) => s.querySelector('svg') && /^\d+$/.test((s as HTMLElement).innerText.trim()),
    ) as HTMLElement | undefined
    return { commentCount: counter ? counter.innerText.trim() : null }
  }, title)

test('repo page: Open (default), Closed with state badges, All; another repo starts on Open', async ({
  window,
}, testInfo) => {
  await setViewport(window, 1600, 1000)
  await openRepoPage(window, 'shopwave/api')

  // (1) Open: today's dashboard, closed and merged left out.
  await expect(stateButton(window, 'open')).toHaveAttribute('aria-pressed', 'true')
  await expect(card(window, OPEN_PR)).toBeVisible()
  await expect(card(window, CLOSED_PR)).toHaveCount(0)
  await expect(history(window)).toHaveCount(0)

  // (2) Closed: only that repo's closed + merged, with a state badge.
  await stateButton(window, 'closed').click()
  await expect(history(window)).toHaveAttribute('data-state', 'closed')
  await expect(card(window, CLOSED_PR)).toBeVisible()
  await expect(card(window, CLOSED_PR).locator('[data-pr-state="closed"]')).toHaveText('Closed')
  await expect(card(window, OPEN_PR)).toHaveCount(0)
  // Another repo's closed PRs stay on their own page.
  await expect(card(window, OTHER_REPO_MERGED)).toHaveCount(0)
  await expect(card(window, MERGED_PR)).toHaveCount(0)
  // No stacks board here: Closed is a plain list.
  await expect(window.getByTestId('stack-board')).toHaveCount(0)
  await attachScreenshot(window, testInfo, 'repo-page-closed')

  // (3) All: open and closed together.
  await stateButton(window, 'all').click()
  await expect(history(window)).toHaveAttribute('data-state', 'all')
  await expect(card(window, OPEN_PR)).toBeVisible()
  await expect(card(window, CLOSED_PR)).toBeVisible()

  // (4) The viewer filter works on the list shown: its counts follow it.
  await expect(window.getByTestId('repo-filter-all').locator('span')).toHaveText(
    String(await cards(window).count()),
  )

  // (5) Another repo starts on Open; its Closed shows its merged PR.
  await openRepoPage(window, 'shopwave/web')
  await expect(stateButton(window, 'open')).toHaveAttribute('aria-pressed', 'true')
  await stateButton(window, 'closed').click()
  await expect(card(window, MERGED_PR).locator('[data-pr-state="merged"]')).toHaveText('Merged')
  await expect(card(window, CLOSED_PR)).toHaveCount(0)

  // (6) A closed PR opens into the review like any card.
  await card(window, MERGED_PR).click()
  await expect(window.locator('header:has(h1)')).toContainText('#185')
})

test('repo page Closed: refresh, unseen dot, opening it marks it seen', async ({
  window,
}, testInfo) => {
  await setViewport(window, 1600, 1000)
  await openRepoPage(window, 'shopwave/api')
  await stateButton(window, 'closed').click()
  await expect(card(window, CLOSED_PR)).toBeVisible()
  const dot = card(window, CLOSED_PR).getByRole('img', { name: 'Unread changes' })

  // Sealing "seen" with OLD values forces a deterministic unread state
  // (current updatedAt > sealed ⇒ hasUpdates; commentCount 1 > 0 ⇒
  // hasNewComments), whatever pr-seen.json holds.
  const target = await window.evaluate(async (title) => {
    const { items: prs } = await window.minerva.scm.listPullRequests({ state: 'closed' })
    const pr = prs.find((p) => p.title.includes(title))
    if (!pr) return null
    await window.minerva.scm.markPrSeen({
      repo: pr.repo,
      number: pr.number,
      updatedAt: '2020-01-01T00:00:00Z',
      commentCount: 0,
    })
    const again = await window.minerva.scm.listPullRequests({ state: 'closed' })
    return again.items.find((p) => p.id === pr.id)?.unread ?? null
  }, CLOSED_PR)
  expect(target, 'unread over IPC after sealing an old "seen"').toMatchObject({
    isNew: false,
    hasUpdates: true,
    hasNewComments: true,
  })

  // The page's refresh refetches the Closed list: the dot shows.
  await repoPage(window).getByRole('button', { name: 'Refresh dashboard' }).click()
  await expect(dot).toBeVisible()
  await expect(window.getByText('Could not load')).toHaveCount(0)
  await attachScreenshot(window, testInfo, 'repo-page-closed-unseen')

  // Opening the PR seals it seen: back on the page, the dot is gone.
  await card(window, CLOSED_PR).click()
  await expect(window.locator('header:has(h1)')).toContainText('#455')
  await window.getByTestId('review-breadcrumb').getByText('api', { exact: true }).click()
  await expect(repoPage(window)).toBeVisible()
  await expect(stateButton(window, 'closed')).toHaveAttribute('aria-pressed', 'true')
  await expect(card(window, CLOSED_PR)).toBeVisible()
  await expect(dot).toHaveCount(0)

  // markPrSeen persisted in main: a fresh query comes back clean.
  const persisted = await window.evaluate(async (title) => {
    const { items: prs } = await window.minerva.scm.listPullRequests({ state: 'closed' })
    return prs.find((p) => p.title.includes(title))?.unread ?? null
  }, CLOSED_PR)
  expect(persisted).toMatchObject({ isNew: false, hasUpdates: false, hasNewComments: false })
})

// eslint-disable-next-line no-empty-pattern
test('watcher: a new comment refreshes the Queue without a manual refresh', async ({}, testInfo) => {
  const app = await launchMinerva(testInfo.outputPath('user-data'), {
    env: { MINERVA_WATCH_INTERVAL_MS: '1500' },
  })
  try {
    const window = await mainWindow(app)
    const seed = await window.evaluate(async (title) => {
      const { items: prs } = await window.minerva.scm.listPullRequests({ state: 'open' })
      const pr = prs.find((p) => p.title.includes(title))
      if (!pr) return null
      await window.minerva.scm.postComment({
        repo: pr.repo,
        number: pr.number,
        bodyMarkdown: 'comment from the pr-list e2e (watcher)',
      })
      return { commentCount: pr.commentCount ?? 0 }
    }, WATCHED_PR)
    expect(seed, 'watcher target fixture found').not.toBeNull()

    // The watcher (1.5 s) sees commentCount+1 and the Queue refetches ON ITS OWN.
    const expected = String(seed!.commentCount + 1)
    await expect
      .poll(async () => (await itemInfo(window, WATCHED_PR))?.commentCount, {
        message: `counter ${seed!.commentCount} → ${expected} without a click (prListChanged)`,
        timeout: 15_000,
      })
      .toBe(expected)
  } finally {
    await closeMinerva(app)
  }
})
