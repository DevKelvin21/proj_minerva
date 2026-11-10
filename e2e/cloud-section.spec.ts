import { test, expect, attachScreenshot, openInsightTab, openAnalysisTab, htmlDiagrams } from './fixtures'
import type { Page } from './fixtures'

/**
 * Port de scripts/smoke-cloud-section.mjs (F15/T78): la sección condicional
 * "Infraestructura cloud" con DOS diagramas HTML (fixture:
 * shopwave/checkout-service#77), y el caso negativo (#482 sin IaC ⇒ sin card).
 */

async function analyze(window: Page, prTitle: string): Promise<void> {
  await window.getByText(prTitle).first().click()
  await openAnalysisTab(window)
  await window.getByRole('button', { name: 'Analyze PR' }).click()
  await expect(window.getByRole('button', { name: /Re-?analyze/i })).toBeEnabled({
    timeout: 90_000,
  })
}

const cloudCard = (window: Page) =>
  window
    .locator('section')
    .filter({ has: window.locator('header', { hasText: 'Cloud infrastructure' }) })

test('PR #77 con IaC: card cloud con dos diagramas HTML', async ({
  window,
}, testInfo) => {
  await analyze(window, 'Fix race condition in payment webhook')

  // The cloud card is under Architecture.
  await openInsightTab(window, 'Architecture')
  const card = cloudCard(window)
  await expect(card).toBeVisible()

  // Subtítulos big picture + zoom.
  await expect(card.getByText('Full system').first()).toBeVisible()
  await expect(card.getByText('Where this PR lands').first()).toBeVisible()

  // Two HTML diagrams, visible and sized to their content (not the 48 px
  // floor of an unmeasured frame).
  const diagrams = htmlDiagrams(card)
  await expect(diagrams).toHaveCount(2)
  for (const diagram of await diagrams.all()) {
    await expect(diagram).toBeVisible()
    await expect
      .poll(() => diagram.evaluate((el) => el.getBoundingClientRect().height))
      .toBeGreaterThan(150)
  }
  // Big picture: the whole AWS system, the handler under discussion focused.
  const bigPicture = diagrams.nth(0).contentFrame()
  await expect(bigPicture.locator('.group', { hasText: 'AWS' })).toBeVisible()
  await expect(bigPicture.locator('.node.focus', { hasText: 'Webhook handler' })).toBeVisible()
  await expect(bigPicture.locator('.node')).toHaveCount(7)
  // Zoom: the services the PR touches are marked.
  const zoom = diagrams.nth(1).contentFrame()
  await expect(zoom.locator('.node.changed', { hasText: 'Orders table' })).toBeVisible()
  // Markdown didáctico.
  await expect(card.getByText('Lambda').first()).toBeVisible()

  await attachScreenshot(window, testInfo, 'cloud-section-77')
})

test('PR #482 sin IaC: NO aparece la card cloud (caso negativo)', async ({ window }) => {
  await analyze(window, 'Add POST /carts/:id/apply-coupon')
  // El análisis completo ya está pintado (Re-analizar habilitado): la
  // ausencia de la card es concluyente, no una carrera.
  await expect(cloudCard(window)).toHaveCount(0)
})
