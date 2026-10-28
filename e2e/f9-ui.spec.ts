import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect, launchMinerva, closeMinerva, mainWindow, attachScreenshot, openAnalysisTab } from './fixtures'
import type { Page } from './fixtures'

/**
 * Port de scripts/smoke-f9-ui.mjs (F9, issues 1 y 2 post-T59).
 *
 * Banner (`ActiveModelHint.tsx`): formato EXACTO `providerLabel + ' · ' +
 * model` donde `model` es el ID crudo — con opencode + opencode/big-pickle
 * (sin descriptor effort en el catálogo curado, T57) queda literalmente
 * `vía OpenCode · opencode/big-pickle`. Con MINERVA_MOCK_AI=1 responde el
 * mock, pero `generatedWith` se sella con la SELECCIÓN activa.
 *
 * Staleness: la suite legacy necesitaba que el orquestador escribiera a mano
 * una entrada persistida con headSha viejo ANTES de lanzar. Aquí el propio
 * test la siembra: analiza, cierra la app, reescribe `analyses.json` en el
 * userData aislado con un headSha falso y relanza sobre el mismo userData.
 */

const PR_482 = { repo: { provider: 'github', owner: 'shopwave', name: 'api', fullName: 'shopwave/api' }, number: 482 }
const EXPECTED_BANNER = 'via OpenCode · opencode/big-pickle'

const banner = (page: Page) => page.locator('span[title*="Active provider and model"]')

test('el banner del panel sella la config de generación (no la vigente)', async ({
  window,
}, testInfo) => {
  // Selección EXPLÍCITA opencode + big-pickle (determinismo: no depender del
  // default del catálogo) + reload para alinear el store del renderer con lo
  // persistido por IPC crudo (regla CLAUDE.md).
  await window.evaluate(() => window.minerva.settings.setAiProvider({ provider: 'opencode' }))
  await window.evaluate(() =>
    window.minerva.settings.setProviderModel({ provider: 'opencode', model: 'opencode/big-pickle' }),
  )
  await window.reload()
  await expect(window.getByText('apply-coupon').first()).toBeVisible({ timeout: 20_000 })

  await window.getByText('Add POST /carts/:id/apply-coupon').first().click()
  await openAnalysisTab(window)
  await window.getByRole('button', { name: 'Analyze PR' }).click()
  await expect(window.getByRole('button', { name: /Re-?analyze/i })).toBeEnabled({
    timeout: 90_000,
  })
  await expect(banner(window), 'banner tras generar').toHaveText(EXPECTED_BANNER)

  // Cambiar la config VIGENTE a claude-code (persiste) + reload: al reabrir
  // el análisis YA generado (auto-attach de cache) el banner debe seguir
  // mostrando lo sellado, no la selección nueva.
  const swapped = await window.evaluate(() =>
    window.minerva.settings.setAiProvider({ provider: 'claude-code' }),
  )
  expect(swapped.provider).toBe('claude-code')
  await window.reload()
  await expect(window.getByText('apply-coupon').first()).toBeVisible({ timeout: 20_000 })
  await window.getByText('Add POST /carts/:id/apply-coupon').first().click()
  await expect(window.getByRole('button', { name: /Re-?analyze/i })).toBeVisible()
  await expect(banner(window), 'banner SIGUE sellado con opencode').toHaveText(EXPECTED_BANNER)

  await attachScreenshot(window, testInfo, 'f9-banner-sellado')
})

// eslint-disable-next-line no-empty-pattern
test('análisis con headSha viejo muestra la barra de staleness y "Actualizar" la limpia', async ({}, testInfo) => {
  const userDataDir = testInfo.outputPath('user-data')

  // --- Sesión 1: generar y persistir el análisis de #482 ---
  const app1 = await launchMinerva(userDataDir)
  const win1 = await mainWindow(app1)
  const sealedSha = await win1.evaluate(
    (p) => window.minerva.ai.analyzePullRequest(p).then((a: { headSha: string }) => a.headSha),
    PR_482,
  )
  expect(sealedSha).toMatch(/^a482f001/)
  await closeMinerva(app1)

  // --- Sembrar staleness: headSha falso en la entrada persistida ---
  const analysesPath = join(userDataDir, 'analyses.json')
  const persisted = JSON.parse(readFileSync(analysesPath, 'utf-8')) as {
    entries: { key: string; analysis: { headSha: string } }[]
  }
  const entry = persisted.entries.find((e) => e.key === 'github:shopwave/api#482')
  expect(entry, 'entrada persistida de #482 presente en analyses.json').toBeTruthy()
  entry!.analysis.headSha = '0ld5ha000ld5ha000ld5ha000ld5ha000ld5ha00'
  writeFileSync(analysesPath, JSON.stringify(persisted, null, 2) + '\n', 'utf-8')

  // --- Sesión 2: mismo userData — el auto-attach debe avisar de commits nuevos ---
  const app2 = await launchMinerva(userDataDir)
  try {
    const win2 = await mainWindow(app2)
    await win2.getByText('Add POST /carts/:id/apply-coupon').first().click()
    await openAnalysisTab(win2)
    await expect(win2.getByText(/new commits/).first()).toBeVisible()
    // Scoped to the bar: the list refresh in the aside is also called "Update".
    const staleBar = win2.getByTestId('analysis-stale-banner')
    await expect(staleBar).toContainText(/new commits/)
    const update = staleBar.getByRole('button', { name: 'Update' })
    await expect(update).toBeVisible()
    await attachScreenshot(win2, testInfo, 'f9-staleness-visible')

    // "Actualizar" re-analiza (mock) y sella el headSha actual ⇒ la barra se va.
    await update.click()
    await expect(win2.getByRole('button', { name: /Re-?analyze/i })).toBeEnabled({
      timeout: 90_000,
    })
    await expect(win2.getByText(/new commits/)).toHaveCount(0)
    await attachScreenshot(win2, testInfo, 'f9-staleness-limpia')
  } finally {
    await closeMinerva(app2)
  }
})
