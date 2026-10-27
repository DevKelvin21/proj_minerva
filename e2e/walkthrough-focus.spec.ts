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

test('Ask AI on a line: the conversation keeps every answer, survives closing, and can become a comment draft', async ({
  window,
}, testInfo) => {
  await openWalkthrough(window)

  // The coupon service layer: ask about line 18 (new side).
  const lineButton = window.getByRole('button', { name: 'Ask AI about line 18' }).first()
  await lineButton.click()
  const card = window.getByTestId('ask-ai-card')
  await expect(card).toBeVisible()
  await card.getByRole('textbox').fill('Why multiply by (1 - discountRate) here?')
  await card.getByRole('button', { name: 'Ask', exact: true }).click()
  const answers = card.getByTestId('ask-ai-answer')
  await expect(answers.nth(0)).toContainText('src/services/coupon-service.ts:18', {
    timeout: 30_000,
  })
  await expect(card).toContainText('Why multiply by (1 - discountRate) here?')

  // A follow-up keeps the first answer on screen and carries it to the AI.
  await card.getByRole('textbox').fill('Could the rate ever be above 1?')
  await card
    .getByRole('textbox')
    .press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter')
  await expect(answers).toHaveCount(2, { timeout: 30_000 })
  await expect(answers.nth(1)).toContainText('Follow-up 2')
  await expect(answers.nth(0)).not.toContainText('Follow-up')
  await expect(card).toContainText('Could the rate ever be above 1?')
  await attachScreenshot(window, testInfo, 'walkthrough-ask-ai-history')

  // Closing loses nothing: the line's button stays lit and reopens the same conversation.
  await card.getByRole('button', { name: 'Close' }).click()
  await expect(card).toHaveCount(0)
  await expect(lineButton).toHaveAttribute('data-asked', 'true')
  await lineButton.click()
  await expect(window.getByTestId('ask-ai-exchange')).toHaveCount(2)
  await expect(card).toContainText('Why multiply by (1 - discountRate) here?')

  // "Use as comment": the line's composer opens with that answer as a draft; nothing is posted.
  await card.getByRole('button', { name: 'Use as comment' }).first().click()
  await expect(card).toHaveCount(0)
  const draft = window.getByRole('textbox', { name: /Comment on line 18/ })
  await expect(draft).toBeVisible()
  await expect(draft).toHaveValue(/Mock answer for `src\/services\/coupon-service.ts:18`/)
})

test('Ask AI from a comment thread: the thread is the context and the answer becomes a reply draft', async ({
  window,
}, testInfo) => {
  await openWalkthrough(window)

  // The thread on coupon-service.ts:16 (two comments, folded under its line).
  const thread = window.locator('[data-thread-id="thread-482-1"]')
  await expect(thread).toBeVisible()
  const threadButton = thread.getByRole('button', { name: 'Ask AI about this thread' })
  await threadButton.click()
  const card = window.getByTestId('ask-ai-card')
  await expect(card).toContainText('Ask AI about this thread')

  // A quick question asks in one click; the thread reached the AI.
  await card.getByRole('button', { name: 'Is this concern valid?' }).click()
  const answer = card.getByTestId('ask-ai-answer')
  await expect(answer).toContainText('a thread of 2 comment(s); the first one is by dkumar', {
    timeout: 30_000,
  })
  await expect(answer).toContainText('src/services/coupon-service.ts:16')
  await expect(card).toContainText('Is this concern valid?')
  await expect(threadButton).toHaveAttribute('data-asked', 'true')
  await attachScreenshot(window, testInfo, 'walkthrough-ask-ai-thread')

  // "Use as reply": the thread opens with the answer in its reply box; nothing is posted.
  await card.getByRole('button', { name: 'Use as reply' }).click()
  await expect(card).toHaveCount(0)
  const reply = thread.getByRole('textbox', { name: 'Reply to this thread' })
  await expect(reply).toBeFocused()
  await expect(reply).toHaveValue(/Mock answer for `src\/services\/coupon-service.ts:16`/)
  await expect(thread.locator('li')).toHaveCount(2)

  // With the thread open, a second answer goes after what the reviewer typed, never over it.
  await reply.fill('My own note.')
  await threadButton.click()
  await expect(card.getByTestId('ask-ai-exchange')).toHaveCount(1)
  await card.getByRole('button', { name: 'Use as reply' }).click()
  await expect(card).toHaveCount(0)
  await expect(reply).toHaveValue(/^My own note\.\n\nMock answer for /)
  await expect(reply).toBeFocused()
})
