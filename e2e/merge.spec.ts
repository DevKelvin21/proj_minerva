import {
  test,
  expect,
  launchMinerva,
  closeMinerva,
  mainWindow,
  setViewport,
  attachScreenshot,
} from './fixtures'
import type { Page } from './fixtures'

/**
 * Merge + auto-merge / auto-complete (mock only: writes land in the in-memory
 * GitHub universe "shopwave" and the Azure fake server "contoso").
 *
 * - shopwave/api: every method, auto-merge allowed. #482 can merge now, #479
 *   waits for checks (auto-merge offered).
 * - shopwave/web: no rebase, auto-merge off; #190 has conflicts.
 * - contoso storefront-web #108: ready, a merge-strategy policy forbids
 *   rebase, one linked work item. orders-api #101: auto-complete already on.
 *
 * Main asks with a native dialog before every write; `MINERVA_TEST_CONFIRM`
 * answers it (mock mode only).
 */

const aside = (page: Page) => page.getByRole('complementary', { name: 'Pull request list' })
const popover = (page: Page) => page.getByTestId('merge-popover')

const GH_READY = 'Add POST /carts/:id/apply-coupon endpoint'
const GH_PENDING = 'Add refunds table and migration for partial refunds'
const GH_CONFLICTS = 'Add dark mode toggle to account settings'
const AZ_READY = 'Fix cart rounding'
const AZ_AUTO = 'Checkout v2: order status and currency'

async function openPr(page: Page, title: string): Promise<void> {
  await aside(page).getByText(title).first().click()
  await expect(page.getByRole('heading', { name: title }).first()).toBeAttached()
  await expect(page.getByTestId('merge-trigger')).toBeVisible({ timeout: 20_000 })
}

async function openMergePopover(page: Page): Promise<void> {
  await page.getByTestId('merge-trigger').click()
  await expect(popover(page)).toBeVisible()
  // The options arrive: either "ready" or a blocker.
  await expect(
    popover(page).locator('[data-testid="merge-ready"], [data-testid="merge-blocker"]'),
  ).toBeVisible()
}

async function withConfirm(
  answer: 'accept' | 'decline',
  outputDir: string,
  body: (page: Page) => Promise<void>,
): Promise<void> {
  const app = await launchMinerva(outputDir, { env: { MINERVA_TEST_CONFIRM: answer } })
  try {
    await body(await mainWindow(app))
  } finally {
    await closeMinerva(app)
  }
}

// eslint-disable-next-line no-empty-pattern
test('GitHub: merge #482 with the repository methods; the PR becomes merged', async ({}, testInfo) => {
  await withConfirm('accept', testInfo.outputPath('user-data'), async (window) => {
    await setViewport(window, 1600, 1000)
    await openPr(window, GH_READY)
    await openMergePopover(window)
    const panel = popover(window)
    await expect(panel).toContainText('Merge PR #482')
    await expect(panel.getByTestId('merge-ready')).toContainText('Ready')
    await expect(panel.getByRole('radio', { name: 'Merge commit' })).toBeChecked()
    await expect(panel.getByRole('radio', { name: 'Rebase' })).toBeEnabled()
    // Clean PR: GitHub has nothing to wait for, so auto-merge is off with a reason.
    await expect(panel.getByTestId('auto-merge-on')).toBeDisabled()
    await expect(panel.getByTestId('auto-merge-unavailable')).toContainText('Nothing is pending')
    await panel.getByRole('radio', { name: 'Squash' }).check()
    await panel.getByTestId('merge-delete-branch').check()
    await attachScreenshot(window, testInfo, 'github-merge-popover')

    await panel.getByTestId('merge-now').click()
    await expect(window.getByTestId('merge-notice')).toContainText('Merged')
    await expect(popover(window)).toHaveCount(0)
    await expect(window.getByTestId('merge-trigger')).toHaveCount(0)
    await attachScreenshot(window, testInfo, 'github-merged')

    const state = await window.evaluate(async () => {
      const list = await window.minerva.scm.listPullRequests({ state: 'all' })
      return list.items.find((pr: { number: number }) => pr.number === 482)?.state
    })
    expect(state).toBe('merged')
  })
})

// eslint-disable-next-line no-empty-pattern
test('GitHub: auto-merge on #479 while checks run, shown with who and how, then off', async ({}, testInfo) => {
  await withConfirm('accept', testInfo.outputPath('user-data'), async (window) => {
    await setViewport(window, 1600, 1000)
    await openPr(window, GH_PENDING)
    await openMergePopover(window)
    const panel = popover(window)
    await expect(panel.getByTestId('merge-blocker')).toHaveAttribute('data-blocker', 'checks_pending')
    await expect(panel.getByTestId('merge-now')).toBeDisabled()
    await panel.getByRole('radio', { name: 'Squash' }).check()
    await panel.getByTestId('auto-merge-on').click()

    const trigger = window.getByTestId('merge-trigger')
    await expect(trigger).toContainText('Auto-merge · Squash')
    await openMergePopover(window)
    const state = popover(window).getByTestId('auto-merge-state')
    await expect(state).toContainText('Auto-merge is on')
    await expect(state).toContainText('mgarcia')
    await expect(state).toContainText('Squash')
    await attachScreenshot(window, testInfo, 'github-auto-merge-on')

    await state.getByTestId('auto-merge-off').click()
    await expect(window.getByTestId('merge-primary')).toBeVisible()
    await expect(window.getByTestId('merge-trigger')).not.toContainText('Auto-merge')
  })
})

