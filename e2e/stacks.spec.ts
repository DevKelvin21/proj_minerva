import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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
 * Stacked PRs + retarget (mock, Azure org "contoso"):
 * - orders-api: #101 → #102 → #103 (draft), grouped with storefront-web's
 *   #110 → #104 (same `feature/checkout-v2-models` branch): "Checkout v2".
 * - orders-api: #105 is orphaned (its parent #100 completed into main, #105
 *   still targets feature/refund-schema). Retarget to main fixes it.
 *
 * Retarget writes land in the fake server's memory only. Main asks for a
 * native confirmation first; `MINERVA_TEST_CONFIRM=accept|decline` makes it
 * answer by itself.
 */

/** The left column (the didactic panel is an `<aside>` too). */
const aside = (page: Page) => page.getByRole('complementary', { name: 'Pull request list' })
const node = (page: Page, number: number) => aside(page).locator(`[data-stack-node="${number}"]`)
const nodeRow = (page: Page, number: number) => node(page, number).locator('> button')
const header = (page: Page) => page.locator('header:has(h1)')
const CHECKOUT_GROUP = '[data-stack-group="group:azure:contoso:feature/checkout-v2-models"]'
const ORPHAN_TEXT =
  'Parent #100 was completed into main, but this PR still targets feature/refund-schema.'

const VIEWPORTS = [
  { name: 'full-1080p', w: 1920, h: 1080 },
  { name: 'vertical-half', w: 960, h: 1080 },
  { name: 'horizontal-half', w: 1920, h: 540 },
  { name: 'quarter', w: 960, h: 540 },
]

async function openStacks(page: Page): Promise<void> {
  await aside(page)
    .getByRole('button', { name: /^Stacks/ })
    .click()
  await expect(node(page, 101)).toBeVisible({ timeout: 20_000 })
}

/** Launch with an auto-answered confirmation dialog. */
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

test('stacks view: the 101→102→103 chain, the cross-repo group and the orphan', async ({
  window,
}, testInfo) => {
  await openStacks(window)

  // Cross-repo group, labelled from the root PR titles.
  const group = aside(window).locator(CHECKOUT_GROUP)
  await expect(group).toContainText('Checkout v2')
  await expect(group).toContainText('Same feature across 2 repos')
  await expect(group).toContainText('contoso/Platform/orders-api')
  await expect(group).toContainText('contoso/Platform/storefront-web')

  // The chains, nested as a tree.
  await expect(
    node(window, 101).locator('[data-stack-node="102"] [data-stack-node="103"]'),
  ).toHaveCount(1)
  await expect(node(window, 110).locator('[data-stack-node="104"]')).toHaveCount(1)
  await expect(group.locator('[data-stack-node]')).toHaveCount(5)
  await expect(nodeRow(window, 102)).toContainText('Checkout v2: submit validation')
  await expect(nodeRow(window, 102)).toContainText(
    'feature/checkout-v2-service → feature/checkout-v2-models',
  )
  await expect(nodeRow(window, 103)).toContainText('draft')
  await expect(group.locator('[data-provider="azure"]').first()).toBeVisible()

  // Orphan: badge + the one-line explanation + the action.
  await expect(nodeRow(window, 105).locator('[data-orphan-badge]')).toHaveText('Orphaned')
  await expect(node(window, 105)).toContainText(ORPHAN_TEXT)
  await expect(node(window, 105).getByRole('button', { name: 'Retarget to main' })).toBeVisible()
  await expect(aside(window).getByRole('button', { name: /^Stacks/ })).toContainText('1')
  await attachScreenshot(window, testInfo, 'stacks-view')

  // Text filter from the title bar search box.
  await window
    .getByPlaceholder(/Buscar|Search/)
    .first()
    .fill('refund')
  await expect(node(window, 105)).toBeVisible()
  await expect(node(window, 101)).toHaveCount(0)
  await window
    .getByPlaceholder(/Buscar|Search/)
    .first()
    .fill('')
  await expect(node(window, 101)).toBeVisible()

  // Tiled sizes: still reachable and readable, no horizontal overflow.
  for (const viewport of VIEWPORTS) {
    await setViewport(window, viewport.w, viewport.h)
    // React re-renders the new layout tier after the resize event: let it
    // commit, or the checks below can pass on the old (docked) layout and
    // then lose it when the drawer layout replaces it.
    await window.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    )
    const drawerToggle = window.getByRole('button', { name: 'PR list' })
    if ((await drawerToggle.count()) > 0 && (await aside(window).count()) === 0) {
      await drawerToggle.click()
    }
    await expect(nodeRow(window, 101)).toBeVisible()
    await expect(nodeRow(window, 101)).toContainText('#101')
    await node(window, 105).scrollIntoViewIfNeeded()
    await expect(node(window, 105)).toContainText(ORPHAN_TEXT)
    const overflow = await window.evaluate(() => {
      const sidebar = document.querySelector('aside[aria-label="Pull request list"]')
      return {
        page: document.documentElement.scrollWidth - window.innerWidth,
        sidebar: sidebar ? sidebar.scrollWidth - sidebar.clientWidth : 0,
      }
    })
    expect(overflow.page, viewport.name + ': page overflows horizontally').toBeLessThanOrEqual(0)
    expect(
      overflow.sidebar,
      viewport.name + ': sidebar overflows horizontally',
    ).toBeLessThanOrEqual(0)
    const box = await nodeRow(window, 102).boundingBox()
    expect(box?.width ?? 0, viewport.name + ': stack rows too narrow').toBeGreaterThan(200)
    await attachScreenshot(window, testInfo, 'stacks-' + viewport.name)
  }
})

