import { test, expect, attachScreenshot, openAnalysisTab, openInsightTab, setViewport } from './fixtures'

/**
 * The analysis panel's states, shaped like the result: the placeholder (the
 * sections an analysis has, "Analyze PR" primary, the model named), the
 * skeleton and the streaming cards, the done state with ONE status bar and
 * endpoint cards titled by their route, a failed run that still names the
 * model, the detached window, and the panel at a tiled width.
 */

const MODEL_NAME = /Big Pickle · OpenCode/

test('analysis panel: placeholder, streaming, done with route-titled endpoints, tiled', async ({
  window,
}, testInfo) => {
  await window.getByText('Add POST /carts/:id/apply-coupon').first().click()
  await openAnalysisTab(window)

  // Placeholder: the list matches the sections (walkthrough included) + model.
  const placeholder = window.getByTestId('didactic-placeholder')
  await expect(placeholder).toContainText('guided walkthrough')
  await expect(placeholder.getByTestId('analysis-model')).toHaveText(MODEL_NAME)
  await attachScreenshot(window, testInfo, 'analysis-placeholder')

  await placeholder.getByRole('button', { name: 'Analyze PR' }).click()
  // While streaming the one regenerate button exists but is disabled; the
  // cards arrive under the tabs.
  const reanalyze = window.getByRole('button', { name: /Re-?analyze/i })
  await expect(window.getByTestId('analysis-skeleton').or(window.getByTestId('insight-tabs'))).toBeVisible()
  await attachScreenshot(window, testInfo, 'analysis-streaming')
  await expect(reanalyze).toBeEnabled({ timeout: 90_000 })

  // Done: one status bar (model + one button), no notice rows.
  const bar = window.getByTestId('analysis-status-bar')
  await expect(bar.getByTestId('analysis-model')).toHaveText(MODEL_NAME)
  await expect(bar.getByRole('button')).toHaveCount(1)
  await expect(window.getByTestId('analysis-stale-banner')).toHaveCount(0)
  await attachScreenshot(window, testInfo, 'analysis-done')

  // Endpoint cards are titled by their route, not "Endpoint".
  await openInsightTab(window, 'Endpoints')
  const endpointCard = window
    .locator('section')
    .filter({ has: window.locator('header', { hasText: 'POST /api/v1/carts/:id/apply-coupon' }) })
  await expect(endpointCard.first()).toBeVisible()
  await expect(window.locator('section header', { hasText: /^Endpoint$/ })).toHaveCount(0)
  // Snippet and section share the one expand control, always visible.
  await expect(endpointCard.first().getByRole('button', { name: 'Expand snippet' }).first()).toBeVisible()
  await attachScreenshot(window, testInfo, 'analysis-endpoints')

  // Diagrams: the expand control is visible without hovering.
  await openInsightTab(window, 'Architecture')
  await expect(window.locator('svg[aria-roledescription]').first()).toBeVisible()
  await expect(window.getByRole('button', { name: 'Expand diagram' }).first()).toBeVisible()
  await attachScreenshot(window, testInfo, 'analysis-architecture')

  // Tiled: half a 1080p screen.
  await setViewport(window, 960, 1080)
  await openInsightTab(window, 'Overview')
  await expect(window.getByTestId('analysis-status-bar')).toBeVisible()
  const overflow = await window.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow, 'no horizontal overflow at a tiled width').toBeLessThanOrEqual(0)
  await attachScreenshot(window, testInfo, 'analysis-tiled')
})

test('detached window: done state, and a failed run keeps the model named', async ({
  minerva,
  window,
}, testInfo) => {
  const pr = {
    repo: { provider: 'github' as const, owner: 'shopwave', name: 'api', fullName: 'shopwave/api' },
    number: 482,
  }
  await window.evaluate((p) => window.minerva.ai.analyzePullRequest(p), pr)
  const detachedPromise = minerva.context.waitForEvent('page')
  await window.evaluate((p) => window.minerva.window.openDidactic({ ...p, title: 'apply-coupon' }), pr)
  const detached = await detachedPromise
  await detached.waitForLoadState('domcontentloaded')
  await expect(detached.getByRole('button', { name: /Re-?analyze/i })).toBeEnabled({ timeout: 15_000 })
  await expect(detached.getByTestId('analysis-model')).toHaveText(MODEL_NAME)
  await attachScreenshot(detached, testInfo, 'analysis-detached')

  // A PR the mock SCM does not know: the run fails, the model stays named, Retry sits beside it.
  await window.evaluate(
    (p) => window.minerva.window.openDidactic({ ...p, number: 99_999, title: 'Missing PR' }),
    pr,
  )
  await expect(detached.getByText('Missing PR').first()).toBeVisible()
  await detached.getByRole('button', { name: 'Analyze PR' }).click()
  await expect(detached.getByRole('alert')).toContainText('Could not analyze the PR', { timeout: 30_000 })
  await expect(detached.getByTestId('analysis-model')).toHaveText(MODEL_NAME)
  await expect(detached.getByRole('button', { name: 'Retry' })).toBeVisible()
  await attachScreenshot(detached, testInfo, 'analysis-failed')
  await detached.close()
})
