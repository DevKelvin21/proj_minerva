import { test, expect, attachScreenshot } from './fixtures'
import { buildDidacticHash } from '../src/shared/didactic-route'
import type { RepoRef } from '../src/shared/scm'

/**
 * Port de los checks de VENTANA de scripts/smoke-detach.mjs (T14/T22):
 * desacoplar el panel didáctico, visor de recursos, reutilización de la
 * ventana y sincronización con streamings lanzados en otra superficie.
 * (Los checks puros de cache/dedupe viven en analysis-cache.spec.ts.)
 */

const PR_482 = {
  repo: { provider: 'github' as const, owner: 'shopwave', name: 'api', fullName: 'shopwave/api' },
  number: 482,
}
const PR_201 = {
  repo: { provider: 'github' as const, owner: 'shopwave', name: 'web', fullName: 'shopwave/web' },
  number: 201,
}
/** `#didactic/<base64url repo>/<n>` without the title query: the route encodes the full RepoRef. */
function didacticPath(pr: { repo: RepoRef; number: number }): string {
  return '#' + buildDidacticHash(pr.repo, pr.number, '').split('?')[0]
}

const PR_479 = {
  repo: { provider: 'github' as const, owner: 'shopwave', name: 'api', fullName: 'shopwave/api' },
  number: 479,
}

test('desacoplar: cierra el panel, muestra cache sin click, visor y reutilización', async ({
  minerva,
  window,
}, testInfo) => {
  // Cache poblado vía IPC (como la suite legacy) y PR seleccionado en la UI.
  await window.evaluate((p) => window.minerva.ai.analyzePullRequest(p), PR_482)
  await window.getByText('apply-coupon').first().click()

  // T22: se cliquea el botón REAL "Abrir en ventana" (el efecto de cerrar el
  // panel acoplado vive en el onClick de DidacticPanel, no en el canal IPC).
  const detachedPromise = minerva.context.waitForEvent('page')
  await window.locator('button[aria-label="Open in window"]').click()
  const detached = await detachedPromise
  await detached.waitForLoadState('domcontentloaded')
  expect(detached.url()).toContain(didacticPath(PR_482))

  // El panel acoplado se CIERRA tras desacoplar (T22).
  await expect(window.locator('button[aria-label="Open didactic panel"]')).toBeVisible()
  await expect(window.locator('button[aria-label="Close didactic panel"]')).toHaveCount(0)

  // La ventana muestra el análisis desde cache SIN pulsar nada.
  await expect(detached.getByText(/Summary|Endpoint/).first()).toBeVisible()
  await expect(detached.getByRole('button', { name: /Re-?analyze/i })).toBeVisible()

  // Visor de recursos: el análisis mock del #482 trae diagrama ⇒ expandir
  // debe abrir el overlay con zoom y el SVG visible dentro (el gotcha del
  // visor colapsado a 0px que pasaba los checks geométricos).
  await detached.locator('button[aria-label="Expand diagram"]').first().click()
  const overlay = detached.locator('.fixed.inset-0')
  await expect(overlay).toBeVisible()
  await expect(detached.getByText(/^\d+%$/).first()).toBeVisible()
  const overlaySvg = overlay.locator('svg[id*="mermaid"], svg[aria-roledescription]').first()
  await expect(overlaySvg).toBeVisible({ timeout: 10_000 })
  const svgBox = await overlaySvg.boundingBox()
  expect(svgBox && svgBox.width, 'diagrama con tamaño real dentro del visor').toBeGreaterThan(100)
  const zoomAreaH = await overlaySvg.evaluate(
    (svg) => svg.closest('[class*="overflow-hidden"]')?.getBoundingClientRect().height ?? 0,
  )
  expect(zoomAreaH, 'área de zoom con altura real (no colapsada)').toBeGreaterThan(300)

  await attachScreenshot(detached, testInfo, 'detached-viewer-482')

  // Esc cierra el visor.
  await detached.keyboard.press('Escape')
  await expect(overlay).toHaveCount(0)

  // Reutilización: reabrir con OTRO PR usa la MISMA ventana (re-navegación
  // same-document: verificar CONTENIDO, no solo URL — el bug histórico era
  // URL nueva con el PR viejo pintado).
  await window.evaluate(
    (p) => window.minerva.window.openDidactic({ ...p, title: 'Add refunds table' }),
    PR_479,
  )
  await expect
    .poll(() => detached.url(), { message: 'la misma ventana navega al 479' })
    .toContain('/479')
  await expect(detached.getByText('Add refunds table').first()).toBeVisible()
  await expect(detached.getByText('apply-coupon')).toHaveCount(0)
  const didacticWindows = minerva.context.pages().filter((p) => p.url().includes('#didactic'))
  expect(didacticWindows.length, 'una sola ventana didáctica (reutilizada)').toBe(1)

  // Reabrir el panel acoplado con cache poblado muestra el análisis directo,
  // SIN pulsar "Analizar PR".
  await window.locator('button[aria-label="Open didactic panel"]').click()
  await expect(window.getByRole('button', { name: /Re-?analyze/i })).toBeVisible()
  await expect(window.getByText('Looking for an existing analysis')).toHaveCount(0)
})