test('PR detail of #102 shows its stack map; chips navigate; target branch form validates', async ({
  window,
}, testInfo) => {
  await openStacks(window)
  await nodeRow(window, 102).click()
  await expect(header(window)).toContainText('Checkout v2: submit validation')

  const stack = window.getByRole('region', { name: 'Stack', exact: true })
  const map = stack.getByRole('list', { name: 'Stack map' })
  await expect(map).toContainText('#101')
  await expect(map.locator('[aria-current="true"]')).toContainText('This PR')
  await expect(map).toContainText('#103')
  await expect(stack).toContainText('2 of 3')
  await expect(stack).toContainText('Built on top of #101 (feature/checkout-v2-models)')
  await expect(stack).toContainText('#103 builds on top of this one')
  await expect(stack).toContainText('Same feature in storefront-web (#110 and #104)')
  await expect(nodeRow(window, 102)).toHaveAttribute('aria-pressed', 'true')
  await attachScreenshot(window, testInfo, 'pr-detail-stack-map')

  // Short window (horizontal half): one-line header, the map lives behind "Detalles".
  await setViewport(window, 1920, 540)
  await header(window).getByText('Details').click()
  const shortStack = window.getByRole('region', { name: 'Stack', exact: true })
  await expect(shortStack).toBeVisible()
  await expect(shortStack.locator('[aria-current="true"]')).toContainText('This PR')
  await shortStack.scrollIntoViewIfNeeded()
  await attachScreenshot(window, testInfo, 'pr-detail-stack-map-short')
  await header(window).getByText('Details').click()
  await setViewport(window, 1920, 1080)

  // "Change target branch…": validated, explains the consequence, writes nothing here.
  await header(window).getByRole('button', { name: 'Change target branch…' }).click()
  const form = window.getByRole('form', { name: 'Change target branch' })
  const input = form.getByRole('textbox')
  await expect(input).toHaveValue('feature/checkout-v2-models')
  await input.fill('bad name')
  await expect(form).toContainText('cannot contain spaces')
  await expect(form.getByRole('button', { name: 'Retarget' })).toBeDisabled()
  await input.fill('feature/checkout-v2-service')
  await expect(form).toContainText('cannot target its own source branch')
  await input.fill('main')
  await expect(form).toContainText('The diff will be recomputed against main')
  await expect(form.getByRole('button', { name: 'Retarget' })).toBeEnabled()
  await attachScreenshot(window, testInfo, 'pr-detail-change-target')
  await form.getByRole('button', { name: 'Cancel' }).click()
  await expect(form).toHaveCount(0)

  // Chips open the other PRs of the stack.
  await map.getByRole('button', { name: /#101/ }).click()
  await expect(header(window)).toContainText('Checkout v2: order status and currency')
  await expect(window.getByRole('region', { name: 'Stack', exact: true })).toContainText(
    'First in the stack',
  )
})

// eslint-disable-next-line no-empty-pattern
test('retarget (accepted): the orphan badge clears and #105 targets main', async ({}, testInfo) => {
  await withConfirm('accept', testInfo.outputPath('user-data'), async (window) => {
    await openStacks(window)
    const orphan = node(window, 105)
    await orphan.getByRole('button', { name: 'Retarget to main' }).click()
    // The consequence is shown before anything is written.
    await expect(orphan).toContainText('Target branch:')
    await expect(orphan).toContainText('The diff will be recomputed against main')
    await expect(orphan).toContainText('already landed through #100')
    await attachScreenshot(window, testInfo, 'retarget-preview')
    await orphan.getByRole('button', { name: 'Retarget #105' }).click()

    const note = aside(window).getByRole('status').filter({ hasText: 'now targets' })
    await expect(note).toContainText('#105 now targets main (was feature/refund-schema)')
    await expect(node(window, 105)).toHaveCount(0)
    await expect(aside(window).locator('[data-orphan-badge]')).toHaveCount(0)
    await expect(node(window, 101)).toBeVisible()
    await attachScreenshot(window, testInfo, 'retarget-done-stacks')

    await note.getByRole('button', { name: '#105' }).click()
    await expect(header(window)).toContainText('Refund ledger')
    // The header now carries the note; the sidebar does not repeat it.
    await expect(note).toHaveCount(0)
    await expect(window.getByTestId('pr-branches')).toHaveText('feature/refund-ledger → main')
    await expect(header(window).getByRole('status')).toContainText(
      '#105 now targets main (was feature/refund-schema). Its diff is now against main.',
    )
    await attachScreenshot(window, testInfo, 'retarget-done-detail')
  })
})

// eslint-disable-next-line no-empty-pattern
test('retarget: a base changed behind the UI is a CONFLICT that explains and refreshes', async ({}, testInfo) => {
  await withConfirm('accept', testInfo.outputPath('user-data'), async (window) => {
    await openStacks(window)
    await nodeRow(window, 105).click()
    await expect(header(window)).toContainText('Refund ledger')
    const stack = window.getByRole('region', { name: 'Stack', exact: true })
    await expect(stack).toContainText(ORPHAN_TEXT)

    // Someone else retargets #105 while the UI still shows the old base.
    const repo = await window.evaluate(async () => {
      const list = await window.minerva.scm.listPullRequests({ state: 'open' })
      return list.items.find((pr: { number: number }) => pr.number === 105).repo
    })
    await window.evaluate(
      (r) =>
        window.minerva.scm.retarget({
          repo: r,
          number: 105,
          expectedCurrentBase: 'feature/refund-schema',
          newBase: 'main',
        }),
      repo,
    )

    await stack.getByRole('button', { name: 'Retarget to main' }).click()
    await stack.getByRole('button', { name: 'Retarget #105' }).click()
    const alert = header(window).locator('[data-error-code="CONFLICT"]')
    await expect(aside(window).locator('[data-error-code="CONFLICT"]')).toHaveCount(0)
    await expect(alert).toContainText('changed since this view loaded')
    await attachScreenshot(window, testInfo, 'retarget-conflict')
    // The refresh lands: the detail now shows main and the orphan is gone.
    await expect(window.getByTestId('pr-branches')).toHaveText('feature/refund-ledger → main')
    await expect(node(window, 105)).toHaveCount(0)
  })
})

/** Main answers `MINERVA_TEST_CONFIRM=decline` only once its native dialog exists. */
function builtMainHonorsDecline(): boolean {
  try {
    return readFileSync(join(process.cwd(), 'out/main/index.js'), 'utf8').includes(
      'MINERVA_TEST_CONFIRM',
    )
  } catch {
    return false
  }
}

// eslint-disable-next-line no-empty-pattern
test('retarget (declined): nothing changes, quietly', async ({}, testInfo) => {
  test.skip(
    !builtMainHonorsDecline(),
    'The built main has no confirmation dialog yet (MINERVA_TEST_CONFIRM unsupported).',
  )
  await withConfirm('decline', testInfo.outputPath('user-data'), async (window) => {
    await openStacks(window)
    await nodeRow(window, 105).click()
    await expect(header(window)).toContainText('Refund ledger')
    const stack = window.getByRole('region', { name: 'Stack', exact: true })
    await stack.getByRole('button', { name: 'Retarget to main' }).click()
    await stack.getByRole('button', { name: 'Retarget #105' }).click()

    // Back to the initial action, no error, base unchanged, still orphaned.
    await expect(stack.getByRole('button', { name: 'Retarget to main' })).toBeVisible()
    await expect(window.getByRole('alert')).toHaveCount(0)
    await expect(window.getByTestId('pr-branches')).toHaveText(
      'feature/refund-ledger → feature/refund-schema',
    )
    await expect(nodeRow(window, 105).locator('[data-orphan-badge]')).toBeVisible()
    await expect(node(window, 105)).toContainText(ORPHAN_TEXT)
    await attachScreenshot(window, testInfo, 'retarget-declined')
  })
})
