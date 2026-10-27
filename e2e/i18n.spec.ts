import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  test,
  expect,
  launchMinerva,
  closeMinerva,
  mainWindow,
  attachScreenshot,
  type Page,
} from './fixtures'

/**
 * UI language: English by default, Spanish from Settings > Language, applied
 * at once to the main window AND the detached didactic window (main pushes
 * `languageChanged` to every window), persisted in settings.json and kept
 * across a restart. An analysis written in the other language offers to be
 * regenerated.
 */

const PR_482 = {
  repo: { provider: 'github' as const, owner: 'shopwave', name: 'api', fullName: 'shopwave/api' },
  number: 482,
}

const savedLanguage = (userDataDir: string): unknown =>
  (JSON.parse(readFileSync(join(userDataDir, 'settings.json'), 'utf-8')) as { language?: unknown })
    .language

const htmlLang = (page: Page): Promise<string> => page.evaluate(() => document.documentElement.lang)

async function openSettings(page: Page): Promise<void> {
  await page
    .locator('button:has(svg.lucide-settings), button:has([class*="lucide-settings"])')
    .first()
    .click()
  await expect(page.getByTestId('language-picker')).toBeVisible()
}

// eslint-disable-next-line no-empty-pattern
test('language: English default, Spanish in both windows, persisted across a restart, back to English', async ({}, testInfo) => {
  const userDataDir = testInfo.outputPath('user-data')

  // --- Session 1: English by default ---
  const app1 = await launchMinerva(userDataDir)
  const win1 = await mainWindow(app1)
  expect(await htmlLang(win1)).toBe('en')
  await win1.getByText('apply-coupon').first().click()
  await expect(win1.getByText('Conversation', { exact: true }).first()).toBeVisible()

  // English analysis, then the detached window on it.
  const analysis = await win1.evaluate((p) => window.minerva.ai.analyzePullRequest(p), PR_482)
  expect(analysis.language, 'analysis sealed with the UI language').toBe('en')
  const detachedPromise = app1.context.waitForEvent('page')
  await win1.evaluate(
    (p) => window.minerva.window.openDidactic({ ...p, title: 'apply-coupon' }),
    PR_482,
  )
  const detached = await detachedPromise
  await detached.waitForLoadState('domcontentloaded')
  await expect(detached.getByText('Summary', { exact: true }).first()).toBeVisible({ timeout: 15_000 })
  await expect(detached.getByTestId('analysis-language-banner')).toHaveCount(0)
  expect(await htmlLang(detached)).toBe('en')

  // --- Switch to Spanish from Settings ---
  await openSettings(win1)
  await expect(win1.getByRole('heading', { name: 'Settings' }).first()).toBeVisible()
  await win1.getByTestId('language-picker').selectOption('es')

  // Main window: labels change without a reload.
  await expect.poll(() => htmlLang(win1)).toBe('es')
  await expect(win1.getByRole('heading', { name: 'Configuración' }).first()).toBeVisible()
  await expect(win1.getByText('Idioma', { exact: true }).first()).toBeVisible()
  await attachScreenshot(win1, testInfo, 'i18n-settings-es')
  await win1.keyboard.press('Escape')
  await expect(win1.getByText('Conversación', { exact: true }).first()).toBeVisible()
  await expect(win1.getByText('Conversation', { exact: true })).toHaveCount(0)

  // Detached window: switched too, and offers to regenerate the English analysis.
  await expect.poll(() => htmlLang(detached)).toBe('es')
  await expect(detached.getByText('Resumen', { exact: true }).first()).toBeVisible()
  const banner = detached.getByTestId('analysis-language-banner')
  await expect(banner).toBeVisible()
  await expect(banner).toContainText('inglés')
  await attachScreenshot(detached, testInfo, 'i18n-detached-es')

  // Regenerating writes the analysis in Spanish (mock AI follows the language).
  await banner.getByTestId('analysis-language-regenerate').click()
  await expect(detached.getByTestId('analysis-language-banner')).toHaveCount(0, { timeout: 15_000 })
  await expect
    .poll(() =>
      win1.evaluate(
        (p) =>
          window.minerva.ai
            .getAnalysisState(p)
            .then((s: { status: string; analysis?: { language: string } }) =>
              s.status === 'cached' ? s.analysis?.language : s.status,
            ),
        PR_482,
      ),
    )
    .toBe('es')

  expect(savedLanguage(userDataDir)).toBe('es')
  await closeMinerva(app1)

  // --- Session 2: same userData, Spanish from the first paint ---
  const app2 = await launchMinerva(userDataDir)
  try {
    const win2 = await mainWindow(app2)
    expect(await htmlLang(win2)).toBe('es')
    await win2.getByText('apply-coupon').first().click()
    await expect(win2.getByText('Conversación', { exact: true }).first()).toBeVisible()
    await expect(win2.getByText(/^Archivos/).first()).toBeVisible()
    await attachScreenshot(win2, testInfo, 'i18n-main-es-after-restart')

    // --- Back to English ---
    await openSettings(win2)
    await win2.getByTestId('language-picker').selectOption('en')
    await expect.poll(() => htmlLang(win2)).toBe('en')
    await expect(win2.getByRole('heading', { name: 'Settings' }).first()).toBeVisible()
    await win2.keyboard.press('Escape')
    await expect(win2.getByText('Conversation', { exact: true }).first()).toBeVisible()
    await expect(win2.getByText('Conversación', { exact: true })).toHaveCount(0)
    expect(savedLanguage(userDataDir)).toBe('en')
  } finally {
    await closeMinerva(app2)
  }
})
