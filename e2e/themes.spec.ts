import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  test,
  expect,
  launchMinerva,
  closeMinerva,
  mainWindow,
  attachScreenshot,
  setViewport,
  openInsightTab,
  type Page,
  openAnalysisTab,
} from './fixtures'
import { themeColorToHex } from '../src/shared/theme/color'
import {
  getBuiltInTheme,
  getBuiltInThemes,
  getThemeColorsForMode,
} from '../src/shared/theme/themes'
import type { AppearanceSettings } from '../src/shared/theme/appearance'

/**
 * Themes (Settings → Appearance): System/Light/Dark modes, built-in themes
 * per half, contrast, custom themes, VS Code theme import and Open VSX
 * (mocked in main), applied live to the main AND the detached didactic
 * window, persisted in settings.json and restored before the first paint.
 */

const PR_482 = {
  repo: { provider: 'github' as const, owner: 'shopwave', name: 'api', fullName: 'shopwave/api' },
  number: 482,
}

const rootVar = (page: Page, name: string): Promise<string> =>
  page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name)
const appearanceOf = (page: Page): Promise<string | undefined> =>
  page.evaluate(() => document.documentElement.dataset.appearance)
const bodyBackground = (page: Page): Promise<string> =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor)

function canvasOf(themeId: string, mode: 'light' | 'dark'): string {
  return getThemeColorsForMode(getBuiltInTheme(themeId)!, mode)!.canvas
}

const savedAppearance = (userDataDir: string): AppearanceSettings =>
  (
    JSON.parse(readFileSync(join(userDataDir, 'settings.json'), 'utf-8')) as {
      appearance: AppearanceSettings
    }
  ).appearance

async function openSettings(page: Page): Promise<void> {
  await page
    .locator('button:has(svg.lucide-settings), button:has([class*="lucide-settings"])')
    .first()
    .click()
  await expect(page.getByTestId('appearance-section')).toBeVisible()
}

const themeCard = (page: Page, id: string) =>
  page.locator('[data-testid="theme-card"][data-theme-id="' + id + '"]')

/** The first Mermaid SVG's markup (its <style> carries the theme colors). */
const mermaidMarkup = (page: Page): Promise<string> =>
  page
    .locator('svg[aria-roledescription]')
    .first()
    .evaluate((svg) => svg.outerHTML)

// eslint-disable-next-line no-empty-pattern
test('appearance: mode and theme apply live to both windows, persist, and restore at boot', async ({}, testInfo) => {
  const userDataDir = testInfo.outputPath('user-data')
  const app1 = await launchMinerva(userDataDir)
  const win1 = await mainWindow(app1)

  // Analysis + detached window, to check Mermaid and the second window.
  await win1.getByText('apply-coupon').first().click()
  await win1.evaluate((p) => window.minerva.ai.analyzePullRequest(p), PR_482)
  const detachedPromise = app1.context.waitForEvent('page')
  await win1.evaluate(
    (p) => window.minerva.window.openDidactic({ ...p, title: 'apply-coupon' }),
    PR_482,
  )
  const detached = await detachedPromise
  await detached.waitForLoadState('domcontentloaded')
  await openInsightTab(detached, 'Architecture')
  await expect(detached.locator('svg[aria-roledescription]').first()).toBeVisible({
    timeout: 30_000,
  })

  // --- Light mode: both windows repaint with Minerva light ---
  await openSettings(win1)
  await win1.getByTestId('appearance-mode-dark').click()
  await expect.poll(() => rootVar(win1, '--theme-canvas')).toBe(canvasOf('minerva', 'dark'))
  await expect.poll(() => appearanceOf(detached)).toBe('dark')
  const darkBody = await bodyBackground(win1)
  await win1.getByTestId('appearance-mode-light').click()
  await expect.poll(() => appearanceOf(win1)).toBe('light')
  await expect.poll(() => rootVar(win1, '--theme-canvas')).toBe(canvasOf('minerva', 'light'))
  expect(await bodyBackground(win1)).not.toBe(darkBody)
  await expect.poll(() => appearanceOf(detached)).toBe('light')
  await expect.poll(() => rootVar(detached, '--theme-canvas')).toBe(canvasOf('minerva', 'light'))
  await attachScreenshot(win1, testInfo, 'appearance-settings-light')

  // --- Grove for both halves: canvas and the Mermaid palette follow ---
  const groveLight = getThemeColorsForMode(getBuiltInTheme('grove')!, 'light')!
  await themeCard(win1, 'grove').getByTestId('theme-use').click()
  await expect(themeCard(win1, 'grove')).toHaveAttribute('data-active-halves', 'light dark')
  await expect.poll(() => rootVar(win1, '--theme-canvas')).toBe(groveLight.canvas)
  await expect.poll(() => rootVar(detached, '--theme-canvas')).toBe(groveLight.canvas)
  await detached.waitForTimeout(400)
  const groveRaised = themeColorToHex(groveLight.surfaceRaised)!.slice(0, 7)
  await expect
    .poll(() => mermaidMarkup(detached).then((svg) => svg.toLowerCase().includes(groveRaised)), {
      message: 'Mermaid re-rendered with the Grove palette',
    })
    .toBe(true)
  await attachScreenshot(detached, testInfo, 'appearance-detached-grove-light')

  // --- Dark half only: Iris; switch to dark mode ---
  await themeCard(win1, 'iris').getByTestId('theme-half-dark').click()
  await win1.getByTestId('appearance-mode-dark').click()
  await expect.poll(() => appearanceOf(win1)).toBe('dark')
  await expect.poll(() => rootVar(win1, '--theme-canvas')).toBe(canvasOf('iris', 'dark'))
  await expect.poll(() => rootVar(detached, '--theme-canvas')).toBe(canvasOf('iris', 'dark'))
  await expect(themeCard(win1, 'grove')).toHaveAttribute('data-active-halves', 'light')
  await expect(themeCard(win1, 'iris')).toHaveAttribute('data-active-halves', 'dark')

  // --- Contrast ---
  await win1.getByTestId('appearance-contrast').fill('150')
  await win1.getByTestId('appearance-contrast').blur()
  await expect.poll(() => rootVar(win1, '--appearance-contrast-boost')).toBe('50%')
  await expect.poll(() => rootVar(detached, '--appearance-contrast-boost')).toBe('50%')

  expect(savedAppearance(userDataDir)).toMatchObject({
    mode: 'dark',
    lightTheme: 'grove',
    darkTheme: 'iris',
    contrast: 150,
  })
  await closeMinerva(app1)

  // --- Restart: same theme from the first paint ---
  const app2 = await launchMinerva(userDataDir)
  try {
    let page = app2.context.pages().find((p) => !p.url().includes('#didactic'))
    if (!page) page = await app2.context.waitForEvent('page')
    await page.waitForLoadState('domcontentloaded')
    // The boot script ran from the cache before React (no flash of Minerva).
    expect(await appearanceOf(page)).toBe('dark')
    expect(await rootVar(page, '--theme-canvas')).toBe(canvasOf('iris', 'dark'))
    const win2 = await mainWindow(app2)
    await expect.poll(() => rootVar(win2, '--appearance-contrast-boost')).toBe('50%')
    await attachScreenshot(win2, testInfo, 'appearance-iris-dark-after-restart')

    // System mode follows the OS (Electron reports the emulated media here).
    await openSettings(win2)
    await win2.getByTestId('appearance-mode-system').click()
    const systemDark = await win2.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)
    await expect.poll(() => appearanceOf(win2)).toBe(systemDark ? 'dark' : 'light')
  } finally {
    await closeMinerva(app2)
  }
})

