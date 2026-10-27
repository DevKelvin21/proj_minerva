import { test, expect } from './fixtures'

/**
 * Port de scripts/smoke-copy-url.mjs (v0.2.3): botón "copiar URL del
 * comentario" en Conversación y en hilos inline del diff, con feedback
 * "Copiado" transitorio y la URL real de github.com en el portapapeles.
 */

const COPY_LABEL = 'Copy link to the comment on GitHub'

test('copiar URL de comentario: clipboard, feedback y hilo inline (#482)', async ({ window }) => {
  await window.getByText('Add POST /carts/:id/apply-coupon').first().click()

  // 1. Botones de copiar presentes en Conversación: uno por comentario.
  const copyButtons = window.locator(`button[aria-label="${COPY_LABEL}"]`)
  await expect(copyButtons.first()).toBeVisible()
  expect(await copyButtons.count()).toBeGreaterThanOrEqual(3)

  // 2. Click → el portapapeles tiene la URL github.com del comentario.
  // navigator.clipboard exige documento con foco (gotcha de la suite legacy).
  await window.bringToFront()
  await copyButtons.first().click()
  // 3. Feedback "Copied" (señal inequívoca: no existe antes del click)...
  await expect(window.getByText('Copied').first()).toBeVisible()
  const copied = await window.evaluate(() => navigator.clipboard.readText())
  expect(copied).toMatch(
    /^https:\/\/github\.com\/shopwave\/.+\/pull\/482#(discussion_r|issuecomment-)/,
  )
  // 4. ...y es transitorio (~1.5s): desaparece solo.
  await expect(window.getByText('Copied')).toHaveCount(0, { timeout: 5_000 })

  // 5. El hilo inline en el diff (chip → Archivos) también ofrece el botón.
  await window
    .locator('[role="link"]', { hasText: /coupon-service\.ts:\d+/ })
    .first()
    .click()
  await expect(window.locator(`button[aria-label="${COPY_LABEL}"]`).first()).toBeVisible()
})
