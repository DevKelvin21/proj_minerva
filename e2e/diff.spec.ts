import { test, expect, attachScreenshot } from './fixtures'

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
