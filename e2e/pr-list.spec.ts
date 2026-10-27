import { test, expect, launchMinerva, closeMinerva, mainWindow, attachScreenshot } from './fixtures'
import type { Page } from './fixtures'

/**
 * Port de scripts/smoke-pr-list.mjs (F10): filtro de estado, refresh manual,
 * dots de no-visto + markPrSeen y watcher de cambios. El caso del watcher
 * lanza SU app con `MINERVA_WATCH_INTERVAL_MS=1500` (con el default de 60s
 * haría timeout) vía el fixture parametrizado.
 */

// Títulos de fixtures del universo shopwave usados como señales.
const OPEN_PR = 'apply-coupon' // #482 shopwave/api, open, commentCount 2
const CLOSED_PR = 'GraphQL gateway proxy' // #455 shopwave/api, closed
const MERGED_PR_A = 'pagination to order history' // #185 shopwave/web, merged
const MERGED_PR_B = 'multi-currency support' // #68 shopwave/checkout-service, merged
const WATCHED_PR = 'race condition in payment webhook' // open, para el watcher

const aside = (page: Page) => page.locator('aside')
const filterButton = (page: Page, label: string) =>
  aside(page).getByRole('button', { name: label, exact: true })
const refreshButton = (page: Page) =>
  page.locator('aside button[aria-label="Refresh"], aside button[title="Refresh"]')

/** Datos de dots/contador del item de la lista cuyo texto contiene `title`. */
const itemInfo = (page: Page, title: string) =>
  page.evaluate((t) => {
    const item = [...document.querySelectorAll('aside button')].find((b) =>
      (b as HTMLElement).innerText.includes(t),
    ) as HTMLElement | undefined
    if (!item) return null
    // Contador de comentarios: ÚNICO span del item que envuelve un svg y cuyo
    // texto es solo dígitos (MessageSquare + count). No usar includes(dígito)
    // sobre el texto completo: +adds/-dels y #número dan falsos positivos.
    const counter = [...item.querySelectorAll('span')].find(
      (s) => s.querySelector('svg') && /^\d+$/.test((s as HTMLElement).innerText.trim()),
    ) as HTMLElement | undefined
    return {
      unseenDot: Boolean(item.querySelector('span[title="Unseen changes"]')),
      commentsDot: Boolean(item.querySelector('span[title="New comments"]')),
      commentCount: counter ? counter.innerText.trim() : null,
    }
  }, title)

test('filtros de estado: Abiertos (default), Cerrados con badges, Todos', async ({
  window,
}, testInfo) => {
  // (1) Default "Abiertos": open visible, closed/merged fuera.
  await expect(aside(window).getByText(OPEN_PR).first()).toBeVisible()
  await expect(aside(window).getByText(CLOSED_PR)).toHaveCount(0)
  await expect(aside(window).getByText(MERGED_PR_A)).toHaveCount(0)

  // (2) "Cerrados": solo closed+merged, con badges de estado.
  await filterButton(window, 'Closed').click()
  await expect(aside(window).getByText(CLOSED_PR).first()).toBeVisible()
  await expect(aside(window).getByText(MERGED_PR_A).first()).toBeVisible()
  await expect(aside(window).getByText(MERGED_PR_B).first()).toBeVisible()
  await expect(aside(window).getByText(OPEN_PR)).toHaveCount(0)
  const badges = await window.evaluate(() => {
    const spans = [...document.querySelectorAll('aside span')]
    return {
      merged: spans.filter((s) => s.textContent?.trim() === 'merged').length,
      closed: spans.filter((s) => s.textContent?.trim() === 'closed').length,
    }
  })
  expect(badges.merged, 'badges merged en Cerrados').toBeGreaterThanOrEqual(2)
  expect(badges.closed, 'badges closed en Cerrados').toBeGreaterThanOrEqual(1)
  await attachScreenshot(window, testInfo, 'pr-list-cerrados')

  // (3) "Todos": open y closed conviven.
  await filterButton(window, 'All').click()
  await expect(aside(window).getByText(OPEN_PR).first()).toBeVisible()
  await expect(aside(window).getByText(CLOSED_PR).first()).toBeVisible()
})

