import { test, expect, attachScreenshot, setViewport, openAnalysisTab } from './fixtures'
import type { Page } from './fixtures'

/**
 * The app's own title bar (frameless window): the "repo › #n Title" trail,
 * the Cmd/Ctrl+K command palette, the AI status chip and the drag region
 * that keeps the OS window controls clear.
 */

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'
const titleBar = (page: Page) => page.locator('header.app-drag')
const palette = (page: Page) => page.getByTestId('command-palette')
const prHeader = (page: Page) => page.locator('header:has(h1)')

test('Cmd/Ctrl+K jumps to a PR by number, to a command, and Esc only closes it', async ({
  window,
}, testInfo) => {
  await setViewport(window, 1600, 1000)
  await expect(window.getByText('Add POST /carts/:id/apply-coupon').first()).toBeVisible({
    timeout: 20_000,
  })

  // The title bar button and the shortcut open the same palette.
  await titleBar(window).getByTestId('command-bar').click()
  await expect(palette(window)).toBeVisible()
  await expect(palette(window).getByRole('combobox')).toBeFocused()
  await window.keyboard.press(MOD + '+k')
  await expect(palette(window)).toHaveCount(0)

  await window.keyboard.press(MOD + '+k')
  await window.keyboard.type('#482')
  const options = palette(window).getByRole('option')
  await expect(options.first()).toContainText('Add POST /carts/:id/apply-coupon')
  await expect(options.first()).toHaveAttribute('aria-selected', 'true')
  await attachScreenshot(window, testInfo, 'palette-pr-search')
  await window.keyboard.press('Enter')
  await expect(palette(window)).toHaveCount(0)
  await expect(prHeader(window)).toContainText('#482', { timeout: 20_000 })

  // The trail names where the PR is; the title reopens the palette to switch.
  const trail = window.getByTestId('review-breadcrumb')
  await expect(trail).toContainText('#482')
  await expect(trail).toContainText('Add POST /carts/:id/apply-coupon')
  const switcher = trail.getByRole('button', { name: /#482/ })
  await expect(switcher).toHaveAttribute('title', /^Switch pull request/)
  await switcher.click()
  await expect(palette(window)).toBeVisible()

  // Esc closes the palette and nothing else: the review stays on screen.
  await window.keyboard.press('Escape')
  await expect(palette(window)).toHaveCount(0)
  await expect(prHeader(window)).toContainText('#482')
  // Focus goes back to what opened it.
  await expect(switcher).toBeFocused()

  // A command: arrows move the highlight, Enter runs it.
  await window.keyboard.press(MOD + '+k')
  await window.keyboard.type('go to home')
  await expect(options.first()).toHaveText('Go to Home')
  await window.keyboard.press('ArrowDown')
  await window.keyboard.press('ArrowUp')
  await expect(options.first()).toHaveAttribute('aria-selected', 'true')
  await window.keyboard.press('Enter')
  await expect(window.getByTestId('home-button')).toHaveAttribute('aria-pressed', 'true')
})

test('the AI chip follows the analysis of the PR under review', async ({ window }) => {
  await setViewport(window, 1600, 1000)
  await window.getByText('Add POST /carts/:id/apply-coupon').first().click()
  const chip = window.getByTestId('ai-status-chip')
  await expect(chip).toHaveAttribute('data-ai-status', 'idle', { timeout: 20_000 })
  await expect(chip).toContainText('Not analyzed')

  await openAnalysisTab(window)
  await window.getByRole('button', { name: 'Analyze PR' }).click()
  await expect(chip).toHaveAttribute('data-ai-status', 'ready', { timeout: 90_000 })
  await expect(chip).toContainText('Ready')

  // Home: no PR on screen, so only the model shows.
  await window.getByTestId('home-button').click()
  await expect(chip).toHaveAttribute('data-ai-status', 'none')
})

test('the title bar drags the window, its controls do not, and the OS controls keep their band', async ({
  window,
}, testInfo) => {
  await setViewport(window, 1600, 1000)
  const bar = titleBar(window)
  await expect(bar).toBeVisible({ timeout: 20_000 })
  const regions = await bar.evaluate((header) => {
    const region = (el: Element | null): string =>
      el ? getComputedStyle(el).getPropertyValue('-webkit-app-region') : ''
    return {
      bar: region(header),
      home: region(header.querySelector('[data-testid="home-button"]')),
      accounts: region(header.querySelector('[data-testid="accounts-menu"]')),
      paddingLeft: parseFloat(getComputedStyle(header).paddingLeft),
      height: header.getBoundingClientRect().height,
    }
  })
  expect(regions.bar).toBe('drag')
  expect(regions.home).toBe('no-drag')
  expect(regions.accounts).toBe('no-drag')
  expect(regions.height).toBe(44)
  // macOS: the traffic lights sit in the bar, so the content starts past them.
  if (process.platform === 'darwin') expect(regions.paddingLeft).toBeGreaterThanOrEqual(70)
  await attachScreenshot(window, testInfo, 'title-bar-home')

  // Tiled widths: the bar never overflows the window.
  for (const [w, h] of [
    [900, 800],
    [600, 700],
  ] as const) {
    await setViewport(window, w, h)
    const overflow = await bar.evaluate((header) => header.scrollWidth - header.clientWidth)
    expect(overflow).toBeLessThanOrEqual(0)
  }
})
