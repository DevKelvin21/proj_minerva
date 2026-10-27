import { test, expect, attachScreenshot, setViewport } from './fixtures'
import type { Page } from './fixtures'

/**
 * The sidebar's Queue view (default) and the folded rail: open PRs sorted by
 * what they need from you, sections that fold and stay folded, the local
 * filter, and the 56px rail with its view buttons and recent PRs.
 */

const aside = (page: Page) => page.locator('aside[aria-label="Pull request list"]')
const queue = (page: Page) => page.getByTestId('review-queue')
const section = (page: Page, name: string) =>
  page.locator('[data-testid="queue-section"][data-section="' + name + '"]')
const rail = (page: Page) => page.getByTestId('sidebar-rail')

test('Queue: sections by what PRs need, a status per row, local filter, folds remembered', async ({
  window,
}, testInfo) => {
  await setViewport(window, 1600, 1000)
  await expect(queue(window)).toBeVisible({ timeout: 20_000 })
  await expect(
    window.getByRole('group', { name: 'Left column view' }).getByRole('button', { name: /^Queue/ }),
  ).toHaveAttribute('aria-pressed', 'true')

  // Your own PRs carry the one status that matters.
  const mine = section(window, 'mine')
  await expect(mine).toBeVisible()
  await expect(mine.locator('[data-queue-status]').first()).toBeVisible()
  // Rows outside repo groups name their provider (and repo).
  await expect(queue(window).locator('[data-provider]').first()).toBeVisible()
  await attachScreenshot(window, testInfo, 'sidebar-queue')

  // The search field filters the queue locally.
  const search = window.getByLabel('Search pull requests')
  await search.fill('refund ledger')
  await expect(queue(window).getByRole('button', { name: /Refund ledger/ })).toHaveCount(1)
  await expect(queue(window).getByRole('button', { name: /Fix cart rounding/ })).toHaveCount(0)
  await search.fill('')

  // Fold "Your pull requests": its rows go, and stay folded after a reload.
  const header = mine.getByRole('button', { name: /Your pull requests/ })
  await header.click()
  await expect(header).toHaveAttribute('aria-expanded', 'false')
  await expect(mine.locator('li')).toHaveCount(0)
  await window.reload()
  await expect(
    section(window, 'mine').getByRole('button', { name: /Your pull requests/ }),
  ).toHaveAttribute('aria-expanded', 'false', { timeout: 20_000 })
  await section(window, 'mine')
    .getByRole('button', { name: /Your pull requests/ })
    .click()
  await expect(section(window, 'mine').locator('li').first()).toBeVisible()

  // Opening a PR from the queue opens the review.
  await queue(window)
    .getByRole('button', { name: /Fix cart rounding/ })
    .first()
    .click()
  await expect(window.locator('header:has(h1)')).toContainText('#108')
})

test('Rail: Cmd/Ctrl+B folds the sidebar to view buttons and recent PRs', async ({
  window,
}, testInfo) => {
  await setViewport(window, 1600, 1000)
  await expect(queue(window)).toBeVisible({ timeout: 20_000 })
  await aside(window)
    .getByRole('button', { name: /Fix cart rounding/ })
    .first()
    .click()
  await expect(window.locator('header:has(h1)')).toContainText('#108')

  await window.getByTestId('sidebar-toggle').click()
  await expect(aside(window)).toHaveCount(0)
  await expect(rail(window)).toBeVisible()
  const recent = rail(window).getByRole('list', { name: 'Recently opened' })
  await expect(recent.getByRole('button', { name: /^Open #108/ })).toHaveAttribute(
    'aria-current',
    'page',
  )
  await attachScreenshot(window, testInfo, 'sidebar-rail')

  // A view button expands the sidebar on that view.
  await rail(window)
    .getByRole('button', { name: /^Stacks/ })
    .click()
  await expect(rail(window)).toHaveCount(0)
  await expect(
    aside(window)
      .getByRole('group', { name: 'Left column view' })
      .getByRole('button', { name: /^Stacks/ }),
  ).toHaveAttribute('aria-pressed', 'true')
})

test('Resize: drag the sidebar edge, the width is remembered, double-click restores it', async ({
  window,
}, testInfo) => {
  await setViewport(window, 1600, 1000)
  await expect(queue(window)).toBeVisible({ timeout: 20_000 })
  const handle = window.getByRole('separator', { name: 'Resize sidebar' })
  const widthOf = async (): Promise<number> =>
    Math.round((await aside(window).boundingBox())?.width ?? 0)
  // Default xl width until the user drags.
  expect(await widthOf()).toBe(280)
  await expect(handle).toHaveAttribute('aria-valuenow', '280')

  const box = await handle.boundingBox()
  if (!box) throw new Error('resize handle has no box')
  const y = box.y + box.height / 2
  await window.mouse.move(box.x + box.width / 2, y)
  await window.mouse.down()
  await window.mouse.move(box.x + 120, y, { steps: 6 })
  await window.mouse.up()
  const dragged = await widthOf()
  expect(dragged).toBeGreaterThan(380)
  await expect(handle).toHaveAttribute('aria-valuenow', String(dragged))
  // Wider rows still show the queue (and the review keeps its room).
  await expect(section(window, 'mine')).toBeVisible()
  await attachScreenshot(window, testInfo, 'sidebar-resized')

  // Clamped: it never grows past 32% of the window (480px max).
  await handle.focus()
  for (let i = 0; i < 12; i++) await window.keyboard.press('ArrowRight')
  expect(await widthOf()).toBe(480)

  await window.reload()
  await expect(queue(window)).toBeVisible({ timeout: 20_000 })
  expect(await widthOf()).toBe(480)

  await handle.dblclick()
  expect(await widthOf()).toBe(280)
})

test('Didactic panel closed takes no room: no folded strip on the right', async ({
  window,
}, testInfo) => {
  await setViewport(window, 1600, 1000)
  await queue(window)
    .getByRole('button', { name: /Fix cart rounding/ })
    .first()
    .click()
  await expect(window.locator('header:has(h1)')).toContainText('#108')
  const toggle = window.locator('header button[aria-label="Didactic panel"]')
  await expect(window.getByRole('button', { name: 'Close didactic panel' })).toBeVisible()
  await window.getByRole('button', { name: 'Close didactic panel' }).click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  // The review fills the window up to its right edge.
  const review = window.getByTestId('review-view').locator('> *').first()
  await expect(review).toBeVisible()
  const viewport = window.viewportSize()?.width ?? (await window.evaluate(() => innerWidth))
  const box = await review.boundingBox()
  expect(Math.round((box?.x ?? 0) + (box?.width ?? 0))).toBe(viewport)
  await attachScreenshot(window, testInfo, 'didactic-panel-closed')
  await toggle.click()
  await expect(window.getByRole('button', { name: 'Close didactic panel' })).toBeVisible()
})
