import { test, expect, attachScreenshot, setViewport } from './fixtures'
import type { Locator } from '@playwright/test'

/**
 * Port de scripts/smoke-diff.mjs (T7): PR #201 → tab Archivos → árbol de
 * archivos + diff, toggles de vista y archivo renombrado sin patch.
 */

test('vista de diff del PR #201: árbol, hunks, toggles y renamed', async ({ window }, testInfo) => {
  await window.getByText('Refactor checkout state machine').first().click()
  await window.getByText('Files').first().click()

  // Archivos del PR listados y diff con separadores de hunk.
  await expect(window.getByText(/checkout-validation|checkout-state/).first()).toBeVisible()
  await expect(window.getByText('@@').first()).toBeVisible()

  // Contador +N −M en la toolbar.
  const body = window.locator('body')
  await expect(body).toContainText(/\+\d+/)
  await expect(body).toContainText(/-\d+/)

  // Toggle a vista inline (botón por title/aria-label, como la suite legacy).
  await window.locator('[title*="nline"], [aria-label*="nline"]').first().click()
  await expect(window.getByText('@@').first()).toBeVisible()

  // Toggle word wrap.
  await window.locator('[title*="rap"], [aria-label*="rap"]').first().click()

  await attachScreenshot(window, testInfo, 'diff-201')

  // Archivo renombrado sin patch → mensaje sin vista previa.
  await window.getByText('checkout-state.ts').first().click()
  await expect(window.getByText(/No preview available|[Ss]in vista previa/).first()).toBeVisible()
})

test('diff gutter: one action group per row, one Tab stop, one insert shape', async ({
  window,
}, testInfo) => {
  await setViewport(window, 1600, 1000)
  await window.getByText('Add POST /carts/:id/apply-coupon').first().click()
  await window.locator('[role="link"]', { hasText: /coupon-service\.ts:\d+/ }).first().click()
  await expect(window.locator('[data-thread-id="thread-482-1"]')).toBeVisible()
  const inlineToggle = window.getByRole('button', { name: 'Inline view' })
  await inlineToggle.click()
  await expect(inlineToggle).toHaveAttribute('aria-pressed', 'true')

  // Hover reveals the row's group: Comment + Add to chat, ONE Tab stop.
  const group = window.getByRole('group', { name: 'Line 12 actions' }).first()
  const comment = group.getByRole('button', { name: 'Add a comment on this line' })
  const sparkle = group.getByRole('button', { name: 'Add line 12 to the AI chat' })
  await expect(comment).toHaveCSS('opacity', '0')
  await window.locator('[data-new-line="12"]').first().hover()
  await expect(comment).toHaveCSS('opacity', '1')
  await expect(sparkle).toHaveCSS('opacity', '1')
  await expect(sparkle).toHaveAttribute('aria-pressed', 'false')
  await expect(group.locator('[tabindex="0"]')).toHaveCount(1)
  await expect(comment).toHaveAttribute('tabindex', '0')
  await expect(sparkle).toHaveAttribute('tabindex', '-1')
  await expect(window.getByRole('button', { name: /line 0\b/ })).toHaveCount(0)
  await attachScreenshot(window, testInfo, 'diff-gutter-hover-inline')

  // Arrows move inside the group; the Tab stop follows focus.
  await comment.focus()
  await window.keyboard.press('ArrowRight')
  await expect(sparkle).toBeFocused()
  await expect(sparkle).toHaveAttribute('tabindex', '0')
  await expect(comment).toHaveAttribute('tabindex', '-1')

  // Enter opens the line chat input; Esc closes it and focus returns to the sparkle.
  await window.keyboard.press('Enter')
  const note = window.getByRole('textbox', { name: 'Note for the AI about line 12' })
  await expect(note).toBeFocused()
  await expect(sparkle).toHaveAttribute('aria-expanded', 'true')
  await attachScreenshot(window, testInfo, 'diff-line-chat-input')
  await window.keyboard.press('Escape')
  await expect(window.getByTestId('line-chat-input')).toHaveCount(0)
  await expect(sparkle).toBeFocused()

  // The composer and the chat input never stack under the same row.
  await sparkle.click()
  await expect(window.getByTestId('line-chat-input')).toHaveCount(1)
  await comment.click()
  const composer = window.getByLabel('Comment on line 12')
  await expect(composer).toBeVisible()
  await expect(window.getByTestId('line-chat-input')).toHaveCount(0)
  await sparkle.click()
  await expect(window.getByTestId('line-chat-input')).toHaveCount(1)
  await expect(composer).toHaveCount(0)

  // Added to the chat: "in the chat" is aria-pressed, focus back on the sparkle.
  await note.fill('Inclusive?')
  await note.press('Enter')
  await expect(window.getByTestId('line-chat-input')).toHaveCount(0)
  await expect(sparkle).toHaveAttribute('aria-pressed', 'true')
  await expect(sparkle).toHaveAttribute('data-pending', 'true')
  await expect(sparkle).toBeFocused()

  // A thread and a composer: the same insert shape (inset, border, font).
  const row18 = window.getByRole('group', { name: 'Line 18 actions' }).first()
  await window.locator('[data-new-line="18"]').first().hover()
  await row18.getByRole('button', { name: 'Add a comment on this line' }).click()
  const composer18 = window.getByLabel('Comment on line 18')
  await expect(composer18).toBeVisible()
  const inserts = window.locator('[data-diff-insert]')
  const shape = (loc: Locator): Promise<string> =>
    loc.evaluate((el) => {
      const cs = getComputedStyle(el)
      return [cs.paddingLeft, cs.paddingRight, cs.borderBottomWidth, cs.fontFamily].join('|')
    })
  const threadShape = await shape(
    inserts.filter({ has: window.locator('[data-thread-id="thread-482-1"]') }),
  )
  expect(threadShape).toBe(await shape(inserts.filter({ has: composer18 })))
  await composer18.scrollIntoViewIfNeeded()
  await attachScreenshot(window, testInfo, 'diff-thread-composer-insert')
  await window.getByRole('button', { name: 'Cancel', exact: true }).last().click()
  await expect(composer18).toHaveCount(0)

  // Split: the same group, on the new side.
  const splitToggle = window.getByRole('button', { name: 'Split view' })
  await splitToggle.click()
  await expect(splitToggle).toHaveAttribute('aria-pressed', 'true')
  const split12 = window.getByRole('group', { name: 'Line 12 actions' }).first()
  await window.locator('[data-new-line="12"]').first().hover()
  await expect(split12.getByRole('button', { name: 'Add a comment on this line' })).toHaveCSS(
    'opacity',
    '1',
  )
  await expect(split12.locator('[tabindex="0"]')).toHaveCount(1)
  await attachScreenshot(window, testInfo, 'diff-gutter-hover-split')

  // Tiled 960x540 (split falls back to inline): the line stays in the chat, no page overflow.
  await setViewport(window, 960, 540)
  const line12 = window.locator('[data-new-line="12"]').first()
  await line12.scrollIntoViewIfNeeded()
  await line12.hover()
  await expect(
    window
      .getByRole('group', { name: 'Line 12 actions' })
      .first()
      .getByRole('button', { name: 'Add line 12 to the AI chat' }),
  ).toHaveAttribute('aria-pressed', 'true')
  const overflow = await window.evaluate(() => document.body.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(0)
  await attachScreenshot(window, testInfo, 'diff-gutter-960x540')
})
