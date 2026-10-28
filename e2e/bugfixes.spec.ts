import { test, expect, attachScreenshot, openAnalysisTab } from './fixtures'

/**
 * Port de scripts/smoke-bugfixes.mjs (regresiones de 2026-07-06), triado:
 *  1. Botones Copiar/Expandir de snippets no se superponen (ambos cliqueables).
 *  2. Descripción y comentarios del PR se renderizan como Markdown.
 *  3b. CSP permite imágenes data: (icono persona C4) y no hay violaciones
 *      img-src durante la sesión.
 * El check del visor de recursos (bug 3) NO se porta: detach.spec.ts ya
 * cubre el overlay con el SVG visible y el área de zoom con altura real.
 */

test('descripción y comentarios del PR renderizan Markdown (no crudo)', async ({ window }) => {
  await window.getByText('Add POST /carts/:id/apply-coupon').first().click()
  await window.getByText('Conversation').first().click()

  // Descripción: h2 reales dentro del article, sin "##" crudos.
  const article = window.locator('article').first()
  await expect(article.locator('h2').first()).toBeVisible()
  const md = await article.evaluate((el) => ({
    h2: el.querySelectorAll('h2').length,
    rawHashes: ((el as HTMLElement).innerText.match(/## /g) || []).length,
  }))
  expect(md.h2, 'h2 reales en la descripción').toBeGreaterThanOrEqual(2)
  expect(md.rawHashes, 'sin "##" crudos').toBe(0)

  // Comentario de hilo: inline code renderizado como <code>.
  await expect(
    window.locator('ul code', { hasText: 'coupon.discountRate' }).first(),
  ).toBeVisible()
})

test('snippet: Copiar y Expandir separados y cliqueables; CSP img-src sana', async ({
  window,
}, testInfo) => {
  // Contador de violaciones CSP de imágenes desde ANTES del análisis (captura
  // el render del person icon base64 del C4).
  await window.evaluate(() => {
    const w = window as unknown as Window & { __imgCspViolations?: string[] }
    w.__imgCspViolations = []
    document.addEventListener('securitypolicyviolation', (e) => {
      if (e.violatedDirective.startsWith('img-src')) {
        w.__imgCspViolations!.push(e.blockedURI.slice(0, 40))
      }
    })
  })

  await window.getByText('Add POST /carts/:id/apply-coupon').first().click()
  await openAnalysisTab(window)
  await window.getByRole('button', { name: 'Analyze PR' }).click()
  await expect(window.getByRole('button', { name: /Re-?analyze/i })).toBeEnabled({
    timeout: 90_000,
  })

  // Bug 1: los botones del header del snippet no se superponen y el centro de
  // cada uno responde a su propio botón (elementFromPoint).
  const expand = window.locator('button[aria-label="Expand snippet"]').first()
  await expand.scrollIntoViewIfNeeded()
  const buttons = await expand.evaluate((expandEl) => {
    const header = expandEl.closest('div.flex')?.parentElement
    const copy = Array.from((header ?? document).querySelectorAll('button')).find((b) =>
      /Copy|Copied/.test(b.textContent ?? ''),
    )
    if (!copy)
      return { err: 'sin botón copiar', overlap: null, copyClickable: null, expandClickable: null }
    const a = copy.getBoundingClientRect()
    const b = expandEl.getBoundingClientRect()
    const overlap = !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top)
    const centerHits = (r: DOMRect, el: Element) => {
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      return hit !== null && (el.contains(hit) || hit === el)
    }
    return {
      err: null,
      overlap,
      copyClickable: centerHits(a, copy),
      expandClickable: centerHits(b, expandEl),
    }
  })
  expect(buttons.err, 'botones del snippet medibles').toBeNull()
  expect(buttons.overlap, 'Copiar y Expandir no se superponen').toBe(false)
  expect(buttons.copyClickable, 'centro de Copiar cliqueable').toBe(true)
  expect(buttons.expandClickable, 'centro de Expandir cliqueable').toBe(true)

  await attachScreenshot(window, testInfo, 'bugfixes-snippet-482')

  // Bug 3b: la CSP permite imágenes data: (probe directo) y no hubo ninguna
  // violación img-src en toda la sesión (incluido el render de diagramas).
  const cspProbe = await window.evaluate(
    () =>
      new Promise<string>((resolve) => {
        const img = new Image()
        img.onload = () => resolve('loaded')
        img.onerror = () => resolve('error')
        img.src =
          'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
        setTimeout(() => resolve('timeout'), 3000)
      }),
  )
  expect(cspProbe, 'CSP permite imágenes data: (icono persona C4)').toBe('loaded')

  const violations = await window.evaluate(
    () => (window as unknown as Window & { __imgCspViolations?: string[] }).__imgCspViolations,
  )
  expect(violations, 'sin violaciones CSP img-src en la sesión').toEqual([])
})