test('GitHub: conflicts, a forbidden method and auto-merge turned off in the repository', async ({
  window,
}, testInfo) => {
  await setViewport(window, 1600, 1000)
  await openPr(window, GH_CONFLICTS)
  await openMergePopover(window)
  const panel = popover(window)
  await expect(panel.getByTestId('merge-blocker')).toHaveAttribute('data-blocker', 'conflicts')
  await expect(panel.getByTestId('merge-blocker')).toContainText('merge conflicts')
  await expect(panel.getByTestId('merge-now')).toBeDisabled()
  await expect(panel.getByRole('radio', { name: /Rebase/ })).toBeDisabled()
  await expect(panel).toContainText('Off in this repository')
  await expect(panel.getByTestId('auto-merge-unavailable')).toContainText(
    "Auto-merge is off in this repository's settings",
  )
  await attachScreenshot(window, testInfo, 'github-blocked')

  // The quick half of the split button does not merge a blocked PR: it opens the options.
  await window.keyboard.press('Escape')
  await expect(popover(window)).toHaveCount(0)
  await window.getByTestId('merge-primary').click()
  await expect(popover(window)).toBeVisible()
})

test('main refuses stale or blocked merges with typed codes, before any dialog', async ({
  window,
}) => {
  const results = await window.evaluate(async () => {
    const list = await window.minerva.scm.listPullRequests({ state: 'open' })
    type Item = { number: number; repo: unknown; headSha: string }
    const byNumber = (n: number) => list.items.find((pr: Item) => pr.number === n) as Item
    const attempt = async (n: number, sha?: string) => {
      const pr = byNumber(n)
      try {
        await window.minerva.scm.merge({
          repo: pr.repo,
          number: n,
          expectedHeadSha: sha ?? pr.headSha,
          strategy: 'merge',
          deleteSourceBranch: false,
          transitionWorkItems: false,
        })
        return 'merged'
      } catch (error) {
        return /\[SCM:([A-Z_]+)\]/.exec(String(error))?.[1] ?? String(error)
      }
    }
    return {
      moved: await attempt(482, '0'.repeat(40)),
      conflicts: await attempt(190),
      checks: await attempt(77),
      pending: await attempt(479),
    }
  })
  expect(results).toEqual({
    moved: 'CONFLICT',
    conflicts: 'MERGE_CONFLICT',
    checks: 'CHECKS_FAILING',
    pending: 'CHECKS_FAILING',
  })
})

// eslint-disable-next-line no-empty-pattern
test('GitHub (declined): nothing is merged, quietly', async ({}, testInfo) => {
  await withConfirm('decline', testInfo.outputPath('user-data'), async (window) => {
    await openPr(window, GH_READY)
    await openMergePopover(window)
    await popover(window).getByTestId('merge-now').click()
    await expect(popover(window).getByTestId('merge-now')).toBeEnabled()
    await expect(popover(window).getByRole('alert')).toHaveCount(0)
    await expect(window.getByTestId('merge-notice')).toHaveCount(0)
  })
})

// eslint-disable-next-line no-empty-pattern
test('Azure DevOps: complete #108 semi-linear, deleting the branch and completing work items', async ({}, testInfo) => {
  await withConfirm('accept', testInfo.outputPath('user-data'), async (window) => {
    await setViewport(window, 1600, 1000)
    await openPr(window, AZ_READY)
    await expect(window.getByTestId('merge-primary')).toContainText('Complete')
    await openMergePopover(window)
    const panel = popover(window)
    await expect(panel).toContainText('Complete PR #108')
    await expect(panel.getByTestId('merge-ready')).toContainText('every required policy passed')
    await expect(panel.getByRole('radio', { name: /Rebase/ }).first()).toBeDisabled()
    await expect(panel).toContainText('Not allowed by branch policy')
    await panel.getByRole('radio', { name: 'Semi-linear merge' }).check()
    await panel.getByTestId('merge-delete-branch').check()
    await expect(panel.getByTestId('merge-work-items')).toBeChecked()
    await expect(panel.getByTestId('auto-merge-on')).toContainText('Set auto-complete')
    await attachScreenshot(window, testInfo, 'azure-complete-popover')

    await panel.getByTestId('merge-now').click()
    await expect(window.getByTestId('merge-notice')).toContainText('Merged')
    await attachScreenshot(window, testInfo, 'azure-completed')
  })
})

