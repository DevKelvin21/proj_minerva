import { test, expect, attachScreenshot, setViewport, openAnalysisTab } from './fixtures'
import type { Page } from './fixtures'

/**
 * Guided walkthrough ("Layers" view of the Files tab): the mock analysis of
 * PR #482 carries a `walkthrough` section with one cohort of three layers
 * anchored to line ranges (`src/main/ai/fixtures.ts`). The suite checks the
 * placeholder, the navigator, the context bar, the line markers in the diff,
 * J/K navigation, and the jump from the didactic panel's card.
 */

async function openLayersView(window: Page): Promise<void> {
  await window.getByText('Files').first().click()
  await window.getByRole('button', { name: 'Layers view (guided walkthrough)' }).click()
}

test('layers view offers the analysis, then lists cohorts and layers with their context', async ({ window }, testInfo) => {
  await window.getByText('Add POST /carts/:id/apply-coupon').first().click()
  await openLayersView(window)

  // No analysis yet: placeholder with its own "Analyze PR" button.
  const placeholder = window.getByTestId('layers-placeholder')
  await expect(placeholder).toBeVisible()
  await placeholder.getByRole('button', { name: 'Analyze PR' }).click()

  // The walkthrough arrives (streaming) and the first layer auto-selects.
  const navigator = window.getByTestId('layer-navigator')
  await expect(navigator).toBeVisible({ timeout: 30_000 })
  await expect(navigator.getByText('Apply-coupon endpoint')).toBeVisible()
  await expect(navigator.getByTestId('layer-item')).toHaveCount(3, { timeout: 30_000 })
  await expect(navigator.getByTestId('layer-item').nth(0)).toHaveAttribute('aria-current', 'step')

  // Context bar: position, title, summary and file chip with its ranges.
  const context = window.getByTestId('layer-context')
  await expect(context.getByText('Layer 1 of 3')).toBeVisible()
  await expect(context.getByTestId('layer-title')).toHaveText('Coupon validation service')
  await expect(context.getByText('is the core of the PR')).toBeVisible()
  const chip = context.getByTestId('layer-file-chip')
  await expect(chip).toHaveCount(1)
  await expect(chip.first()).toContainText('coupon-service.ts')
  await expect(chip.first()).toContainText('3-7, 9-21')

  // The diff shows that file and marks the layer's lines (and only them).
  await expect(window.locator('[title="src/services/coupon-service.ts"]').first()).toBeVisible()
  await expect(window.locator('[data-layer-line][data-new-line="9"]').first()).toBeVisible()
  await expect(window.locator('[data-layer-line][data-new-line="8"]')).toHaveCount(0)
  await expect(window.locator('[data-layer-line][data-new-line="1"]')).toHaveCount(0)

  await openAnalysisTab(window)
  // Wait for the analysis to finish so the second layer's diagram is final.
  await expect(window.getByRole('button', { name: /Re-?analyze/i })).toBeEnabled({ timeout: 90_000 })

  // Click the second layer: new file, new title, diagram toggle present.
  await navigator.getByTestId('layer-item').nth(1).click()
  await expect(context.getByText('Layer 2 of 3')).toBeVisible()
  await expect(context.getByTestId('layer-title')).toHaveText('Route wiring and HTTP mapping')
  await expect(window.locator('[title="src/routes/carts.ts"]').first()).toBeVisible()
  await expect(window.locator('[data-layer-line][data-new-line="20"]').first()).toBeVisible()
  await expect(window.locator('[data-layer-line][data-new-line="13"]').first()).toBeVisible()
  await context.getByRole('button', { name: 'Show diagram' }).click()
  await expect(context.locator('svg[aria-roledescription]').first()).toBeVisible({ timeout: 20_000 })

  await attachScreenshot(window, testInfo, 'walkthrough-layer-2')

  // J / K move between layers; K at the first layer is a no-op.
  await window.locator('body').press('j')
  await expect(context.getByText('Layer 3 of 3')).toBeVisible()
  await expect(window.locator('[title="src/services/coupon-service.test.ts"]').first()).toBeVisible()
  await window.locator('body').press('j')
  await expect(context.getByText('Layer 3 of 3')).toBeVisible()
  await window.locator('body').press('k')
  await window.locator('body').press('k')
  await expect(context.getByText('Layer 1 of 3')).toBeVisible()
  await window.locator('body').press('k')
  await expect(context.getByText('Layer 1 of 3')).toBeVisible()

  // Prev/next buttons mirror the keys.
  await context.getByRole('button', { name: 'Next layer (J)' }).click()
  await expect(context.getByText('Layer 2 of 3')).toBeVisible()
  await expect(context.getByRole('button', { name: 'Previous layer (K)' })).toBeEnabled()

  // Back to the tree view: markers and context bar go away, files stay.
  await window.getByRole('button', { name: 'Tree view' }).click()
  await expect(window.getByTestId('layer-context')).toHaveCount(0)
  await expect(window.locator('[data-layer-line]')).toHaveCount(0)
})