test('import: a VS Code theme JSON becomes a dark theme', async ({ window }, testInfo) => {
  const fixture = readFileSync(
    join(process.cwd(), 'e2e/fixtures/vscode-night-owl-lite.jsonc'),
    'utf-8',
  )
  await openSettings(window)
  await window.getByTestId('theme-import').click()
  const dialog = window.getByTestId('theme-import-dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByTestId('theme-import-text').fill(fixture)
  await dialog.getByTestId('theme-import-submit').click()
  await expect(dialog).toHaveCount(0)

  const card = themeCard(window, 'harbor-night')
  await expect(card).toBeVisible()
  await expect(card).toContainText('Harbor Night')
  await expect(card).toHaveAttribute('data-active-halves', 'dark')
  await window.getByTestId('appearance-mode-dark').click()
  await expect
    .poll(async () => themeColorToHex(await rootVar(window, '--theme-canvas')))
    .toBe('#0b1622')
  await attachScreenshot(window, testInfo, 'import-vscode-theme')

  // Not a theme: a clear error, nothing saved.
  await window.getByTestId('theme-import').click()
  await window.getByTestId('theme-import-text').fill('{ "hello": "world" }')
  await window.getByTestId('theme-import-submit').click()
  await expect(window.getByTestId('theme-import-error')).toContainText('not a theme')
})

test('import: Open VSX search and install (mocked registry)', async ({ window }, testInfo) => {
  await openSettings(window)
  await window.getByTestId('theme-import').click()
  const dialog = window.getByTestId('theme-import-dialog')
  await dialog.getByTestId('theme-import-tab-openVsx').click()
  await dialog.getByTestId('open-vsx-query').fill('harbor')
  await dialog.getByTestId('open-vsx-search').click()

  // The non-permissive license is filtered out by main.
  const results = dialog.getByTestId('open-vsx-result')
  await expect(results).toHaveCount(1)
  await expect(results.first()).toContainText('Harbor Themes')
  await expect(results.first()).toContainText('MIT')
  await attachScreenshot(window, testInfo, 'open-vsx-results')
  await results.first().getByTestId('open-vsx-install').click()
  await expect(results.first().getByTestId('open-vsx-install')).toContainText('Installed 1 theme')
  await window.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)

  // "Harbor Light" + "Harbor Dark" paired into one theme with both halves, in use.
  const card = window.locator('[data-testid="theme-card"]', { hasText: 'Harbor' })
  await expect(card).toHaveCount(1)
  await expect(card).toHaveAttribute('data-active-halves', 'light dark')
  await window.getByTestId('appearance-mode-light').click()
  await expect
    .poll(async () => themeColorToHex(await rootVar(window, '--theme-canvas')))
    .toBe('#fbfbfb')
})

