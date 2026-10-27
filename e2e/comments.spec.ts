import { test, expect, setViewport, attachScreenshot, expandThread } from './fixtures'
import type { Page } from './fixtures'

/**
 * Comment review (mock universe): threads always next to their code in the
 * Files tab (including lines outside every hunk), the status picker,
 * replies, suggestions and the Comments view. Azure "contoso": #108 carries
 * every thread status; #102 has a comment on line 12 outside every hunk and
 * an outdated thread. GitHub "shopwave": #482 review threads. Every write
 * lands in the mock's memory.
 */

const aside = (page: Page) => page.locator('aside')
const tab = (page: Page, name: RegExp) => page.getByRole('button', { name }).first()
const filters = (page: Page) => page.getByRole('group', { name: 'Filter threads' })
const filterButton = (page: Page, label: string) =>
  filters(page).getByRole('button', { name: new RegExp('^' + label + ' \\d+$') })
const card = (page: Page, threadId: string) =>
  page.locator('[data-thread-id="' + threadId + '"]').first()

const webRepo = {
  provider: 'azure',
  organization: 'contoso',
  project: 'Platform',
  name: 'storefront-web',
  repositoryId: '22222222-2222-4222-8222-222222222222',
  fullName: 'contoso/Platform/storefront-web',
}

async function openPr(page: Page, title: string): Promise<void> {
  await aside(page).getByText(title).first().click()
  await expect(page.getByRole('heading', { name: title }).first()).toBeVisible()
}

test('#108: every status label, counts per filter, and a status change persists', async ({
  window,
}, testInfo) => {
  await openPr(window, 'Fix cart rounding')

  // Tab label carries the open-thread count (active + pending).
  await expect(tab(window, /^Comments \(2\)$/)).toBeVisible()
  await tab(window, /^Comments/).click()

  // Filter counts: Open 2, All 6, one per status.
  await expect(filterButton(window, 'Open')).toHaveAttribute('aria-pressed', 'true')
  await expect(filterButton(window, 'Open')).toHaveText(/Open\s*2/)
  await expect(filterButton(window, 'All')).toHaveText(/All\s*6/)
  for (const label of ['Active', 'Pending', 'Resolved', "Won't fix", 'Closed', 'By design']) {
    await expect(filterButton(window, label)).toHaveText(new RegExp(label + '\\s*1'))
  }

  // Open only (default): the active and the pending thread.
  await expect(window.locator('[data-thread-id]')).toHaveCount(2)

  // All: every status shows its label in the picker.
  await filterButton(window, 'All').click()
  await expect(window.locator('[data-thread-id]')).toHaveCount(6)
  const expected: Record<string, string> = {
    '1': 'Active',
    '2': 'Pending',
    '3': 'Resolved',
    '4': "Won't fix",
    '5': 'Closed',
    '6': 'By design',
  }
  for (const [id, label] of Object.entries(expected)) {
    const picker = card(window, id).getByLabel('Thread status')
    await expect(picker).toBeVisible()
    expect(await picker.evaluate((el: HTMLSelectElement) => el.selectedOptions[0].text)).toBe(label)
  }
  // Grouped: General (2) and the file (4); resolved/closed threads start collapsed.
  await expect(window.locator('[data-thread-group="general"] [data-thread-id]')).toHaveCount(2)
  await expect(
    window.locator('[data-thread-group="src/cart/total.ts"] [data-thread-id]'),
  ).toHaveCount(4)
  await expect(card(window, '5')).toHaveAttribute('data-collapsed', 'true')
  await expect(card(window, '1')).not.toHaveAttribute('data-collapsed', 'true')
  // Line threads show the code they point at.
  await expect(card(window, '1').getByTestId('code-excerpt')).toContainText('const cents')
  await attachScreenshot(window, testInfo, 'comments-108-all')

  // Status change: active -> won't fix, optimistic, then counted.
  await card(window, '1').getByLabel('Thread status').selectOption('wont_fix')
  await expect(card(window, '1').getByLabel('Thread status')).toHaveValue('wont_fix')
  await expect(filterButton(window, 'Open')).toHaveText(/Open\s*1/)
  await expect(tab(window, /^Comments \(1\)$/)).toBeVisible()

  // Persisted: a fresh read of the threads (main + provider) has it...
  const threads = await window.evaluate(
    (repo) => window.minerva.scm.getCommentThreads({ repo, number: 108 }),
    webRepo,
  )
  expect(threads.find((t: { id: string }) => t.id === '1')).toMatchObject({
    status: 'wont_fix',
    isResolved: true,
  })
  // ...and so does the UI after reloading the PR.
  await openPr(window, 'Checkout v2: submit validation')
  await openPr(window, 'Fix cart rounding')
  await tab(window, /^Comments/).click()
  await filterButton(window, 'All').click()
  await expect(card(window, '1').getByLabel('Thread status')).toHaveValue('wont_fix')
  await filterButton(window, "Won't fix").click()
  await expect(window.locator('[data-thread-id]')).toHaveCount(2)
})

