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
 * The Inbox's Unread / All switch and "Done" (the InboxDone board). The
 * mock's scripted reviewers give "my" api#482 two inbox items after startup:
 * a line comment by jrivas (`MINERVA_MOCK_INCOMING_COMMENT_MS`) and a
 * changes-requested vote by dkumar (`MINERVA_MOCK_INCOMING_REVIEW_MS`).
 */

const COMMENT_ID = 'comment:github:shopwave/api#482:c-482-incoming'

const test = base.extend<{ minerva: MinervaApp; window: Page }>({
  // eslint-disable-next-line no-empty-pattern
  minerva: async ({}, use, testInfo) => {
    const app = await launchMinerva(testInfo.outputPath('user-data'), {
      env: {
        MINERVA_WATCH_INTERVAL_MS: '1000',
        MINERVA_MOCK_INCOMING_COMMENT_MS: '6000',
        MINERVA_MOCK_INCOMING_REVIEW_MS: '6000',
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
const filterTabs = (page: Page) => inbox(page).getByRole('tablist', { name: 'Show' })
const unreadTab = (page: Page) => filterTabs(page).getByRole('tab', { name: /^Unread/ })
const allTab = (page: Page) => filterTabs(page).getByRole('tab', { name: 'All' })
const comment = (page: Page) => page.locator('[data-activity-item="' + COMMENT_ID + '"]')
const vote = (page: Page) =>
  inbox(page).locator('[data-activity-item^="review:github:shopwave/api#482:dkumar:"]')
const rows = (page: Page) => inbox(page).locator('[data-activity-item]')
const badge = (page: Page) => page.getByTestId('inbox-unread-badge')
const toast = (page: Page) => page.getByTestId('inbox-undo-toast')

async function openInbox(page: Page): Promise<void> {
  await viewSwitch(page)
    .getByRole('button', { name: /^Inbox/ })
    .click()
  await expect(badge(page)).toHaveText('2', { timeout: 30_000 })
  await expect(rows(page)).toHaveCount(2)
}

test('Unread by default: read rows stay until you leave, All keeps them, Clear read removes them', async ({
  window,
}, testInfo) => {
  await setViewport(window, 1600, 1000)
  await openInbox(window)
  await expect(unreadTab(window)).toHaveAttribute('aria-selected', 'true')
  await expect(unreadTab(window)).toHaveAccessibleName('Unread: 2')
  await expect(inbox(window)).toContainText('2 unread')
  await expect(comment(window)).toContainText('Should this retry on 409')
  await expect(vote(window)).toContainText('dkumar requested changes.')
  // Keyboard focus on a row: the ring is inset and wraps the row with its Done button.
  await comment(window).focus()
  await window.keyboard.press('Tab')
  await window.keyboard.press('Shift+Tab')
  await expect(comment(window)).toBeFocused()
  await attachScreenshot(window, testInfo, 'unread-row-focus')

  // Opened while Unread is showing: it stays, dimmed, so the list does not jump.
  await comment(window).click()
  await expect(window.locator('header:has(h1)')).toContainText('#482')
  await expect(comment(window)).toHaveAttribute('data-read', 'true')
  await expect(rows(window)).toHaveCount(2)
  await expect(badge(window)).toHaveText('1')
  await expect(unreadTab(window)).toHaveAccessibleName('Unread: 1')
  await attachScreenshot(window, testInfo, 'unread-kept')

  // All lists both; back on Unread, the read one has left.
  await allTab(window).click()
  await expect(allTab(window)).toHaveAttribute('aria-selected', 'true')
  await expect(inbox(window)).toContainText('Read items stay 14 days')
  await expect(rows(window)).toHaveCount(2)
  // Arrow keys switch (roving tabs).
  await allTab(window).press('ArrowLeft')
  await expect(unreadTab(window)).toBeFocused()
  await expect(unreadTab(window)).toHaveAttribute('aria-selected', 'true')
  await expect(rows(window)).toHaveCount(1)
  await expect(comment(window)).toHaveCount(0)
  await expect(vote(window)).toBeVisible()

  // The choice is remembered: All survives a reload.
  await allTab(window).click()
  await window.reload()
  await setViewport(window, 1600, 1000)
  await viewSwitch(window)
    .getByRole('button', { name: /^Inbox/ })
    .click()
  await expect(badge(window)).toHaveText('1', { timeout: 30_000 })
  await expect(allTab(window)).toHaveAttribute('aria-selected', 'true')
  await expect(rows(window)).toHaveCount(2)

  // Clear read: the read comment goes, with Undo; Undo brings it back (focused).
  const clearRead = inbox(window).getByRole('button', { name: 'Clear read' })
  await clearRead.click()
  await expect(comment(window)).toHaveCount(0)
  await expect(toast(window)).toContainText('Cleared 1 read item.')
  await expect(clearRead).toHaveAttribute('aria-disabled', 'true')
  await expect(clearRead).toBeFocused()
  await attachScreenshot(window, testInfo, 'all-clear-read-toast')
  await toast(window).getByRole('button', { name: 'Undo' }).click()
  await expect(comment(window)).toBeVisible()
  await expect(comment(window)).toBeFocused()
  await expect(toast(window)).toHaveCount(0)

  // Again, and this time let it go: main drops it, and later listings do not bring it back.
  await clearRead.click()
  await expect(toast(window)).toHaveCount(0, { timeout: 10_000 })
  await window.waitForTimeout(2500)
  await expect(comment(window)).toHaveCount(0)
  await expect(rows(window)).toHaveCount(1)

  // Unread emptied by "Mark #482 read": the row stays until Unread is left...
  await unreadTab(window).click()
  await inbox(window)
    .getByRole('button', { name: 'Mark #482 read' })
    .click()
  await expect(vote(window)).toHaveAttribute('data-read', 'true')
  await expect(badge(window)).toHaveCount(0)
  await allTab(window).click()
  await unreadTab(window).click()
  // ...then Unread says where the rest went, and All is one click away.
  const caughtUp = inbox(window).getByTestId('inbox-caught-up')
  await expect(caughtUp).toContainText('All caught up')
  await expect(caughtUp).toContainText('Read items are under All.')
  await expect(rows(window)).toHaveCount(0)
  await attachScreenshot(window, testInfo, 'unread-caught-up')
  await caughtUp.getByRole('button', { name: 'All' }).click()
  await expect(allTab(window)).toHaveAttribute('aria-selected', 'true')
  await expect(allTab(window)).toBeFocused()
  await expect(vote(window)).toBeVisible()
})

test('Done per row and per PR, with Undo and focus, stays done after a reload (tiled drawer)', async ({
  window,
}, testInfo) => {
  // Tiled: the sidebar is a drawer over the review.
  await setViewport(window, 960, 640)
  await window.getByTestId('sidebar-toggle').click()
  await openInbox(window)

  // The row's Done button is in the Tab order right after its row, and shows on focus.
  const doneComment = inbox(window).locator('[data-inbox-done="' + COMMENT_ID + '"]')
  await comment(window).focus()
  await window.keyboard.press('Tab')
  await expect(doneComment).toBeFocused()
  await expect(doneComment).toHaveAccessibleName('Done: remove from the inbox')
  await expect(doneComment).toHaveCSS('opacity', '1')
  await window.keyboard.press('Enter')
  await expect(comment(window)).toHaveCount(0)
  await expect(toast(window)).toContainText('Removed from the inbox.')
  // Focus lands on the next row, never on <body>.
  await expect(vote(window)).toBeFocused()
  await expect(badge(window)).toHaveText('1')
  await attachScreenshot(window, testInfo, 'tiled-row-done-toast')

  await toast(window).getByRole('button', { name: 'Undo' }).click()
  await expect(comment(window)).toBeFocused()
  await expect(badge(window)).toHaveText('2')

  // Done with the whole PR: both items go; with nothing left, focus goes to the switch.
  await inbox(window)
    .getByRole('button', { name: 'Done with #482' })
    .click()
  await expect(rows(window)).toHaveCount(0)
  await expect(toast(window)).toContainText('#482 is done (2 items).')
  await expect(unreadTab(window)).toBeFocused()
  await expect(badge(window)).toHaveCount(0)
  await expect(inbox(window)).toContainText('Nothing new on your PRs.')
  await attachScreenshot(window, testInfo, 'tiled-pr-done-toast')

  // Undo expires: main forgets them for good, across listings and a reload.
  await expect(toast(window)).toHaveCount(0, { timeout: 10_000 })
  await window.waitForTimeout(2500)
  await window.reload()
  await setViewport(window, 960, 640)
  await window.getByTestId('sidebar-toggle').click()
  await viewSwitch(window)
    .getByRole('button', { name: /^Inbox/ })
    .click()
  await allTab(window).click()
  await expect(inbox(window)).toContainText('Nothing new on your PRs.')
  await expect(rows(window)).toHaveCount(0)
  await expect(badge(window)).toHaveCount(0)
})
