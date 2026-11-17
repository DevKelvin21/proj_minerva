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
 * Review control (approve / request changes / comment) in the PR bar, mock
 * only: writes land in the in-memory GitHub universe "shopwave" (signed in as
 * mgarcia) and the Azure fake server "contoso" (signed in as Ada).
 *
 * - shopwave/api #479: mgarcia is a reviewer with no vote yet.
 * - shopwave/api #482: mgarcia's own PR (GitHub refuses a vote there).
 * - contoso storefront-web #104: Ada is a reviewer with no vote yet.
 *
 * Main asks with a native dialog before a vote; `MINERVA_TEST_CONFIRM`
 * answers it (mock mode only). A plain comment has no dialog.
 */

const aside = (page: Page) => page.getByRole('complementary', { name: 'Pull request list' })
const popover = (page: Page) => page.getByTestId('review-popover')

const GH_REVIEWER = 'Add refunds table and migration for partial refunds'
const GH_OWN = 'Add POST /carts/:id/apply-coupon endpoint'
const AZ_REVIEWER = 'Checkout v2: submit button'

async function openPr(page: Page, title: string): Promise<void> {
  await aside(page).getByText(title).first().click()
  await expect(page.getByRole('heading', { name: title }).first()).toBeAttached()
  await expect(page.getByTestId('review-trigger')).toBeVisible({ timeout: 20_000 })
}

async function openReview(page: Page): Promise<void> {
  await page.getByTestId('review-trigger').click()
  await expect(popover(page)).toBeVisible()
}

async function withConfirm(
  answer: 'accept' | 'decline',
  outputDir: string,
  body: (page: Page) => Promise<void>,
): Promise<void> {
  const app = await launchMinerva(outputDir, { env: { MINERVA_TEST_CONFIRM: answer } })
  try {
    await body(await mainWindow(app))
  } finally {
    await closeMinerva(app)
  }
}

// eslint-disable-next-line no-empty-pattern
test('GitHub: approve #479 with a summary; the bar, the reviewers and the conversation show it', async ({}, testInfo) => {
  await withConfirm('accept', testInfo.outputPath('user-data'), async (window) => {
    // Wide enough for the labeled Review button (bar content >= 940 px).
    await setViewport(window, 1800, 1000)
    await openPr(window, GH_REVIEWER)
    const trigger = window.getByTestId('review-trigger')
    await expect(trigger).toHaveAttribute('data-vote', 'none')
    await expect(trigger).toHaveText('Review')
    await openReview(window)
    const panel = popover(window)
    await expect(panel).toContainText('Review PR #479')
    // GitHub's three verdicts, starting on Approve.
    await expect(panel.getByRole('radio')).toHaveCount(3)
    await expect(panel.getByRole('radio', { name: /^Approve/ })).toBeChecked()
    await expect(panel.getByRole('radio', { name: /^Request changes/ })).toBeEnabled()
    await expect(panel).toContainText('Minerva asks you to confirm')
    await panel.getByTestId('review-summary').fill('Migration looks safe. Nice tests.')
    await attachScreenshot(window, testInfo, 'github-review-popover')

    await panel.getByTestId('review-submit').click()
    await expect(popover(window)).toHaveCount(0)
    await expect(trigger).toHaveAttribute('data-vote', 'approved')
    await expect(trigger).toHaveText('Approved')
    await attachScreenshot(window, testInfo, 'github-approved')

    // The reviewer chip in Details carries the new vote.
    await window.getByTestId('pr-details').locator('summary').click()
    const me = window.getByRole('list', { name: 'Reviewers' }).locator('li', { hasText: 'mgarcia' })
    await expect(me).toHaveAttribute('data-vote', 'approved')
    await window.getByTestId('pr-details').locator('summary').click()

    // The summary is a PR comment now.
    await window.getByRole('tab', { name: /Conversation/ }).click()
    await expect(window.getByText('Migration looks safe. Nice tests.')).toBeVisible()

    // Reopened, the form says what you already voted.
    await openReview(window)
    await expect(popover(window).getByTestId('review-current-vote')).toContainText('Approved')
  })
})