test('#102: a comment outside every hunk shows next to its line; outdated badge; reply', async ({
  window,
}, testInfo) => {
  await openPr(window, 'Checkout v2: submit validation')
  await tab(window, /^Files/).click()

  // Line 12 is outside the only hunk: the file is fetched and the lines around
  // the comment are revealed in place.
  const line12 = window.locator('[data-new-line="12"]').first()
  await expect(line12).toContainText('// Line 12: kept as context.')
  const thread = window.locator('#thread-1')
  // Threads start folded to one line; open this one to read and reply.
  await expandThread(thread)
  await expect(thread).toContainText('Unrelated to the change, but this comment block is stale.')
  // The card sits right under line 12 (above line 13).
  const line13 = window.locator('[data-new-line="13"]').first()
  const [b12, bCard, b13] = await Promise.all([
    line12.boundingBox(),
    thread.boundingBox(),
    line13.boundingBox(),
  ])
  expect(b12 && bCard && b13).toBeTruthy()
  expect(bCard!.y).toBeGreaterThanOrEqual(b12!.y + b12!.height - 1)
  expect(bCard!.y + bCard!.height).toBeLessThanOrEqual(b13!.y + 1)
  // Still hidden lines above get an expander.
  await expect(window.getByTestId('diff-expander').first()).toContainText('hidden lines')

  // The outdated thread (left on the first push): badge, note and code excerpt.
  const outdated = window.locator('#thread-2')
  await expect(outdated.getByTestId('outdated-badge')).toHaveText('Outdated')
  await expandThread(outdated)
  await expect(outdated.getByTestId('outdated-note')).toContainText('may have changed')
  await expect(outdated.getByTestId('code-excerpt')).toContainText('OrderStatus.Draft')
  await attachScreenshot(window, testInfo, 'comments-102-files')

  // Reply in place.
  await thread.getByLabel('Reply to this thread').fill('Agreed, I will refresh that block.')
  await thread.getByRole('button', { name: 'Reply', exact: true }).click()
  await expect(thread).toContainText('Agreed, I will refresh that block.')
  await expect(thread.getByLabel('Reply to this thread')).toHaveValue('')

  // Generic expand: reveal everything above.
  await window.getByTestId('diff-expander').first().getByRole('button', { name: /Show/ }).click()
  await expect(window.locator('[data-new-line="1"]').first()).toContainText(
    'namespace Contoso.Orders.Services;',
  )
})

test('suggestions: insert from the head file, post, and render as a mini-diff', async ({
  window,
}, testInfo) => {
  await openPr(window, 'Checkout v2: submit validation')
  await tab(window, /^Files/).click()
  const thread = window.locator('#thread-1')
  await expect(thread).toBeVisible()
  await expandThread(thread)

  // Reply composer: prefilled with line 12 of the head file.
  const reply = thread.getByLabel('Reply to this thread')
  await thread.getByRole('button', { name: 'Insert suggestion' }).click()
  await expect(reply).toHaveValue('```suggestion\n        // Line 12: kept as context.\n```\n')
  await reply.fill('Reword it:\n```suggestion\n        // Line 12: validated above.\n```')
  await thread.getByRole('button', { name: 'Reply', exact: true }).click()

  const diff = thread.getByTestId('suggestion-diff').first()
  await expect(diff).toContainText('Suggested change')
  await expect(diff.locator('[data-suggestion-row="del"]')).toHaveText(
    /-\s*\/\/ Line 12: kept as context\./,
  )
  await expect(diff.locator('[data-suggestion-row="add"]')).toHaveText(
    /\+\s*\/\/ Line 12: validated above\./,
  )
  // No raw fence text leaks into the rendered body.
  await expect(thread).not.toContainText('```suggestion')
  await attachScreenshot(window, testInfo, 'comments-suggestion-reply')

  // New line comment on #108 (RIGHT line 3): insert, edit, post, rendered.
  await openPr(window, 'Fix cart rounding')
  await tab(window, /^Files/).click()
  const line3 = window.locator('[data-new-line="3"]').first()
  await expect(line3).toContainText('return cents / 100')
  await line3.hover()
  await window
    .locator('div.group\\/row:has([data-new-line="3"])')
    .first()
    .getByRole('button', { name: 'Add a comment on this line' })
    .click()
  const composer = window.getByLabel('Comment on line 3')
  await window.getByRole('button', { name: 'Insert suggestion' }).last().click()
  await expect(composer).toHaveValue('```suggestion\n  return cents / 100\n```\n')
  await composer.fill('```suggestion\n  return Math.round(cents) / 100\n```')
  await window.getByRole('button', { name: 'Comment', exact: true }).click()
  const created = window.locator('[data-suggestion-row="add"]', {
    hasText: 'return Math.round(cents) / 100',
  })
  await expect(created).toBeVisible()
  await expect(
    window.locator('[data-suggestion-row="del"]', { hasText: 'return cents / 100' }),
  ).toBeVisible()
  await attachScreenshot(window, testInfo, 'comments-suggestion-new-thread')
})

