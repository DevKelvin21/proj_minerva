import {
  test,
  expect,
  attachScreenshot,
  closeMinerva,
  launchMinerva,
  mainWindow,
  openAskTab,
  setViewport,
} from './fixtures'
import type { Page } from './fixtures'

/**
 * Side-panel chat ("Ask" tab of the AI panel), mock universe + mock AI
 * (`MINERVA_MOCK=1 MINERVA_MOCK_AI=1`): gather two diff lines and a comment
 * thread as context chips, send, follow the streamed answer, turn it into a
 * comment draft, keep several conversations (new / switch / delete), and
 * find them again after a restart (main saves them in userData).
 */

const PR_TITLE = 'Add POST /carts/:id/apply-coupon'
const composer = (page: Page) => page.getByTestId('chat-composer')
const question = (page: Page) =>
  page.getByRole('textbox', { name: 'Your question about this pull request' })
const transcript = (page: Page) => page.getByTestId('chat-transcript')
const listToggle = (page: Page) => page.getByTestId('chat-conversation-toggle')
const conversations = (page: Page) =>
  page.getByTestId('chat-conversation-list').getByTestId('chat-conversation')

/** #482 in the Files tab on coupon-service.ts (through the Conversation tab's `path:line` chip). */
async function openCouponService(window: Page): Promise<void> {
  await window.getByText(PR_TITLE).first().click()
  const chip = window.locator('[role="link"]', { hasText: /coupon-service\.ts:\d+/ }).first()
  await chip.click()
  await expect(window.locator('[data-thread-id="thread-482-1"]')).toBeVisible()
}

async function addLine(window: Page, line: number, note: string): Promise<void> {
  await window
    .getByRole('button', { name: `Add line ${line} to the AI chat` })
    .first()
    .click()
  const input = window.getByRole('textbox', { name: `Note for the AI about line ${line}` })
  await input.fill(note)
  if (note) await input.press('Enter')
  else await window.getByRole('button', { name: 'Add to chat', exact: true }).click()
  await expect(window.getByTestId('line-chat-input')).toHaveCount(0)
}

async function ask(window: Page, text: string): Promise<void> {
  await question(window).fill(text)
  await question(window).press('Enter')
  const answer = transcript(window).locator('[data-role="assistant"]').last()
  await expect(answer).toHaveAttribute('data-status', 'done', { timeout: 30_000 })
}

