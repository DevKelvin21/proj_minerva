import { test, expect, attachScreenshot } from './fixtures'

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
  await expect(window.getByText('Connected').first()).toBeVisible()

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