test('refresh manual y dots de no-visto con markPrSeen', async ({ window }, testInfo) => {
  // (4) Refresh manual: re-fetchea sin error.
  await refreshButton(window).click()
  await expect(aside(window).getByText(OPEN_PR).first()).toBeVisible()
  await expect(window.getByText('Could not load')).toHaveCount(0)

  // (5) Sellar "visto" con valores VIEJOS fuerza un estado unread
  // determinístico (updatedAt actual > sellado ⇒ hasUpdates; commentCount
  // 2 > 0 ⇒ hasNewComments), inmune al pr-seen.json del userData (aquí
  // limpio por construcción, pero el sellado lo hace explícito).
  const target = await window.evaluate(async (title) => {
    const { items: prs } = await window.minerva.scm.listPullRequests({ state: 'open' })
    const pr = prs.find((p) => p.title.includes(title))
    if (!pr) return null
    await window.minerva.scm.markPrSeen({
      repo: pr.repo,
      number: pr.number,
      updatedAt: '2020-01-01T00:00:00Z',
      commentCount: 0,
    })
    const again = await window.minerva.scm.listPullRequests({ state: 'open' })
    return again.items.find((p) => p.id === pr.id)?.unread ?? null
  }, OPEN_PR)
  expect(target, 'unread por IPC tras sellar visto viejo').toMatchObject({
    isNew: false,
    hasUpdates: true,
    hasNewComments: true,
  })

  // Refetch de la UI para que pinte los dots.
  await refreshButton(window).click()
  await expect
    .poll(() => itemInfo(window, OPEN_PR), { message: 'dots visibles tras el refetch' })
    .toMatchObject({ unseenDot: true, commentsDot: true })
  await attachScreenshot(window, testInfo, 'pr-list-dots')

  // Seleccionar el PR = marcar visto ⇒ dots se apagan (clear optimista).
  await aside(window).getByText(OPEN_PR).first().click()
  await expect
    .poll(() => itemInfo(window, OPEN_PR), { message: 'dots apagados al seleccionar' })
    .toMatchObject({ unseenDot: false, commentsDot: false })

  // markPrSeen persistió en main: una query nueva viene limpia.
  const persisted = await window.evaluate(async (title) => {
    const { items: prs } = await window.minerva.scm.listPullRequests({ state: 'open' })
    return prs.find((p) => p.title.includes(title))?.unread ?? null
  }, OPEN_PR)
  expect(persisted).toMatchObject({ isNew: false, hasUpdates: false, hasNewComments: false })
})

// eslint-disable-next-line no-empty-pattern
test('watcher: un comentario nuevo refresca la lista sin refresh manual', async ({}, testInfo) => {
  const app = await launchMinerva(testInfo.outputPath('user-data'), {
    env: { MINERVA_WATCH_INTERVAL_MS: '1500' },
  })
  try {
    const window = await mainWindow(app)
    const seed = await window.evaluate(async (title) => {
      const { items: prs } = await window.minerva.scm.listPullRequests({ state: 'open' })
      const pr = prs.find((p) => p.title.includes(title))
      if (!pr) return null
      await window.minerva.scm.postComment({
        repo: pr.repo,
        number: pr.number,
        bodyMarkdown: 'comentario del e2e pr-list (watcher)',
      })
      return { commentCount: pr.commentCount ?? 0 }
    }, WATCHED_PR)
    expect(seed, 'fixture objetivo del watcher encontrado').not.toBeNull()

    // El watcher (1.5s) detecta commentCount+1 y el hook refetchea SOLO.
    const expected = String(seed!.commentCount + 1)
    await expect
      .poll(async () => (await itemInfo(window, WATCHED_PR))?.commentCount, {
        message: `contador ${seed!.commentCount} → ${expected} sin click (evento prListChanged)`,
        timeout: 15_000,
      })
      .toBe(expected)
  } finally {
    await closeMinerva(app)
  }
})
