import { test, expect, attachScreenshot, openInsightTab, openAnalysisTab } from './fixtures'
import type { Page } from './fixtures'

/**
 * Port de scripts/smoke-cloud-section.mjs (F15/T78): la sección condicional
 * "Infraestructura cloud" con DOS diagramas architecture-beta e iconos de
 * packs locales (fixture: shopwave/checkout-service#77), y el caso negativo
 * (#482 sin IaC ⇒ sin card).
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

test('PR #77 con IaC: card cloud con dos architecture-beta e iconos locales', async ({
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

  // Dos diagramas renderizados como SVG mermaid, con contenido y VISIBLES
  // (render lazy + chunk de icon packs ~7MB la primera vez ⇒ poll amplio).
  const svgs = card.locator('svg[id*="mermaid"]')
  await expect(svgs).toHaveCount(2, { timeout: 30_000 })
  const svgStats = await card.evaluate((el) =>
    Array.from(el.querySelectorAll('svg')).filter((s) => s.id.includes('mermaid')).map((s) => ({
      nodes: s.querySelectorAll('*').length,
      height: Math.round(s.getBoundingClientRect().height),
      markupLen: s.innerHTML.length,
    })),
  )
  for (const s of svgStats) {
    expect(s.nodes, 'diagrama con contenido real (≥3 servicios ⇒ >20 nodos)').toBeGreaterThan(20)
    expect(s.height, 'diagrama visible, no colapsado a 0px').toBeGreaterThan(50)
  }
  // Iconos de iconify inlineados (packs 100% locales — la CSP prohíbe el
  // loader remoto): el body del icono queda en el markup del SVG.
  expect(
    svgStats.some((s) => s.markupLen > 3000),
    'iconos inlineados en el SVG',
  ).toBe(true)

  // Markdown didáctico + servicios tocados marcados con sufijo plano "PR"
  // (la convención " (PR)" con paréntesis rompe el lexer de architecture-beta).
  await expect(card.getByText('Lambda').first()).toBeVisible()
  await expect(card.getByText(/Handler PR/).first()).toBeVisible()

  await attachScreenshot(window, testInfo, 'cloud-section-77')
})

test('PR #482 sin IaC: NO aparece la card cloud (caso negativo)', async ({ window }) => {
  await analyze(window, 'Add POST /carts/:id/apply-coupon')
  // El análisis completo ya está pintado (Re-analizar habilitado): la
  // ausencia de la card es concluyente, no una carrera.
  await expect(cloudCard(window)).toHaveCount(0)
})