test('the didactic panel card jumps to a layer in the Files tab, two cohorts for PR #201', async ({ window }, testInfo) => {
  await window.getByText('Refactor checkout state machine').first().click()
  await openAnalysisTab(window)
  await window.getByRole('button', { name: 'Analyze PR' }).click()
  await expect(window.getByRole('button', { name: /Re-?analyze/i })).toBeEnabled({ timeout: 90_000 })

  const card = window.getByTestId('walkthrough-card')
  await expect(card).toBeVisible()
  await expect(card.getByText('State machine to reducer')).toBeVisible()
  await expect(card.getByText('Validation as pure functions')).toBeVisible()
  await expect(card.getByTestId('walkthrough-layer')).toHaveCount(4)

  // Open layer 4 (second cohort): Files tab switches to layers mode on it.
  await card.getByTestId('walkthrough-layer').nth(3).click()
  const context = window.getByTestId('layer-context')
  await expect(context.getByText('Layer 4 of 4')).toBeVisible()
  await expect(context.getByText('Validation as pure functions')).toBeVisible()
  await expect(context.getByTestId('layer-title')).toHaveText('Validators return a result object')
  await expect(window.locator('[title="src/features/checkout/checkout-validation.ts"]').first()).toBeVisible()
  await expect(window.locator('[data-layer-line][data-new-line="4"]').first()).toBeVisible()

  // Layer 3 anchors a deleted file on the OLD side and a renamed file as a whole.
  await window.getByTestId('layer-navigator').getByTestId('layer-item').nth(2).click()
  await expect(context.getByText('Layer 3 of 4')).toBeVisible()
  await expect(context.getByTestId('layer-file-chip')).toHaveCount(2)
  await expect(context.getByTestId('layer-file-chip').nth(1)).toContainText('whole file')
  await expect(window.locator('[data-layer-line][data-old-line="1"]').first()).toBeVisible()
  await context.getByTestId('layer-file-chip').nth(1).click()
  await expect(window.getByText(/No preview available/).first()).toBeVisible()

  await attachScreenshot(window, testInfo, 'walkthrough-pr-201')
})

test('layers view works in the narrow tier where the file column is a drawer', async ({ window }, testInfo) => {
  await setViewport(window, 960, 540)
  // At this width the PR list is a drawer too (`responsive.spec.ts`).
  await window.getByRole('button', { name: 'PR list' }).click()
  await window.getByText('Fix race condition in payment webhook').first().click()
  // Narrow bar: the tabs show icon + count, so find Files by its accessible name.
  await window.getByRole('tab', { name: /^Files/ }).click()
  // The column is a drawer: open it from the "N files" toolbar button. Esc
  // closes it and gives focus back to the button.
  const filesToggle = window.getByRole('button', { name: /2 files/ })
  const drawer = window.getByRole('dialog', { name: 'Changed files' })
  await filesToggle.click()
  await expect(drawer).toBeVisible()
  await window.keyboard.press('Escape')
  await expect(drawer).toHaveCount(0)
  await expect(filesToggle).toBeFocused()
  await filesToggle.click()
  await window.getByRole('button', { name: 'Layers view (guided walkthrough)' }).click()
  await window.getByTestId('layers-placeholder').getByRole('button', { name: 'Analyze PR' }).click()
  await expect(window.getByTestId('layer-navigator').getByTestId('layer-item')).toHaveCount(2, {
    timeout: 30_000,
  })
  // Picking a layer closes the drawer and shows its context over the diff.
  await window.getByTestId('layer-navigator').getByTestId('layer-item').nth(1).click()
  await expect(window.getByTestId('layer-navigator')).toHaveCount(0)
  await expect(window.getByTestId('layer-context').getByText('Layer 2 of 2')).toBeVisible()
  await expect(window.locator('[data-layer-line][data-new-line="41"]').first()).toBeVisible()
  await attachScreenshot(window, testInfo, 'walkthrough-narrow')
})