test('ventana abierta a mitad de streaming se engancha y se sincroniza con análisis posteriores', async ({
  minerva,
  window,
}) => {
  // Disparar el análisis SIN esperar (mock ~900ms) y abrir la ventana en
  // plena ventana de streaming.
  await window.evaluate((p) => {
    void window.minerva.ai.analyzePullRequest(p)
  }, PR_201)
  const detachedPromise = minerva.context.waitForEvent('page')
  await window.evaluate(
    (p) => window.minerva.window.openDidactic({ ...p, title: 'PR 201 en streaming' }),
    PR_201,
  )
  const detached = await detachedPromise
  await detached.waitForLoadState('domcontentloaded')
  expect(detached.url()).toContain(didacticPath(PR_201))

  // Contenido parcial: contenido visible MIENTRAS el estado sigue en
  // `streaming` (o cursor ▍). Carrera inherente (abrir la ventana tarda casi
  // lo que dura el mock): degradado aceptado = terminó en `cached` con
  // contenido SIN haber pasado por el placeholder. (Misma lógica legacy.)
  let sawPartial = false
  let sawPlaceholder = false
  let lastState = ''
  for (let i = 0; i < 30 && !sawPartial; i++) {
    const [text, state] = await Promise.all([
      detached.locator('body').innerText(),
      window.evaluate(
        (p) => window.minerva.ai.getAnalysisState(p).then((s: { status: string }) => s.status),
        PR_201,
      ),
    ])
    lastState = state
    const hasContent = text.length > 80 && /Summary|What changes/.test(text)
    if (text.includes('Analyze PR')) sawPlaceholder = true
    if (hasContent && (state === 'streaming' || text.includes('▍'))) sawPartial = true
    if (state === 'cached' && hasContent) break
    await detached.waitForTimeout(100)
  }
  expect(
    sawPartial || (!sawPlaceholder && lastState === 'cached'),
    'contenido parcial durante streaming (o cached sin pasar por placeholder)',
  ).toBe(true)

  // Termina mostrando el análisis completo y el estado cierra en cached.
  await expect(detached.getByRole('button', { name: /Re-?analyze/i })).toBeVisible()
  await expect
    .poll(
      () =>
        window.evaluate(
          (p) => window.minerva.ai.getAnalysisState(p).then((s: { status: string }) => s.status),
          PR_201,
        ),
      { timeout: 15_000 },
    )
    .toBe('cached')

  // T22-bis (listener permanente): la ventana YA ABIERTA (sin remount) debe
  // enterarse de un análisis relanzado DESPUÉS desde otra superficie.
  const beforeReplay = await window.evaluate(
    (p) =>
      window.minerva.ai
        .getCachedAnalysis(p)
        .then((a: { generatedAt: string } | null) => a?.generatedAt ?? null),
    PR_201,
  )
  await window.evaluate((p) => window.minerva.ai.invalidateAnalysis(p), PR_201)
  await window.evaluate((p) => {
    void window.minerva.ai.analyzePullRequest(p)
  }, PR_201)
  await expect
    .poll(
      () =>
        window.evaluate(
          (p) =>
            window.minerva.ai
              .getAnalysisState(p)
              .then((s: { status: string; analysis?: { generatedAt: string } }) =>
                s.status === 'cached' ? s.analysis?.generatedAt : null,
              ),
          PR_201,
        ),
      { message: 'el re-análisis termina con generatedAt nuevo', timeout: 15_000 },
    )
    .not.toBe(beforeReplay)
  // La desacoplada muestra el análisis nuevo sin interacción: contenido
  // completo, sin cursor ▍ ni placeholder.
  await expect(detached.getByText(/Summary|What changes/).first()).toBeVisible()
  await expect(detached.getByText('▍')).toHaveCount(0, { timeout: 10_000 })
  await expect(detached.getByText('Analyze PR')).toHaveCount(0)

  // Cerrar la didáctica explícitamente: el quit con esta ventana (creada vía
  // IPC a mitad de streaming) abierta se cuelga bajo Xvfb; cerrarla primero
  // deja el teardown por el camino rápido.
  await detached.close()
})