test('lines and a thread become chips, the answer streams in, and it can become a comment draft', async ({
  window,
}, testInfo) => {
  await setViewport(window, 1600, 1000)
  await openCouponService(window)

  // The panel opens on Ask, with the hint while nothing is open.
  await expect(window.getByRole('tab', { name: 'Ask', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(window.getByTestId('ask-tab')).toContainText('Ask about this pull request')

  // Real tabs: one Tab stop, arrows switch and move focus, the panel is labelled by its tab.
  const askTab = window.getByRole('tab', { name: 'Ask', exact: true })
  const analysisTab = window.getByRole('tab', { name: 'Analysis', exact: true })
  await expect(analysisTab).toHaveAttribute('tabindex', '-1')
  await askTab.focus()
  await window.keyboard.press('ArrowRight')
  await expect(analysisTab).toBeFocused()
  await expect(analysisTab).toHaveAttribute('aria-selected', 'true')
  await expect(window.getByRole('tabpanel', { name: 'Analysis' })).toBeVisible()
  await window.keyboard.press('Home')
  await expect(askTab).toBeFocused()
  await expect(askTab).toHaveAttribute('aria-selected', 'true')

  // Two lines (one with a note) and the thread on line 16.
  await addLine(window, 12, 'Is the expiry check inclusive?')
  await addLine(window, 18, '')
  await expect(
    window.getByRole('button', { name: 'Add line 12 to the AI chat' }).first(),
  ).toHaveAttribute('data-pending', 'true')
  const thread = window.locator('[data-thread-id="thread-482-1"]')
  await thread.getByRole('button', { name: 'Add this thread to the AI chat' }).click()

  const chips = composer(window).getByTestId('chat-chip')
  await expect(chips).toHaveCount(3)
  await expect(chips.nth(0)).toContainText('coupon-service.ts:12')
  await expect(chips.nth(0)).toContainText('Is the expiry check inclusive?')
  await expect(chips.nth(1)).toContainText('coupon-service.ts:18')
  await expect(chips.nth(2)).toContainText('Thread · coupon-service.ts:16')
  await expect(composer(window)).toContainText('3 of 10 context items')
  await attachScreenshot(window, testInfo, 'chat-chips')

  // Send: before its first words the answer says which step it is on (the
  // mock explores for a moment, then writes); the question keeps its chips,
  // the answer streams, the draft empties.
  await question(window).fill('What could go wrong with these coupons?')
  await question(window).press('Enter')
  const pending = transcript(window).locator('[data-role="assistant"]').last()
  await expect(pending.getByRole('status')).toHaveText('Reading the code at the PR commit…')
  await attachScreenshot(window, testInfo, 'chat-stage-exploring')
  await expect(pending).toHaveAttribute('data-status', 'done', { timeout: 30_000 })
  const userMessage = transcript(window).locator('[data-role="user"]').first()
  await expect(userMessage).toContainText('What could go wrong with these coupons?')
  await expect(userMessage.getByTestId('chat-chip')).toHaveCount(3)
  const answer = transcript(window).locator('[data-role="assistant"]').first()
  await expect(answer).toContainText(/context item/i)
  await expect(chips).toHaveCount(0)
  await expect(
    window.getByRole('button', { name: 'Add line 12 to the AI chat' }).first(),
  ).not.toHaveAttribute('data-pending', 'true')
  await attachScreenshot(window, testInfo, 'chat-answer')

  // The conversation is listed, titled by its first question.
  await listToggle(window).click()
  await expect(conversations(window)).toHaveCount(1)
  await expect(conversations(window).first()).toContainText('What could go wrong')
  await listToggle(window).click()

  // "Use as…": one target per item of the question; the line's composer opens with the answer.
  // The menu (portaled to body, so the transcript's scroll never clips it)
  // opens on its first item; Esc closes it and gives focus back to the trigger.
  const useAs = answer.getByRole('button', { name: 'Use as…' })
  const menu = window.getByRole('menu', { name: 'Use as…' })
  await useAs.click()
  await expect(menu.getByRole('menuitem').first()).toBeFocused()
  await window.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  await expect(useAs).toBeFocused()
  await window.keyboard.press('ArrowDown')
  await expect(menu.getByRole('menuitem').first()).toBeFocused()
  await attachScreenshot(window, testInfo, 'chat-use-as-menu')
  await menu
    .getByRole('menuitem', { name: 'Use as comment on src/services/coupon-service.ts:18' })
    .click()
  const draft = window.getByRole('textbox', { name: /Comment on line 18/ })
  await expect(draft).toBeVisible()
  await expect(draft).not.toHaveValue('')
  await window
    .locator('form')
    .filter({ has: draft })
    .getByRole('button', { name: 'Cancel', exact: true })
    .click()
  await expect(draft).toHaveCount(0)
})

test('several conversations: new, switch back, delete', async ({ window }, testInfo) => {
  await setViewport(window, 1600, 1000)
  await window.getByText(PR_TITLE).first().click()
  await openAskTab(window)

  await ask(window, 'First question about the PR')
  await window.getByRole('button', { name: 'New conversation', exact: true }).click()
  await expect(window.getByTestId('ask-tab')).toContainText('Ask about this pull request')
  await expect(transcript(window)).toHaveCount(0)

  await ask(window, 'Second question about the PR')
  await expect(transcript(window)).not.toContainText('First question about the PR')

  // Newest first; picking the older one shows its messages again.
  await listToggle(window).click()
  await expect(conversations(window)).toHaveCount(2)
  await expect(conversations(window).nth(0)).toContainText('Second question')
  await conversations(window).nth(1).getByRole('menuitemradio').click()
  await expect(transcript(window)).toContainText('First question about the PR')
  await expect(transcript(window)).not.toContainText('Second question about the PR')
  await expect(listToggle(window)).toBeFocused()
  await attachScreenshot(window, testInfo, 'chat-switch')

  // A menu: it opens on the open conversation, arrows move, Esc closes back to the toggle,
  // and `aria-controls` points at it only while it is open.
  await expect(listToggle(window)).not.toHaveAttribute('aria-controls')
  await listToggle(window).click()
  const list = window.getByRole('menu', { name: 'Conversations about this pull request' })
  await expect(listToggle(window)).toHaveAttribute('aria-controls', 'chat-conversation-list')
  const firstItem = conversations(window)
    .filter({ hasText: 'First question' })
    .getByRole('menuitemradio')
  const secondItem = conversations(window)
    .filter({ hasText: 'Second question' })
    .getByRole('menuitemradio')
  await expect(firstItem).toHaveAttribute('aria-checked', 'true')
  await expect(firstItem).toBeFocused()
  await window.keyboard.press('ArrowDown')
  await expect(secondItem).toBeFocused()
  await window.keyboard.press('Home')
  await expect(secondItem).toBeFocused()
  await window.keyboard.press('End')
  await expect(firstItem).toBeFocused()
  await attachScreenshot(window, testInfo, 'chat-list-open')
  await window.keyboard.press('Escape')
  await expect(list).toHaveCount(0)
  await expect(listToggle(window)).toBeFocused()
  // The AI panel stays open: that Esc belonged to the list.
  await expect(window.getByTestId('ask-tab')).toBeVisible()

  // A click outside closes it too.
  await listToggle(window).click()
  await expect(list).toBeVisible()
  await composer(window).click({ position: { x: 4, y: 4 } })
  await expect(list).toHaveCount(0)

  // Delete (with a confirm) the open one: the confirm takes focus, Esc cancels only the confirm.
  await listToggle(window).focus()
  await window.keyboard.press('ArrowDown')
  await expect(firstItem).toBeFocused()
  await window.keyboard.press('ArrowRight')
  const first = conversations(window).filter({ hasText: 'First question' })
  const trash = first.getByRole('menuitem', { name: /^Delete conversation/ })
  await expect(trash).toBeFocused()
  await window.keyboard.press('Enter')
  const confirm = first.getByRole('menuitem', { name: 'Delete', exact: true })
  await expect(confirm).toBeFocused()
  await window.keyboard.press('Escape')
  await expect(confirm).toHaveCount(0)
  await expect(list).toBeVisible()
  await expect(trash).toBeFocused()
  await trash.click()
  await expect(confirm).toBeFocused()
  await attachScreenshot(window, testInfo, 'chat-delete-confirm')
  await confirm.click()
  // The panel goes back to a new conversation; focus lands on the row that took its place.
  await expect(conversations(window)).toHaveCount(1)
  await expect(conversations(window).first()).toContainText('Second question')
  await expect(secondItem).toBeFocused()
  await expect(window.getByTestId('ask-tab')).toContainText('Ask about this pull request')

  // Deleting the last one closes the list and focus goes back to the toggle.
  await window.keyboard.press('ArrowRight')
  await window.keyboard.press('Enter')
  await window.keyboard.press('Enter')
  await expect(list).toHaveCount(0)
  await expect(window.getByTestId('chat-conversation-list')).toHaveCount(0)
  await expect(listToggle(window)).toBeFocused()
})

// eslint-disable-next-line no-empty-pattern
test('conversations survive a restart', async ({}, testInfo) => {
  const userDataDir = testInfo.outputPath('user-data')

  const app1 = await launchMinerva(userDataDir)
  try {
    const win1 = await mainWindow(app1)
    await setViewport(win1, 1600, 1000)
    await win1.getByText(PR_TITLE).first().click()
    await openAskTab(win1)
    await ask(win1, 'Will this survive a restart?')
  } finally {
    await closeMinerva(app1)
  }

  const app2 = await launchMinerva(userDataDir)
  try {
    const win2 = await mainWindow(app2)
    await setViewport(win2, 1600, 1000)
    await win2.getByText(PR_TITLE).first().click()
    await openAskTab(win2)
    await listToggle(win2).click()
    await expect(conversations(win2)).toHaveCount(1)
    await expect(conversations(win2).first()).toContainText('Will this survive a restart?')
    await conversations(win2).first().getByRole('menuitemradio').click()
    await expect(transcript(win2)).toContainText('Will this survive a restart?')
    await expect(transcript(win2).locator('[data-role="assistant"]')).toHaveAttribute(
      'data-status',
      'done',
    )
  } finally {
    await closeMinerva(app2)
  }
})

test('narrow window: the chat is an overlay and adding a line leaves the diff in view', async ({
  window,
}, testInfo) => {
  await setViewport(window, 1600, 1000)
  await openCouponService(window)
  await setViewport(window, 700, 900)

  // The panel opens over the center on `sm`; close it to work on the diff.
  const askTab = window.getByTestId('ask-tab')
  await expect(askTab).toBeVisible()
  // The tier follows the resize a frame later: wait for the overlay width.
  await expect
    .poll(async () => (await askTab.boundingBox())?.width ?? Infinity)
    .toBeLessThanOrEqual(360)
  await expect(question(window)).toBeVisible()
  // A drawer: Esc closes it too, the title bar toggle brings it back.
  await window.keyboard.press('Escape')
  await expect(askTab).toHaveCount(0)
  await window.locator('header button[aria-label="AI panel"]').click()
  await expect(askTab).toBeVisible()
  await window.getByRole('button', { name: 'Close AI panel' }).click()
  await expect(askTab).toHaveCount(0)

  // Adding a line here does not cover the diff again: the chip waits in the draft.
  await addLine(window, 18, 'Rounding?')
  await expect(askTab).toHaveCount(0)
  await window.locator('header button[aria-label="AI panel"]').click()
  await expect(composer(window).getByTestId('chat-chip')).toHaveCount(1)
  await expect(composer(window).getByTestId('chat-chip')).toContainText('Rounding?')
  await attachScreenshot(window, testInfo, 'chat-narrow')

  // The conversation list opens over the overlay without being clipped; Esc closes the list only.
  await ask(window, 'Rounding in the overlay?')
  await listToggle(window).click()
  await expect(conversations(window).first().getByRole('menuitemradio')).toBeFocused()
  const listBox = await window.getByTestId('chat-conversation-list').boundingBox()
  expect(listBox?.width ?? 0).toBeGreaterThan(200)
  await attachScreenshot(window, testInfo, 'chat-narrow-list')
  await window.keyboard.press('Escape')
  await expect(window.getByTestId('chat-conversation-list')).toHaveCount(0)
  await expect(askTab).toBeVisible()
  await window.keyboard.press('Escape')
  await expect(askTab).toHaveCount(0)
})