// eslint-disable-next-line no-empty-pattern
test('Azure DevOps: the auto-complete already on #101 (who, strategy, options), then cancelled', async ({}, testInfo) => {
  await withConfirm('accept', testInfo.outputPath('user-data'), async (window) => {
    await setViewport(window, 1600, 1000)
    await openPr(window, AZ_AUTO)
    const trigger = window.getByTestId('merge-trigger')
    await expect(trigger).toContainText('Auto-complete · Squash')
    await openMergePopover(window)
    const state = popover(window).getByTestId('auto-merge-state')
    await expect(state).toContainText('Auto-complete is on')
    await expect(state).toContainText('Ada Lovelace')
    await expect(state).toContainText('Deleted after merge')
    await expect(state).toContainText('Completed')
    await expect(popover(window).getByTestId('merge-blocker')).toContainText(
      'Required reviewers or branch policies',
    )
    await attachScreenshot(window, testInfo, 'azure-auto-complete-on')

    await state.getByTestId('auto-merge-off').click()
    await expect(window.getByTestId('merge-primary')).toContainText('Complete')
    await expect(window.getByTestId('merge-trigger')).not.toContainText('Auto-complete')
  })
})

test('tiled sizes: the control stays reachable and its popover fits the window', async ({
  window,
}, testInfo) => {
  await openPr(window, GH_PENDING)
  for (const viewport of [
    { name: 'vertical-half', w: 960, h: 1080 },
    { name: 'quarter', w: 960, h: 540 },
    { name: 'narrow', w: 700, h: 700 },
  ]) {
    await setViewport(window, viewport.w, viewport.h)
    await window.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    )
    // Narrow windows open the AI panel as a modal drawer over the review: close it.
    const aiDrawer = window.getByRole('dialog', { name: 'AI' })
    if (await aiDrawer.isVisible()) {
      await window.keyboard.press('Escape')
      await expect(aiDrawer).toHaveCount(0)
    }
    await expect(window.getByTestId('merge-trigger')).toBeVisible()
    await openMergePopover(window)
    const box = await popover(window).boundingBox()
    expect(box).not.toBeNull()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.w + 1)
    await attachScreenshot(window, testInfo, 'merge-' + viewport.name)
    await window.keyboard.press('Escape')
    await expect(popover(window)).toHaveCount(0)
  }
})

/** Left/right edges of the PR bar's parts, in order: tabs, Details, Walkthrough, Merge. */
async function barEdges(page: Page) {
  return page.evaluate(() => {
    const box = (el: Element | null) => {
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { left: Math.round(r.left), right: Math.round(r.right) }
    }
    // The tabs' visible box is their scroll container (the tablist itself may be wider and scrolled).
    const tabs = document.querySelector('[role="tablist"][aria-label]')?.parentElement ?? null
    const details = document.querySelector('[data-testid="pr-details"]')
    const walkthrough = [...document.querySelectorAll('header button')].find((b) =>
      /Walkthrough/.test(b.getAttribute('aria-label') ?? b.textContent ?? ''),
    )
    const merge = document.querySelector('[data-testid="merge-trigger"]')?.closest('[data-no-drag]')
    const bar = details?.closest('div.h-12')
    return {
      tabsClipped: tabs ? tabs.scrollWidth > tabs.clientWidth + 1 : true,
      tabs: box(tabs),
      details: box(details),
      walkthrough: box(walkthrough ?? null),
      merge: box(merge ?? null),
      bar: box(bar ?? null),
    }
  })
}

test('narrow windows: tabs, Details, Walkthrough and Merge never overlap', async ({
  window,
}, testInfo) => {
  await openPr(window, 'Checkout v2: submit validation')
  for (const width of [1280, 960, 860, 760, 700, 600]) {
    await setViewport(window, width, 800)
    await window.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    )
    const aiDrawer = window.getByRole('dialog', { name: 'AI' })
    if (await aiDrawer.isVisible()) {
      await window.keyboard.press('Escape')
      await expect(aiDrawer).toHaveCount(0)
    }
    await expect(window.getByTestId('merge-trigger')).toBeVisible()
    const edges = await barEdges(window)
    const parts = [edges.tabs, edges.details, edges.walkthrough, edges.merge]
    for (const part of parts) expect(part, `width ${width}`).not.toBeNull()
    for (let i = 1; i < parts.length; i++) {
      expect(parts[i]!.left, `width ${width}: part ${i} starts after part ${i - 1}`).toBeGreaterThanOrEqual(
        parts[i - 1]!.right,
      )
    }
    expect(edges.tabsClipped, `width ${width}: every tab fits`).toBe(false)
    expect(edges.merge!.right, `width ${width}: Merge inside the bar`).toBeLessThanOrEqual(
      edges.bar!.right,
    )
    await attachScreenshot(window, testInfo, 'bar-' + width)
  }
})
