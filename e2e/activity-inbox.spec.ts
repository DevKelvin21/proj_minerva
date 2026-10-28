import {
  attachScreenshot,
  closeMinerva,
  expect,
  launchMinerva,
  mainWindow,
  setViewport,
  test as base,
  type MinervaApp,
} from './fixtures'
import type { Page } from './fixtures'

/**
 * The activity inbox (docs/plan-notifications.md): the mock's scripted
 * reviewer (`MINERVA_MOCK_INCOMING_COMMENT_MS`) opens a line thread on "my"
 * api#482 after startup. The watcher polls fast here, so the comment lands in
 * the sidebar's Inbox: a badge on the tab, a row naming who and where, and a
 * click that opens the review AT that thread and marks it read.
 *
 * The incoming comment comes well after the first listings, so api#482's
 * existing comments are the silent baseline (they never show up).
 */

const INCOMING_ID = 'comment:github:shopwave/api#482:c-482-incoming'

const test = base.extend<{ minerva: MinervaApp; window: Page }>({
  // eslint-disable-next-line no-empty-pattern
  minerva: async ({}, use, testInfo) => {
    const app = await launchMinerva(testInfo.outputPath('user-data'), {
      env: {
        MINERVA_WATCH_INTERVAL_MS: '1000',
        MINERVA_MOCK_INCOMING_COMMENT_MS: '8000',
      },
    })
    await use(app)
    await closeMinerva(app)
  },
  window: async ({ minerva }, use) => {
    await use(await mainWindow(minerva))
  },
})

const aside = (page: Page) => page.locator('aside[aria-label="Pull request list"]')
const viewSwitch = (page: Page) => aside(page).getByRole('group', { name: 'Left column view' })
const inbox = (page: Page) => page.getByTestId('activity-inbox')
const incoming = (page: Page) => page.locator('[data-activity-item="' + INCOMING_ID + '"]')
const badge = (page: Page) => page.getByTestId('inbox-unread-badge')

test('a new line comment lands in the Inbox and opens the review at its line', async ({
  window,
}, testInfo) => {
  await setViewport(window, 1600, 1000)
  await viewSwitch(window)
    .getByRole('button', { name: /^Inbox/ })
    .click()
  await expect(inbox(window)).toContainText('Nothing new on your PRs.')
  await expect(inbox(window)).toContainText('All caught up')

  // The reviewer comments; the badge and the row show up on their own.
  await expect(badge(window)).toHaveText('1', { timeout: 30_000 })
  await expect(incoming(window)).toContainText('jrivas')
  await expect(incoming(window)).toContainText('carts.ts:26')
  await expect(incoming(window)).toContainText('Should this retry on 409')
  await expect(inbox(window).getByTestId('inbox-group')).toHaveCount(1)
  await expect(inbox(window)).toContainText('Add POST /carts/:id/apply-coupon endpoint')
  await expect(inbox(window)).toContainText('1 unread')
  // The baseline stayed silent: none of api#482's earlier comments are listed.
  await expect(inbox(window).locator('[data-activity-item]')).toHaveCount(1)
  await attachScreenshot(window, testInfo, 'inbox-unread')

  await incoming(window).click()
  await expect(window.locator('header:has(h1)')).toContainText('#482')
  await expect(
    window
      .getByRole('navigation', { name: 'Pull request views' })
      .getByRole('button', { name: /^Files/ }),
  ).toHaveAttribute('aria-pressed', 'true')
  const thread = window.locator('#thread-thread-482-incoming')
  await expect(thread).toBeInViewport()
  await expect(thread).toContainText('Should this retry on 409')

  // Read: no badge, the row stays (faded) and the header says so.
  await expect(badge(window)).toHaveCount(0)
  await expect(incoming(window)).toHaveAttribute('data-read', 'true')
  await expect(inbox(window)).toContainText('All caught up')
  await attachScreenshot(window, testInfo, 'inbox-opened-at-line')
})

test('with the PR already open, the inbox refetches its threads to land on the new one', async ({
  window,
}) => {
  await setViewport(window, 1600, 1000)
  // Open api#482 BEFORE the comment exists: its threads are fetched without it.
  await aside(window)
    .getByRole('button', { name: /apply-coupon/ })
    .first()
    .click()
  await expect(window.locator('header:has(h1)')).toContainText('#482')

  await viewSwitch(window)
    .getByRole('button', { name: /^Inbox/ })
    .click()
  await expect(badge(window)).toHaveText('1', { timeout: 30_000 })
  await incoming(window).click()
  const thread = window.locator('#thread-thread-482-incoming')
  await expect(thread).toBeInViewport({ timeout: 10_000 })
  await expect(thread).toContainText('jrivas')
})

test('Mark all read, the rail badge, and the tiled 960x540 drawer', async ({
  window,
}, testInfo) => {
  await setViewport(window, 1600, 1000)
  await viewSwitch(window)
    .getByRole('button', { name: /^Inbox/ })
    .click()
  await expect(badge(window)).toHaveText('1', { timeout: 30_000 })

  // Folded to the rail, the Inbox button carries the count.
  await window.getByTestId('sidebar-toggle').click()
  const railInbox = window.getByTestId('sidebar-rail').getByRole('button', { name: /^Inbox/ })
  await expect(railInbox).toHaveAccessibleName('Inbox: 1 unread')
  await railInbox.click()
  await expect(inbox(window)).toBeVisible()

  await inbox(window).getByRole('button', { name: 'Mark all read' }).click()
  await expect(badge(window)).toHaveCount(0)
  await expect(incoming(window)).toHaveAttribute('data-read', 'true')
  await expect(inbox(window).getByRole('button', { name: 'Mark all read' })).toBeDisabled()

  // Tiled: the sidebar is a drawer; the four views still fit and the row still reads.
  await setViewport(window, 960, 540)
  await window.getByTestId('sidebar-toggle').click()
  await expect(viewSwitch(window).getByRole('button', { name: /^Inbox/ })).toBeVisible()
  await expect(incoming(window)).toContainText('carts.ts:26')
  await attachScreenshot(window, testInfo, 'inbox-tiled-960')
})
