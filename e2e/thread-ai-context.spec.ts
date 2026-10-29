import { test, expect, attachScreenshot, setViewport } from './fixtures'
import type { Locator, Page } from './fixtures'

/**
 * Ask AI from any thread card (mock universe + mock AI): the sparkle lives in
 * the shared thread card, so the Conversation tab, the Comments tab and the
 * diff all add to the same chat draft; a PR-level thread becomes a "General
 * comment · author" chip; a thread in the draft is pressed and outlined in
 * every view; the composer counts items up front and a full chat disables
 * the toggle with the reason; an outdated thread goes with its code as
 * commented (the mock answer names the origin commit main read it at).
 *
 * shopwave/api #482: thread-482-2 (general, by dkumar), thread-482-1
 * (coupon-service.ts:16). #470: thread-470-1 (outdated, origin 4700c33, line 8).
 */

const PR_482 = 'Add POST /carts/:id/apply-coupon'
const PR_470 = 'Add rate limiting middleware to public endpoints'
const ADD = 'Add this thread to the AI chat'
const REMOVE = 'Remove this thread from the AI chat'

const aside = (page: Page) => page.locator('aside')
const tab = (page: Page, name: RegExp) =>
  page.getByRole('tablist', { name: 'Pull request views' }).getByRole('tab', { name })
const card = (page: Page, threadId: string) =>
  page.locator('[data-thread-id="' + threadId + '"]').first()
const toggle = (thread: Locator) => thread.getByTestId('thread-chat-toggle')
const composer = (page: Page) => page.getByTestId('chat-composer')
const chips = (page: Page) => composer(page).getByTestId('chat-chip')
const count = (page: Page) => composer(page).getByTestId('chat-context-count')
const transcript = (page: Page) => page.getByTestId('chat-transcript')

async function openPr(page: Page, title: string): Promise<void> {
  await aside(page).getByText(title).first().click()
  await expect(page.getByRole('heading', { name: title }).first()).toBeVisible()
}

async function ask(page: Page, text: string): Promise<Locator> {
  const box = page.getByRole('textbox', { name: 'Your question about this pull request' })
  await box.fill(text)
  await box.press('Enter')
  const answer = transcript(page).locator('[data-role="assistant"]').last()
  await expect(answer).toHaveAttribute('data-status', 'done', { timeout: 30_000 })
  return answer
}

/** Adds diff line `line` of the open file to the chat, with no note. */
async function addLine(page: Page, line: number): Promise<void> {
  await page.getByRole('button', { name: `Add line ${line} to the AI chat` }).first().click()
  await page.getByRole('button', { name: 'Add to chat', exact: true }).click()
  await expect(page.getByTestId('line-chat-input')).toHaveCount(0)
}

async function expectInChat(thread: Locator): Promise<void> {
  await expect(toggle(thread)).toHaveAttribute('aria-pressed', 'true')
  await expect(toggle(thread)).toHaveAttribute('aria-label', REMOVE)
  await expect(thread).toHaveAttribute('data-in-chat', 'true')
}