test('Comments view: filters, General group, and jumping to a hidden line', async ({
  window,
}, testInfo) => {
  await openPr(window, 'Checkout v2: submit validation')
  await tab(window, /^Comments \(2\)$/).click()
  await expect(filterButton(window, 'Open')).toHaveText(/Open\s*2/)
  await expect(filterButton(window, 'All')).toHaveText(/All\s*2/)
  await expect(card(window, '2').getByTestId('outdated-badge')).toBeVisible()
  await expect(card(window, '1').getByTestId('code-excerpt')).toContainText(
    '// Line 12: kept as context.',
  )
  await attachScreenshot(window, testInfo, 'comments-102-view')

  // Jump: Files tab, the file, line 12 revealed, highlighted and in view.
  await window.getByRole('link', { name: 'src/Services/CheckoutService.cs:12' }).click()
  await expect(tab(window, /^Files/)).toHaveAttribute('aria-pressed', 'true')
  const focused = window.locator('[data-new-line="12"][data-focused="true"]').first()
  await expect(focused).toContainText('// Line 12: kept as context.')
  await expect(focused).toBeInViewport()
  await expect(window.locator('#thread-1 [data-thread-id="1"]')).toHaveClass(/ring-1/)
  await attachScreenshot(window, testInfo, 'comments-jump-102')

  // #105: a general (PR-level) thread lands under "General".
  await openPr(window, 'Refund ledger')
  await tab(window, /^Comments/).click()
  await expect(window.locator('[data-thread-group="general"]')).toContainText('Retarget to main?')
})

test('GitHub #482: chip jumps to the diff thread and accepts a reply', async ({ window }) => {
  await window.getByText('Add POST /carts/:id/apply-coupon').first().click()
  const chip = window.locator('[role="link"]', { hasText: /coupon-service\.ts:\d+/ }).first()
  await expect(chip).toBeVisible()
  await chip.click()
  await expect(window.getByText('@@').first()).toBeVisible()

  const thread = window.locator('[id^="thread-"]').first()
  await thread.getByLabel('Reply to this thread').fill('e2e reply on a GitHub line thread')
  await thread.getByRole('button', { name: 'Reply', exact: true }).click()
  await expect(thread).toContainText('e2e reply on a GitHub line thread')

  // GitHub review threads offer only Active/Resolved.
  const options = await thread
    .getByLabel('Thread status')
    .first()
    .evaluate((el: HTMLSelectElement) => Array.from(el.options).map((o) => o.value))
  expect(options).toEqual(['active', 'resolved'])
})

test('gutter indicators for line threads (#479)', async ({ window }) => {
  await window.getByText('Add refunds table and migration').first().click()
  await tab(window, /^Files/).click()
  await expect(window.locator('svg.lucide-message-square').first()).toBeVisible()
})

const VIEWPORTS = [
  { name: 'full-1080p', w: 1920, h: 1080 },
  { name: 'half-vertical', w: 960, h: 1080 },
  { name: 'half-horizontal', w: 1920, h: 540 },
  { name: 'quarter', w: 960, h: 540 },
]

test('Files tab with comments at tiled sizes', async ({ window }, testInfo) => {
  await openPr(window, 'Checkout v2: submit validation')
  await tab(window, /^Files/).click()
  await expect(window.locator('#thread-1')).toBeVisible()

  for (const viewport of VIEWPORTS) {
    await setViewport(window, viewport.w, viewport.h)
    const thread = window.locator('#thread-1')
    // Narrow sizes switch split -> inline (a re-render): retry until it settles.
    await expect(async () => {
      await thread.scrollIntoViewIfNeeded({ timeout: 1_000 })
    }).toPass()
    await expect(thread).toContainText('Unrelated to the change')
    await expect
      .poll(async () => Math.round((await thread.boundingBox())?.width ?? -1), {
        message: 'thread card usable at ' + viewport.name,
      })
      .toBeGreaterThan(300)
    await expect(window.locator('[data-new-line="12"]').first()).toBeVisible()
    const overflow = await window.evaluate(() => ({
      scrollWidth: document.body.scrollWidth,
      innerWidth: window.innerWidth,
    }))
    expect(overflow.scrollWidth, 'no page overflow at ' + viewport.name).toBeLessThanOrEqual(
      overflow.innerWidth,
    )
    await attachScreenshot(window, testInfo, 'comments-files-' + viewport.name)
  }
})
