import { test, expect, setViewport, attachScreenshot, expandThread } from './fixtures'
import type { Locator, Page } from './fixtures'

/**
 * Threads written on an earlier push (mock universes): the code as it was
 * commented (with the latest version one click away), which push or commit
 * that was, groups of files a later push removed, one-line errors with Retry,
 * and a thread header that never draws its count under the pills.
 * Azure "contoso" #102: thread 2 (lines moved since push 1 of 2), thread 3
 * (resolved, on a long-path file push 2 removed). GitHub "shopwave" #470:
 * thread-470-1 (moved lines), thread-470-2 (file removed later), thread-470-3
 * (its first read at the commit fails).
 */

const aside = (page: Page) => page.locator('aside')
const tab = (page: Page, name: RegExp) =>
  page.getByRole('tablist', { name: 'Pull request views' }).getByRole('tab', { name })
const card = (page: Page, threadId: string) =>
  page.locator('[data-thread-id="' + threadId + '"]').first()
const group = (page: Page, path: string) =>
  page.locator('[data-thread-group="' + path + '"]').first()

const RULES = 'src/Services/Checkout/Rules/CheckoutRulesForCustomerGroups.cs'

async function openPr(page: Page, title: string): Promise<void> {
  await aside(page).getByText(title).first().click()
  await expect(page.getByRole('heading', { name: title }).first()).toBeVisible()
}

async function box(locator: Locator): Promise<{ x: number; y: number; w: number; h: number }> {
  const b = await locator.boundingBox()
  if (!b) throw new Error('no box')
  return { x: b.x, y: b.y, w: b.width, h: b.height }
}

/** Header pieces of a thread card never overlap and the count is drawn whole. */
async function expectHeaderClear(thread: Locator): Promise<void> {
  const path = await box(thread.getByTestId('thread-path'))
  const count = await box(thread.getByTestId('thread-comment-count'))
  const actions = await box(thread.locator('[data-thread-header-actions]'))
  // The path ends before the count starts.
  expect(path.x + path.w).toBeLessThanOrEqual(count.x + 0.5)
  // The count is either left of the pills, or the pills wrapped to their own row.
  const sameRow = Math.abs(count.y - actions.y) < count.h
  if (sameRow) expect(count.x + count.w).toBeLessThanOrEqual(actions.x + 0.5)
  else expect(actions.y).toBeGreaterThanOrEqual(count.y + count.h - 0.5)
  // The count text is not clipped.
  const clipped = await thread
    .getByTestId('thread-comment-count')
    .evaluate((el) => el.scrollWidth > el.clientWidth + 1)
  expect(clipped).toBe(false)
}

