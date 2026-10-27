import { test, expect, attachScreenshot, setViewport } from './fixtures'
import type { Page } from './fixtures'

/**
 * Full-screen walkthrough (Walkthrough button in the PR bar): the Files tab
 * in layers mode with the sidebar, PR bar and didactic panel out of the way,
 * a verdict bar, the title bar's Exit + progress, and "Ask AI" on a diff line
 * (`ai:askAboutLines`, mock answer with MINERVA_MOCK_AI=1).
 */

const sidebar = (page: Page) => page.locator('aside[aria-label="Pull request list"]')
const focusBar = (page: Page) => page.getByTestId('walkthrough-focus-bar')
const layers = (page: Page) => page.getByTestId('layer-item')

async function openWalkthrough(window: Page): Promise<void> {
  await setViewport(window, 1600, 1000)
  await window.getByText('Add POST /carts/:id/apply-coupon').first().click()
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
  await focusBar(window).getByRole('button', { name: /Question/ }).click()
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

test('Ask AI on a line: the answer shows under it and can become a comment draft', async ({
  window,
}, testInfo) => {
  await openWalkthrough(window)

  // The coupon service layer: ask about line 18 (new side).
  await window.getByRole('button', { name: 'Ask AI about line 18' }).first().click()
  const card = window.getByTestId('ask-ai-card')
  await expect(card).toBeVisible()
  await card.getByRole('textbox').fill('Why multiply by (1 - discountRate) here?')
  await card.getByRole('button', { name: 'Ask', exact: true }).click()
  const answer = card.getByTestId('ask-ai-answer')
  await expect(answer).toContainText('src/services/coupon-service.ts:18', { timeout: 30_000 })
  await expect(card).toContainText('Why multiply by (1 - discountRate) here?')
  await attachScreenshot(window, testInfo, 'walkthrough-ask-ai')

  // "Use as comment": the line's composer opens with the answer as a draft; nothing is posted.
  await card.getByRole('button', { name: 'Use as comment' }).click()
  await expect(card).toHaveCount(0)
  const draft = window.getByRole('textbox', { name: /Comment on line 18/ })
  await expect(draft).toBeVisible()
  await expect(draft).toHaveValue(/Mock answer for `src\/services\/coupon-service.ts:18`/)
})
