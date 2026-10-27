import { test, expect, attachScreenshot, openInsightTab } from './fixtures'
import type { Page } from './fixtures'

/**
 * Port piloto de `scripts/smoke-didactic.mjs` a Playwright.
 *
 * Diferencias deliberadas con la suite CDP legacy:
 * - Cada test lanza SU app con userData limpio ⇒ no hay que limpiar buscador,
 *   invalidar cache ni seleccionar un PR neutral: el placeholder está
 *   garantizado por construcción.
 * - Las esperas son aserciones auto-wait (`toBeEnabled`, `toBeVisible`), no
 *   sleeps: `toBeVisible` exige bounding box no vacío, así que el bug del
 *   visor colapsado a 0px que engañaba a getBoundingClientRect aquí FALLA.
 * - Cada test adjunta una captura como artifact (verificación visual).
 */

/** Selecciona un PR por título y lanza el análisis didáctico. */
async function analyze(window: Page, prTitle: string): Promise<void> {
  await window.getByText(prTitle).first().click()
  await window.getByRole('button', { name: 'Analyze PR' }).click()
  // Señal inequívoca de término (regla de la suite legacy): "Re-analizar"
  // solo existe con resultado y está deshabilitado mientras carga. NO esperar
  // por "Resumen": el placeholder ya dice "Resumen didáctico del cambio".
  await expect(window.getByRole('button', { name: /Re-?analyze/i })).toBeEnabled({
    timeout: 90_000,
  })
}

const setupCard = (window: Page) =>
  window
    .locator('section')
    .filter({ has: window.locator('header', { hasText: 'How to run the app' }) })

test('PR #482: resumen, endpoint con snippet y diagrama C4', async ({ window }, testInfo) => {
  await analyze(window, 'Add POST /carts/:id/apply-coupon')

  await expect(window.getByText('Summary').first()).toBeVisible()

  // Overview tab: the "How to run the app" card (T20), new env vars and
  // copyable snippets. The env var check is strict against the fixture —
  // valid because the AI is ALWAYS mock here (MINERVA_MOCK_AI=1).
  const card = setupCard(window)
  await expect(card).toBeVisible()
  await expect(card.getByText('COUPON_MAX_DISCOUNT_RATE').first()).toBeVisible()
  expect(await card.locator('pre').count()).toBeGreaterThanOrEqual(1)
  await expect(card.getByRole('button', { name: /Copy/ }).first()).toBeVisible()
  await attachScreenshot(window, testInfo, 'pr-482-didactic')

  // Endpoints tab: copyable curl snippet.
  await openInsightTab(window, 'Endpoints')
  await expect(window.locator('pre', { hasText: 'curl' }).first()).toBeVisible()
  await expect(window.getByRole('button', { name: /Copy/ }).first()).toBeVisible()
  await expect(card).toHaveCount(0)
  // Architecture tab: the Mermaid diagram renders as SVG (lazy ⇒ expect timeout).
  await openInsightTab(window, 'Architecture')
  await expect(window.locator('svg[aria-roledescription]').first()).toBeVisible()
  await attachScreenshot(window, testInfo, 'pr-482-didactic-architecture')
})

test('PR #479: esquema con diagrama ER y setup sin env vars', async ({ window }, testInfo) => {
  await analyze(window, 'Add refunds table and migration')

  // Opposite case of T20: the setup section says explicitly that the PR
  // adds NO environment variables (it must never leave that out).
  const card = setupCard(window)
  await expect(card).toBeVisible()
  await expect(card.getByText('adds or changes no environment variables')).toBeVisible()

  // Data tab: the ER diagram.
  await openInsightTab(window, 'Data')
  await expect(window.getByText('refunds').first()).toBeVisible()
  await expect(
    window.locator('svg[aria-roledescription="er"], svg[id*="mermaid"]').first(),
  ).toBeVisible()

  await attachScreenshot(window, testInfo, 'pr-479-didactic')
})

test('PR #201: sección de arquitectura con diagrama', async ({ window }, testInfo) => {
  await analyze(window, 'Refactor checkout state machine')

  await openInsightTab(window, 'Architecture')
  await expect(window.locator('svg[aria-roledescription]').first()).toBeVisible()

  await attachScreenshot(window, testInfo, 'pr-201-didactic')
})

test('cambiar de PR resetea el panel al placeholder', async ({ window }) => {
  await analyze(window, 'Add POST /carts/:id/apply-coupon')
  await window.getByText('Add dark mode toggle').first().click()
  // El remount por key debe volver al placeholder con el botón de análisis.
  await expect(window.getByRole('button', { name: 'Analyze PR' })).toBeVisible()
})
