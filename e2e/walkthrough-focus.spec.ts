import { test, expect, attachScreenshot, setViewport, openAnalysisTab } from './fixtures'
import type { Page } from './fixtures'

/**
 * Full-screen walkthrough (Walkthrough button in the PR bar): the Files tab
 * in layers mode with the sidebar, PR bar and didactic panel out of the way,
 * a verdict bar, the title bar's Exit + progress, and gathering diff lines and
 * threads for the side-panel chat while the panel is out of the way.
 */

const sidebar = (page: Page) => page.locator('aside[aria-label="Pull request list"]')
const focusBar = (page: Page) => page.getByTestId('walkthrough-focus-bar')
const layers = (page: Page) => page.getByTestId('layer-item')

async function openWalkthrough(window: Page): Promise<void> {
  await setViewport(window, 1600, 1000)
  await window.getByText('Add POST /carts/:id/apply-coupon').first().click()
  await openAnalysisTab(window)
  await window.getByRole('button', { name: 'Analyze PR' }).click()
  await expect(window.getByRole('button', { name: /Re-?analyze/i })).toBeEnabled({
    timeout: 90_000,
  })
  await window.getByRole('button', { name: 'Walkthrough', exact: true }).click()
  await expect(focusBar(window)).toBeVisible()
}

test('full screen: only the layers and the diff, verdicts by key, Esc back to the review', async ({
  window,
}, testInfo) => {
  await openWalkthrough(window)

  // Everything else is out of the way; the title bar has the way out and the progress.
  await expect(sidebar(window)).toHaveCount(0)
  await expect(window.locator('header:has(h1)')).toHaveCount(0)
  await expect(window.getByTestId('walkthrough-exit')).toBeVisible()
  await expect(window.getByTestId('walkthrough-progress')).toContainText('Layer 1 of 3')
  await expect(layers(window).nth(0)).toHaveAttribute('aria-current', 'step')
  await expect(window.getByTestId('walkthrough-judged')).toHaveText('0 of 3 layers judged')
  await attachScreenshot(window, testInfo, 'walkthrough-focus')

  // 1 = looks good on the layer on screen; J moves on; the button sets one too.
  await window.keyboard.press('1')
  await expect(layers(window).nth(0).locator('[data-verdict]')).toHaveAttribute(
    'data-verdict',
    'good',
  )
  await window.keyboard.press('j')
  await expect(window.getByTestId('walkthrough-progress')).toContainText('Layer 2 of 3')
  await focusBar(window)
    .getByRole('button', { name: /Question/ })
    .click()
  await expect(layers(window).nth(1).locator('[data-verdict]')).toHaveAttribute(
    'data-verdict',
    'question',
  )
  await expect(window.getByTestId('walkthrough-judged')).toHaveText('2 of 3 layers judged')
  // The same key again clears it.
  await window.keyboard.press('3')
  await expect(window.getByTestId('walkthrough-judged')).toHaveText('1 of 3 layers judged')

  // Esc leaves the walkthrough; the review is where it was, verdicts kept.
  await window.keyboard.press('Escape')
  await expect(focusBar(window)).toHaveCount(0)
  await expect(window.locator('header:has(h1)')).toContainText('#482')
  await expect(sidebar(window)).toBeVisible()
  await expect(layers(window).nth(0).locator('[data-verdict]')).toHaveAttribute(
    'data-verdict',
    'good',
  )
})

test('in the walkthrough, lines and threads go to the chat draft; the panel shows them on the way out', async ({
  window,
}, testInfo) => {
  await openWalkthrough(window)

  // The coupon service layer: a note on line 18 (new side). Enter adds it and closes the input.
  const lineButton = window.getByRole('button', { name: 'Add line 18 to the AI chat' }).first()
  await lineButton.click()
  const input = window.getByRole('textbox', { name: 'Note for the AI about line 18' })
  await expect(input).toBeFocused()
  await input.fill('Why multiply by (1 - discountRate) here?')
  await input.press('Enter')
  await expect(window.getByTestId('line-chat-input')).toHaveCount(0)
  await expect(lineButton).toHaveAttribute('data-pending', 'true')

  // Esc closes the input without adding anything (and without leaving the walkthrough).
  await window.getByRole('button', { name: 'Add line 9 to the AI chat' }).first().click()
  await window.getByRole('textbox', { name: 'Note for the AI about line 9' }).press('Escape')
  await expect(window.getByTestId('line-chat-input')).toHaveCount(0)
  await expect(focusBar(window)).toBeVisible()

  // The thread sparkle toggles: lit while the thread is in the draft.
  const thread = window.locator('[data-thread-id="thread-482-1"]')
  await thread.getByRole('button', { name: 'Add this thread to the AI chat' }).click()
  const remove = thread.getByRole('button', { name: 'Remove this thread from the AI chat' })
  await expect(remove).toHaveAttribute('aria-pressed', 'true')
  await remove.click()
  await expect(
    thread.getByRole('button', { name: 'Add this thread to the AI chat' }),
  ).toHaveAttribute('aria-pressed', 'false')
  await thread.getByRole('button', { name: 'Add this thread to the AI chat' }).click()
  await attachScreenshot(window, testInfo, 'walkthrough-chat-pending')

  // The walkthrough keeps the panel out of the way; leaving it shows the chat with both chips.
  await expect(window.getByTestId('ask-tab')).toHaveCount(0)
  await window.keyboard.press('Escape')
  await expect(focusBar(window)).toHaveCount(0)
  const composer = window.getByTestId('chat-composer')
  await expect(window.getByRole('tab', { name: 'Ask', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(composer.getByTestId('chat-chip')).toHaveCount(2)
  await expect(composer.getByTestId('chat-chip').nth(0)).toContainText('coupon-service.ts:18')
  await expect(composer.getByTestId('chat-chip').nth(0)).toContainText('discountRate')
  await expect(composer.getByTestId('chat-chip').nth(1)).toContainText(
    'Thread · coupon-service.ts:16',
  )
})
