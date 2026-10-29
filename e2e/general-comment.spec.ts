import { test, expect, attachScreenshot, setViewport } from './fixtures'

/**
 * Port de scripts/smoke-e2e.mjs (T4). El grueso del flujo (lista → detalle →
 * Archivos) ya lo cubren didactic/diff/comments; lo único no cubierto era el
 * comentario GENERAL del PR (composer de ConversationTab, no el de línea).
 * Se conserva el flujo completo como contexto del comentario.
 */

test('flujo T4: lista → detalle → Archivos → publicar comentario general', async ({
  window,
}, testInfo) => {
  // Indicador de conexión IPC (ping ok) — check heredado de la suite legacy.
  // Ping ok; "Partially connected" on a machine without a gh session (GitHub's probe is real).
  await expect(window.getByTestId('scm-connection')).toHaveText(/^(Connected|Partially connected)$/)

  await window.getByText('Add refunds table and migration').first().click()
  await expect(window.getByText('#479').first()).toBeVisible()

  // Señal inequívoca del diff (nombre de archivo del fixture): el título del
  // PR también contiene "refunds", así que un regex laxo pasaría sin diff.
  await window.getByText('Files').first().click()
  await expect(window.getByText('2026070401_create_refunds.sql').first()).toBeVisible()

  // Volver a Conversación y publicar por el composer GENERAL (identificado
  // por su placeholder: desde T8 hay varios textareas de replies de hilos).
  await window.getByText('Conversation').first().click()
  const composer = window.locator('textarea[placeholder*="Write a comment on this pull request"]')
  await composer.fill('Comentario de humo e2e — publicado vía Playwright')
  // Nombre EXACTO: /comentar/i también matchea "· 1 comentario" en el header
  // colapsable de los hilos (aprendido a la mala en la suite CDP).
  await window.getByRole('button', { name: 'Comment', exact: true }).click()

  // postComment + recarga de hilos ⇒ el comentario aparece en la conversación.
  await expect(window.getByText('Comentario de humo e2e').first()).toBeVisible()
  // El composer queda listo para el siguiente comentario.
  await expect(composer).toHaveValue('')

  await attachScreenshot(window, testInfo, 'general-comment-479')
})

test('Conversation reads top to bottom: composer under the description, grouped threads, quiet headers, real tabs', async ({
  window,
}, testInfo) => {
  await window.locator('aside').getByText('Fix cart rounding').first().click()
  await expect(window.getByRole('heading', { name: 'Fix cart rounding' }).first()).toBeVisible()

  // A real tablist: Conversation is the selected tab; the Comments tab says what it counts.
  const tablist = window.getByRole('tablist', { name: 'Pull request views' })
  const conversationTab = tablist.getByRole('tab', { name: 'Conversation' })
  await expect(conversationTab).toHaveAttribute('aria-selected', 'true')
  await expect(tablist.getByRole('tab', { name: 'Comments · 2 open' })).toBeVisible()
  const panel = window.getByRole('tabpanel', { name: 'Conversation' })

  // The general composer sits right under the description, before the threads.
  const composer = panel.getByLabel('General comment', { exact: true })
  const description = panel.locator('article').first()
  const general = panel.locator('[data-thread-group="general"]')
  const file = panel.locator('[data-thread-group="src/cart/total.ts"]')
  await expect(general.locator('[data-thread-id]')).toHaveCount(2)
  await expect(file.locator('[data-thread-id]')).toHaveCount(4)
  const [bDesc, bComposer, bGeneral, bFile] = await Promise.all([
    description.boundingBox(),
    composer.boundingBox(),
    general.boundingBox(),
    file.boundingBox(),
  ])
  expect(bDesc!.y + bDesc!.height).toBeLessThanOrEqual(bComposer!.y)
  expect(bComposer!.y).toBeLessThan(bGeneral!.y)
  // General first, then one group per file; a line thread shows its code.
  expect(bGeneral!.y).toBeLessThan(bFile!.y)
  const active = panel.locator('[data-thread-id="1"]')
  await expect(active.getByTestId('code-excerpt')).toContainText('const cents')

  // Quiet header: fold and link are separate controls; an open thread carries no tinted pill.
  await expect(active.getByRole('button', { name: 'Fold thread' })).toHaveAttribute(
    'aria-expanded',
    'true',
  )
  await expect(active.getByRole('link', { name: /src\/cart\/total\.ts:2/ })).toBeVisible()
  await expect(active.getByLabel('Thread status')).toHaveClass(/bg-transparent/)
  await expect(panel.locator('[data-thread-id="2"]').getByLabel('Thread status')).toHaveClass(
    /bg-warning/,
  )
  // Folded (closed) threads show a one-line preview.
  const closed = panel.locator('[data-thread-id="5"]')
  await expect(closed).toHaveAttribute('data-collapsed', 'true')
  await expect(closed).toContainText('Closing: discussed offline.')

  // The reply box starts as one line and grows into the full composer when focused.
  const replyForm = active.locator('form')
  await expect(replyForm).toHaveAttribute('data-expanded', 'false')
  await expect(active.getByRole('button', { name: 'Reply', exact: true })).toHaveCount(0)
  await attachScreenshot(window, testInfo, 'conversation-grouped')
  await active.getByLabel('Reply to this thread').click()
  await expect(replyForm).toHaveAttribute('data-expanded', 'true')
  await expect(active.getByRole('button', { name: 'Reply', exact: true })).toBeVisible()
  await expect(active.getByRole('button', { name: 'Insert suggestion' })).toBeVisible()
  await attachScreenshot(window, testInfo, 'conversation-reply-focused')

  // The general composer posts with Cmd/Ctrl+Enter, like a line comment, then is empty again.
  await composer.fill('General comment posted with the keyboard')
  await composer.press('ControlOrMeta+Enter')
  await expect(general).toContainText('General comment posted with the keyboard')
  await expect(composer).toHaveValue('')

  // Arrow keys move between the tabs (and switch them).
  await conversationTab.focus()
  await window.keyboard.press('ArrowRight')
  const filesTab = tablist.getByRole('tab', { name: /^Files/ })
  await expect(filesTab).toHaveAttribute('aria-selected', 'true')
  await expect(filesTab).toBeFocused()
  await window.keyboard.press('ArrowRight')
  // The general comment just posted is an open thread too: 3 now.
  const commentsTab = tablist.getByRole('tab', { name: 'Comments · 3 open' })
  await expect(commentsTab).toHaveAttribute('aria-selected', 'true')
  await expect(window.getByRole('group', { name: 'Filter threads' })).toBeVisible()
  await attachScreenshot(window, testInfo, 'comments-tab')
  await window.keyboard.press('Home')
  await expect(conversationTab).toHaveAttribute('aria-selected', 'true')

  // Tiled (a quarter of a 1080p screen): still readable, no horizontal overflow.
  await setViewport(window, 960, 540)
  await expect(active).toBeVisible()
  const overflow = await window.evaluate(() => ({
    scrollWidth: document.body.scrollWidth,
    innerWidth: window.innerWidth,
  }))
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.innerWidth)
  await attachScreenshot(window, testInfo, 'conversation-960x540')
})