test('Azure #102: code as commented, Latest switch, removed file, header at a tiled width', async ({
  window,
}, testInfo) => {
  await openPr(window, 'Checkout v2: submit validation')
  await tab(window, /^Conversation/).click()

  // The removed file's group says which push removed it (push 1 of 2 -> push 2).
  await expect(group(window, RULES).getByTestId('group-removed')).toHaveText('removed in push 2')
  await expect(group(window, RULES)).not.toContainText('not in the diff')

  // Thread 3 (resolved, so folded): the file only exists as commented.
  const removed = card(window, '3')
  await expandThread(removed)
  await expect(removed.getByTestId('outdated-note')).toHaveText(
    'Code from push 1 of 2, when this was commented. The file was removed in push 2.',
  )
  await expect(removed.locator('[data-excerpt-line="5"]')).toContainText('MaxLinesPerOrder')
  await expect(removed.locator('[data-excerpt-line="6"]')).toHaveAttribute(
    'data-highlighted',
    'true',
  )
  const latest = removed.getByRole('tab', { name: 'Latest' })
  await expect(latest).toHaveAttribute('aria-disabled', 'true')
  await expect(latest).toHaveAttribute('title', 'Removed in push 2.')
  await expect(removed.getByRole('tab', { name: 'As commented' })).toHaveAttribute(
    'aria-selected',
    'true',
  )

  // Thread 2: lines moved since push 1; As commented by default, Latest one click away.
  const moved = card(window, '2')
  await expect(moved.getByTestId('outdated-note')).toHaveText(
    'Code from push 1 of 2, when this was commented.',
  )
  await expect(moved.locator('[data-excerpt-line="17"]')).toContainText(
    'order.Status = OrderStatus.Submitted;',
  )
  await moved.getByRole('tab', { name: 'Latest' }).click()
  await expect(moved.getByTestId('outdated-note')).toHaveText(
    'Latest version, around line 17. The comment was made on push 1 of 2.',
  )
  await expect(moved.getByTestId('code-excerpt')).toContainText('OrderStatus.Draft')

  // No raw provider error anywhere.
  await expect(window.getByTestId('excerpt-error')).toHaveCount(0)
  await expect(window.getByText(/TF401174|dev\.azure\.com/)).toHaveCount(0)
  await attachScreenshot(window, testInfo, 'outdated-azure-102')

  // Tiled: the long path gives way from the left; count and pills keep their room.
  await setViewport(window, 960, 1080)
  await expect(removed.getByTestId('thread-path')).toBeVisible()
  const truncated = await removed
    .getByTestId('thread-path')
    .evaluate((el) =>
      Array.from(el.children).some((child) => child.scrollWidth > child.clientWidth + 1),
    )
  expect(truncated).toBe(true)
  await expect(removed.getByTestId('thread-path')).toHaveAttribute('title', RULES + ':5–6')
  await expect(removed.getByTestId('thread-path')).toContainText('CheckoutRulesForCustomerGroups')
  // Thread 2: only the folders gave way; the file name and line are whole.
  const nameClipped = await moved.getByTestId('thread-path').evaluate((el) => {
    const name = el.lastElementChild as HTMLElement
    return name.scrollWidth > name.clientWidth + 1
  })
  expect(nameClipped).toBe(false)
  await expectHeaderClear(removed)
  await expectHeaderClear(moved)
  await removed.scrollIntoViewIfNeeded()
  await attachScreenshot(window, testInfo, 'outdated-azure-102-tiled')

  // Narrower still: the pills wrap under the path instead of covering the count.
  await setViewport(window, 760, 1000)
  await expectHeaderClear(removed)
  await removed.scrollIntoViewIfNeeded()
  await attachScreenshot(window, testInfo, 'outdated-azure-102-narrow')
})

test('GitHub #470: commit origins, a removed file, and a failed read with Retry', async ({
  window,
}, testInfo) => {
  await openPr(window, 'Add rate limiting middleware to public endpoints')
  await tab(window, /^Conversation/).click()

  // Removed in some later push (GitHub has no push numbers).
  await expect(group(window, 'src/lib/token-bucket.ts').getByTestId('group-removed')).toHaveText(
    'removed in a later push',
  )
  const removed = card(window, 'thread-470-2')
  await expandThread(removed)
  await expect(removed.getByTestId('outdated-note')).toHaveText(
    'Code from commit 4700a11, when this was commented. The file was removed in a later push.',
  )
  await expect(removed.locator('[data-excerpt-line="9"]')).toContainText('const elapsed')
  await expect(removed.getByRole('tab', { name: 'Latest' })).toHaveAttribute(
    'title',
    'The file no longer exists in the latest version.',
  )

  // Moved lines: the commented version, then the latest around the same line.
  const moved = card(window, 'thread-470-1')
  await expect(moved.getByTestId('outdated-note')).toHaveText(
    'Code from commit 4700c33, when this was commented.',
  )
  await expect(moved.locator('[data-excerpt-line="8"]')).toContainText(
    'await redis.expire(key, 60)',
  )
  await moved.getByRole('tab', { name: 'Latest' }).click()
  await expect(moved.getByTestId('outdated-note')).toHaveText(
    'Latest version, around line 8. The comment was made on commit 4700c33.',
  )
  await expect(moved.getByTestId('code-excerpt')).toContainText('WINDOW_SECONDS')

  // The first read of thread-470-3's code fails: one line and Retry, no raw error text.
  const flaky = card(window, 'thread-470-3')
  const error = flaky.getByTestId('excerpt-error')
  await expect(error).toHaveText(/Could not load this file at commit 4700c33\./)
  await expect(error).not.toContainText('ECONNRESET')
  await flaky.scrollIntoViewIfNeeded()
  await attachScreenshot(window, testInfo, 'outdated-github-470-error')
  await error.getByRole('button', { name: 'Retry' }).click()
  await expect(flaky.locator('[data-excerpt-line="6"]')).toContainText('app.use(rateLimit())')
  await expect(flaky.getByTestId('excerpt-error')).toHaveCount(0)
  await attachScreenshot(window, testInfo, 'outdated-github-470')
})