test('editor: create a theme, change its accent, then delete it', async ({ window }, testInfo) => {
  await openSettings(window)
  await window.getByTestId('appearance-mode-dark').click()
  await window.getByTestId('theme-create').click()
  const editor = window.getByTestId('theme-editor')
  await expect(editor).toBeVisible()
  await editor.getByTestId('theme-editor-name').fill('Magenta Night')
  const accentInput = editor.getByRole('textbox', { name: 'Accent value' })
  await accentInput.fill('#ff00aa')
  await accentInput.press('Enter')
  // Live preview in this window before saving.
  await expect
    .poll(async () => themeColorToHex(await rootVar(window, '--theme-accent')))
    .toBe('#ff00aa')
  await attachScreenshot(window, testInfo, 'theme-editor')
  await editor.getByTestId('theme-editor-save').click()
  await expect(editor).toHaveCount(0)

  const card = themeCard(window, 'magenta-night')
  await expect(card).toHaveAttribute('data-active-halves', 'light dark')
  await expect
    .poll(async () => themeColorToHex(await rootVar(window, '--theme-accent')))
    .toBe('#ff00aa')

  await card.getByRole('button', { name: 'Delete Magenta Night' }).click()
  await window.getByTestId('theme-delete-confirm').click()
  await expect(card).toHaveCount(0)
  await expect.poll(() => rootVar(window, '--theme-canvas')).toBe(canvasOf('minerva', 'dark'))
})

test('screenshots: every built-in theme, light and dark, with a diff and a diagram', async ({
  window,
}, testInfo) => {
  test.setTimeout(240_000)
  await window.getByText('apply-coupon').first().click()
  await openAnalysisTab(window)
  await window.getByRole('button', { name: 'Analyze PR' }).click()
  await expect(window.getByRole('button', { name: /Re-?analyze/i })).toBeEnabled({
    timeout: 90_000,
  })
  await window.getByText('Files').first().click()
  await expect(window.getByText('@@').first()).toBeVisible()
  // Bring the C4 diagram into the docked didactic panel's view.
  await openInsightTab(window, 'Architecture')
  await window.locator('svg[aria-roledescription]').first().scrollIntoViewIfNeeded()

  for (const theme of getBuiltInThemes()) {
    for (const mode of ['light', 'dark'] as const) {
      await window.evaluate(
        ([id, m]) =>
          window.minerva.settings.setAppearance({
            mode: m,
            lightTheme: id,
            darkTheme: id,
            contrast: 100,
            customThemes: [],
          }),
        [theme.id, mode] as const,
      )
      await expect.poll(() => rootVar(window, '--theme-canvas')).toBe(canvasOf(theme.id, mode))
      const raised = themeColorToHex(getThemeColorsForMode(theme, mode)!.surfaceRaised)!.slice(0, 7)
      await expect
        .poll(() => mermaidMarkup(window).then((svg) => svg.toLowerCase().includes(raised)))
        .toBe(true)
      // Let the 150 ms color transitions finish before capturing.
      await window.waitForTimeout(400)
      await attachScreenshot(window, testInfo, 'theme-' + theme.id + '-' + mode)

      // The C4 diagram at full size, in the zoom viewer.
      await window.locator('button[aria-label="Expand diagram"]').first().click()
      const viewer = window.locator('.fixed.inset-0').last()
      await expect(viewer.locator('svg[aria-roledescription]').first()).toBeVisible()
      await window.waitForTimeout(400)
      await attachScreenshot(window, testInfo, 'diagram-' + theme.id + '-' + mode)
      await window.keyboard.press('Escape')
      await expect(viewer.locator('svg[aria-roledescription]')).toHaveCount(0)
    }
  }
})

test('tiled 960x540: the Appearance section and the editor stay usable', async ({
  window,
}, testInfo) => {
  await setViewport(window, 960, 540)
  await openSettings(window)
  const section = window.getByTestId('appearance-section')
  await section.getByTestId('theme-grid').scrollIntoViewIfNeeded()
  await expect(themeCard(window, 'ocean')).toBeVisible()
  await themeCard(window, 'ocean').getByTestId('theme-use').click()
  await expect(themeCard(window, 'ocean')).toHaveAttribute('data-active-halves', 'light dark')
  await attachScreenshot(window, testInfo, 'appearance-tiled-960x540')

  await window.getByTestId('theme-create').click()
  const editor = window.getByTestId('theme-editor')
  await expect(editor.getByTestId('theme-editor-save')).toBeVisible()
  await expect(editor.getByTestId('theme-editor-name')).toBeVisible()
  await attachScreenshot(window, testInfo, 'editor-tiled-960x540')
})