// eslint-disable-next-line no-empty-pattern
test('GitHub (declined): nothing is submitted, the draft stays', async ({}, testInfo) => {
  await withConfirm('decline', testInfo.outputPath('user-data'), async (window) => {
    await openPr(window, GH_REVIEWER)
    await openReview(window)
    const panel = popover(window)
    await panel.getByRole('radio', { name: /^Request changes/ }).check()
    // GitHub needs a summary to request changes.
    await expect(panel.getByTestId('review-submit')).toBeDisabled()
    await panel.getByTestId('review-summary').fill('Please add a down migration.')
    await panel.getByTestId('review-submit').click()
    await expect(panel.getByTestId('review-submit')).toBeEnabled()
    await expect(panel.getByTestId('review-summary')).toHaveValue('Please add a down migration.')
    await expect(panel.getByRole('alert')).toHaveCount(0)
    await expect(window.getByTestId('review-trigger')).toHaveAttribute('data-vote', 'none')
  })
})

test('GitHub: your own PR offers only a comment, posted without a dialog', async ({
  window,
}, testInfo) => {
  await setViewport(window, 1600, 1000)
  await openPr(window, GH_OWN)
  await openReview(window)
  const panel = popover(window)
  await expect(panel.getByRole('radio', { name: /^Approve/ })).toBeDisabled()
  await expect(panel.getByRole('radio', { name: /^Request changes/ })).toBeDisabled()
  await expect(panel).toContainText("GitHub doesn't allow a vote on your own pull request.")
  await expect(panel.getByRole('radio', { name: /^Comment/ })).toBeChecked()
  // A comment is its summary: required.
  await expect(panel.getByTestId('review-submit')).toBeDisabled()
  await expect(panel).not.toContainText('Minerva asks you to confirm')
  await attachScreenshot(window, testInfo, 'github-own-pr')
  // No MINERVA_TEST_CONFIRM here: a native dialog would hang the test, so this
  // also proves a plain comment never asks.
  await panel.getByTestId('review-summary').fill('Ready for another look.')
  await window.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter')
  await expect(popover(window)).toHaveCount(0)
  await window.getByRole('tab', { name: /Conversation/ }).click()
  await expect(window.getByText('Ready for another look.')).toBeVisible()
})

// eslint-disable-next-line no-empty-pattern
test('Azure DevOps: five verdicts; "Wait for author" without a summary', async ({}, testInfo) => {
  await withConfirm('accept', testInfo.outputPath('user-data'), async (window) => {
    await setViewport(window, 1800, 1000)
    await openPr(window, AZ_REVIEWER)
    await openReview(window)
    const panel = popover(window)
    await expect(panel.getByRole('radio')).toHaveCount(5)
    for (const name of [
      /^Comment/,
      /^Approve/,
      /^Approve with suggestions/,
      /^Wait for author/,
      /^Reject/,
    ]) {
      await expect(panel.getByRole('radio', { name }).first()).toBeEnabled()
    }
    await panel.getByRole('radio', { name: /^Wait for author/ }).check()
    await expect(panel.getByTestId('review-submit')).toBeEnabled()
    await attachScreenshot(window, testInfo, 'azure-review-popover')
    await panel.getByTestId('review-submit').click()
    const trigger = window.getByTestId('review-trigger')
    await expect(trigger).toHaveAttribute('data-vote', 'changes_requested')
    await expect(trigger).toHaveText('Waiting for author')
    await attachScreenshot(window, testInfo, 'azure-waiting-for-author')
  })
})

test('tiled sizes: the Review control stays reachable and its popover fits', async ({
  window,
}, testInfo) => {
  await openPr(window, GH_REVIEWER)
  for (const viewport of [
    { name: 'vertical-half', w: 960, h: 1080 },
    { name: 'quarter', w: 960, h: 540 },
    { name: 'narrow', w: 700, h: 700 },
  ]) {
    await setViewport(window, viewport.w, viewport.h)
    await window.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    )
    const aiDrawer = window.getByRole('dialog', { name: /^(AI|IA)$/ })
    if (await aiDrawer.isVisible()) {
      await window.keyboard.press('Escape')
      await expect(aiDrawer).toHaveCount(0)
    }
    await openReview(window)
    const box = await popover(window).boundingBox()
    expect(box).not.toBeNull()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.w + 1)
    await attachScreenshot(window, testInfo, 'review-' + viewport.name)
    await window.keyboard.press('Escape')
    await expect(popover(window)).toHaveCount(0)
  }
})
