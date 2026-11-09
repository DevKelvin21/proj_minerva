import { test, expect, setViewport, attachScreenshot } from './fixtures'
import type { Page } from './fixtures'

/**
 * ONE sidebar toggle, owned by the sidebar: the expanded list's footer
 * ("Collapse") and the rail's last button ("Expand") sit in the same
 * bottom-left spot; the title bar has none. Docked tiers fold the column to
 * the rail; drawer tiers always keep the rail and open the list over it.
 * Cmd/Ctrl+B and the palette command do the same on every tier.
 */

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'
const titleBar = (page: Page) => page.locator('header.app-drag')
const list = (page: Page) => page.locator('aside[aria-label="Pull request list"]')
const rail = (page: Page) => page.getByTestId('sidebar-rail')
const toggle = (page: Page) => page.getByTestId('sidebar-toggle')
const drawer = (page: Page) => page.getByRole('dialog', { name: 'Pull request list' })

/** Let React commit the layout tier of a new viewport. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  )
}

/** The title bar names no sidebar control at all. */
async function expectNoTitleBarToggle(page: Page): Promise<void> {
  await expect(titleBar(page).getByTestId('sidebar-toggle')).toHaveCount(0)
  await expect(
    titleBar(page).getByRole('button', { name: /sidebar|PR list|pull request list/i }),
  ).toHaveCount(0)
}

/** Left and bottom insets of the toggle in the window, rounded. */
async function toggleSpot(page: Page): Promise<{ left: number; bottom: number }> {
  const box = await toggle(page).boundingBox()
  const height = await page.evaluate(() => window.innerHeight)
  if (!box) throw new Error('sidebar toggle has no box')
  return { left: Math.round(box.x), bottom: Math.round(height - box.y - box.height) }
}

test('docked tiers: one toggle in each state, at the same bottom-left spot; none in the title bar', async ({
  window,
}, testInfo) => {
  for (const viewport of [
    { name: 'xl', w: 1600, h: 1000 },
    { name: 'lg', w: 1200, h: 800 },
  ]) {
    await setViewport(window, viewport.w, viewport.h)
    await settle(window)
    await expect(list(window)).toBeVisible()
    await expectNoTitleBarToggle(window)

    // Expanded: the footer's Collapse, the only toggle on screen.
    await expect(toggle(window)).toHaveCount(1)
    await expect(list(window).getByTestId('sidebar-toggle')).toHaveAttribute('aria-expanded', 'true')
    await expect(toggle(window)).toHaveAccessibleName(/^Collapse sidebar \((⌘|Ctrl)B\)$/)
    await expect(list(window)).toContainText(/Collapse · (⌘|Ctrl)B/)
    const expandedSpot = await toggleSpot(window)
    expect(expandedSpot.left).toBe(8)
    expect(expandedSpot.bottom).toBe(8)
    await attachScreenshot(window, testInfo, 'docked-expanded-' + viewport.name)

    // Folded: the rail's Expand, in the same spot.
    await toggle(window).click()
    await expect(list(window)).toHaveCount(0)
    await expect(toggle(window)).toHaveCount(1)
    await expect(rail(window).getByTestId('sidebar-toggle')).toHaveAttribute('aria-expanded', 'false')
    await expect(toggle(window)).toHaveAccessibleName(/^Expand sidebar \((⌘|Ctrl)B\)$/)
    expect(await toggleSpot(window)).toEqual(expandedSpot)
    await expectNoTitleBarToggle(window)
    await attachScreenshot(window, testInfo, 'docked-collapsed-' + viewport.name)

    await toggle(window).click()
    await expect(list(window)).toBeVisible()
    await expect(rail(window)).toHaveCount(0)
  }
})

test('drawer tiers: the rail stays, one toggle opens the list over it, Esc / scrim / footer close it', async ({
  window,
}, testInfo) => {
  for (const viewport of [
    { name: 'md-900', w: 900, h: 700 },
    { name: 'sm-560', w: 560, h: 700 },
  ]) {
    await setViewport(window, viewport.w, viewport.h)
    await settle(window)
    await expect(rail(window)).toBeVisible()
    await expect(list(window)).toHaveCount(0)
    await expectNoTitleBarToggle(window)
    await expect(toggle(window)).toHaveCount(1)
    await expect(rail(window).getByTestId('sidebar-toggle')).toHaveAttribute('aria-expanded', 'false')
    const railSpot = await toggleSpot(window)
    await attachScreenshot(window, testInfo, 'drawer-rail-' + viewport.name)

    // The rail's toggle: the drawer, with its own toggle in the same spot.
    await toggle(window).click()
    await expect(drawer(window)).toBeVisible()
    await expect(toggle(window)).toHaveCount(1)
    await expect(drawer(window).getByTestId('sidebar-toggle')).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    expect(await toggleSpot(window)).toEqual(railSpot)
    await attachScreenshot(window, testInfo, 'drawer-open-' + viewport.name)

    // Its footer toggle closes it.
    await toggle(window).click()
    await expect(drawer(window)).toHaveCount(0)
    await expect(rail(window)).toBeVisible()

    // Esc closes it.
    await toggle(window).click()
    await expect(drawer(window)).toBeVisible()
    await window.keyboard.press('Escape')
    await expect(drawer(window)).toHaveCount(0)

    // The scrim closes it.
    await toggle(window).click()
    await expect(drawer(window)).toBeVisible()
    const width = await window.evaluate(() => window.innerWidth)
    await window.getByTestId('scrim').click({ position: { x: width - 20, y: 200 } })
    await expect(drawer(window)).toHaveCount(0)

    // A rail view button opens the drawer on that view.
    await rail(window)
      .getByRole('button', { name: /^Inbox/ })
      .click()
    await expect(drawer(window)).toBeVisible()
    await expect(
      drawer(window)
        .getByRole('group', { name: 'Left column view' })
        .getByRole('button', { name: /^Inbox/ }),
    ).toHaveAttribute('aria-pressed', 'true')
    await window.keyboard.press('Escape')
    await expect(drawer(window)).toHaveCount(0)
  }
})

test('Cmd/Ctrl+B and the palette command toggle the list on every tier', async ({ window }) => {
  for (const viewport of [
    { name: 'xl', w: 1600, h: 1000, drawer: false },
    { name: 'md', w: 960, h: 540, drawer: true },
    { name: 'sm', w: 560, h: 700, drawer: true },
  ]) {
    await setViewport(window, viewport.w, viewport.h)
    await settle(window)
    const shown = viewport.drawer ? drawer(window) : list(window)
    const wasShown = (await shown.count()) > 0

    await window.keyboard.press(MOD + '+b')
    await expect(shown).toHaveCount(wasShown ? 0 : 1)
    await window.keyboard.press(MOD + '+b')
    await expect(shown).toHaveCount(wasShown ? 1 : 0)

    await window.keyboard.press(MOD + '+k')
    await window.keyboard.type('pull request list')
    await expect(window.getByRole('option').first()).toHaveText(/Show or hide the pull request list/)
    await window.keyboard.press('Enter')
    await expect(shown).toHaveCount(wasShown ? 0 : 1)
    // Back to how it was, for the next tier.
    await window.keyboard.press(MOD + '+b')
    await expect(shown).toHaveCount(wasShown ? 1 : 0)
    if (viewport.drawer && (await drawer(window).count()) > 0) {
      await window.keyboard.press('Escape')
      await expect(drawer(window)).toHaveCount(0)
    }
    await expect(toggle(window)).toHaveCount(1)
  }
})