test('a general thread from Conversation and a line thread from Comments: chips, counter, pressed everywhere', async ({
  window,
}, testInfo) => {
  await setViewport(window, 1600, 1000)
  await openPr(window, PR_482)
  await tab(window, /^Conversation/).click()

  // The general (PR-level) thread has the toggle too; the first add opens the Ask panel.
  const general = card(window, 'thread-482-2')
  await expect(toggle(general)).toHaveAttribute('aria-pressed', 'false')
  await expect(general).not.toHaveAttribute('data-in-chat')
  await general.getByRole('button', { name: ADD }).click()
  await expect(window.getByTestId('ask-tab')).toBeVisible()
  await expectInChat(general)
  await expect(chips(window)).toHaveCount(1)
  await expect(chips(window).first()).toHaveAttribute('data-kind', 'general')
  await expect(chips(window).first()).toContainText('General comment · dkumar')
  await expect(chips(window).first()).toContainText('falta el caso de cupón ya aplicado')
  await expect(count(window)).toHaveText('1 of 10 context items')

  // The line thread, from the Comments tab; the general one shows as added there too.
  await tab(window, /^Comments/).click()
  await expectInChat(card(window, 'thread-482-2'))
  const lineThread = card(window, 'thread-482-1')
  await lineThread.getByRole('button', { name: ADD }).click()
  await expectInChat(lineThread)
  await expect(chips(window)).toHaveCount(2)
  await expect(chips(window).nth(1)).toContainText('Thread · coupon-service.ts:16')
  await expect(count(window)).toHaveText('2 of 10 context items')
  await attachScreenshot(window, testInfo, 'thread-ai-comments')

  // On means on everywhere: Conversation and the diff show both as added.
  await tab(window, /^Conversation/).click()
  await expectInChat(card(window, 'thread-482-1'))
  await expectInChat(card(window, 'thread-482-2'))
  await chips(window).nth(1).getByRole('button', { name: 'Thread · coupon-service.ts:16', exact: true }).click()
  await expect(tab(window, /^Files/)).toHaveAttribute('aria-selected', 'true')
  await expectInChat(card(window, 'thread-482-1'))

  // The general chip jumps back to its card in the Conversation tab.
  await chips(window).first().getByRole('button', { name: 'General comment · dkumar', exact: true }).click()
  await expect(tab(window, /^Conversation/)).toHaveAttribute('aria-selected', 'true')
  await expect(card(window, 'thread-482-2')).toBeFocused()

  // The question reaches the (mock) AI with both items.
  const answer = await ask(window, 'Is the general concern answered by the code?')
  await expect(answer).toContainText('Mock answer with 2 context items.')
  await expect(answer).toContainText('general comment (thread)')
  await expect(answer).toContainText('src/services/coupon-service.ts:16 (thread)')
  const question = transcript(window).locator('[data-role="user"]').last()
  await expect(question.getByTestId('chat-chip')).toHaveCount(2)
  await expect(question.getByTestId('chat-chip').first()).toContainText('General comment · dkumar')
  // Sent: the draft is empty, so no card is marked any more.
  await expect(count(window)).toHaveText('0 of 10 context items')
  await expect(toggle(card(window, 'thread-482-2'))).toHaveAttribute('aria-pressed', 'false')
  await expect(card(window, 'thread-482-2')).not.toHaveAttribute('data-in-chat')

  // "Use as reply" on the general comment lands in its reply box, in the Conversation tab.
  await answer.getByRole('button', { name: 'Use as…' }).click()
  await window
    .getByRole('menu', { name: 'Use as…' })
    .getByRole('menuitem', { name: 'Use as reply to the general comment by dkumar' })
    .click()
  await expect(tab(window, /^Conversation/)).toHaveAttribute('aria-selected', 'true')
  await expect(
    card(window, 'thread-482-2').getByRole('textbox', { name: 'Reply to this thread' }),
  ).toHaveValue(/Mock answer with 2 context items/)

  // Tiled: the chips, the counter and the outlined card at a narrower window.
  await card(window, 'thread-482-2').getByRole('button', { name: ADD }).click()
  await card(window, 'thread-482-1').getByRole('button', { name: ADD }).click()
  await setViewport(window, 1100, 900)
  await expect(count(window)).toHaveText('2 of 10 context items')
  await expectInChat(card(window, 'thread-482-1'))
  await attachScreenshot(window, testInfo, 'thread-ai-tiled')
})

test('a full chat disables the toggle of threads not in it, and says why', async ({
  window,
}, testInfo) => {
  await setViewport(window, 1600, 1000)
  await openPr(window, PR_482)
  await tab(window, /^Comments/).click()
  await card(window, 'thread-482-1').getByRole('button', { name: ADD }).click()
  await expect(count(window)).toHaveText('1 of 10 context items')

  // Nine diff lines fill the chat.
  await window.locator('[role="link"]', { hasText: /coupon-service\.ts:16/ }).first().click()
  await expect(tab(window, /^Files/)).toHaveAttribute('aria-selected', 'true')
  for (const line of [3, 4, 5, 6, 9, 10, 11, 12, 13]) await addLine(window, line)
  await expect(count(window)).toHaveText('10 of 10 context items')

  await tab(window, /^Conversation/).click()
  const general = card(window, 'thread-482-2')
  const blocked = general.getByRole('button', { name: ADD })
  await expect(blocked).toHaveAttribute('aria-disabled', 'true')
  await expect(blocked).toHaveAttribute(
    'title',
    'The chat already holds 10 items: send or remove some first.',
  )
  await blocked.click({ force: true })
  await expect(count(window)).toHaveText('10 of 10 context items')
  await expect(general).not.toHaveAttribute('data-in-chat')
  // A thread already in it can still be removed.
  const inChat = card(window, 'thread-482-1')
  await expect(toggle(inChat)).not.toHaveAttribute('aria-disabled')
  await general.scrollIntoViewIfNeeded()
  await attachScreenshot(window, testInfo, 'thread-ai-full')
  await toggle(inChat).click()
  await expect(count(window)).toHaveText('9 of 10 context items')
  await expect(blocked).not.toHaveAttribute('aria-disabled')
})

test('an outdated thread goes with its code as commented', async ({ window }) => {
  await setViewport(window, 1600, 1000)
  await openPr(window, PR_470)
  await tab(window, /^Comments/).click()
  await card(window, 'thread-470-1').getByRole('button', { name: ADD }).click()
  await expect(chips(window).first()).toContainText('Thread · rate-limit.ts:8')
  await expect(chips(window).first()).toContainText('Outdated')
  const answer = await ask(window, 'Was this fixed after the comment?')
  // Main read the file at the thread's origin commit (4700c33), not at the PR head.
  await expect(answer).toContainText('src/middleware/rate-limit.ts:8 @ 4700c33 (thread)')
})
