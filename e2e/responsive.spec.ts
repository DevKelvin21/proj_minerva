import { test, expect, setViewport, attachScreenshot } from './fixtures'
import type { Page } from './fixtures'

/**
 * F16/T88 — layout responsivo con la ventana tileada. Los tamaños son los del
 * mapa de `docs/archive/PLAN.md` § F16: una ventana completa, las dos mitades y un
 * cuarto de un monitor 1080p, que es como se usa la app en un WM de tiling.
 *
 * Lo que sella este spec (todo esto FALLABA antes de F16):
 * - el panel de diff nunca queda por debajo de 400px (medido: 40px a 960x540,
 *   porque sidebar 280 + árbol 260 + didáctico 380 eran `shrink-0`);
 * - el documento nunca desborda horizontalmente;
 * - en Settings TODO el contenido es alcanzable por scroll (antes las tabs y la
 *   lista de modelos quedaban recortadas SIN scroll que llegara a ellas: el
 *   único `overflow-y-auto` envolvía solo al panel de modelos).
 *
 * `scrollIntoViewIfNeeded()` es la aserción clave del caso Settings: si el
 * elemento está clipeado por un ancestro `overflow-hidden` sin scroller, no hay
 * forma de llevarlo a la vista y el paso falla — que es exactamente el bug.
 */

const VIEWPORTS = [
  { name: 'ventana completa 1080p', w: 1920, h: 1080 },
  { name: 'mitad vertical', w: 960, h: 1080 },
  { name: 'mitad horizontal', w: 1920, h: 540 },
  { name: 'un cuarto', w: 960, h: 540 },
]

/**
 * Panel de diff: la `section` MÁS INTERNA que contiene los toggles de vista de
 * la toolbar (`.last()` — el `CenterPane` es otra `section` que también los
 * contiene por herencia y rompería el modo estricto de Playwright).
 */
const diffPane = (page: Page) => page.locator('section:has([aria-label="Vista inline"])').last()

test('el shell sobrevive a los 4 tilings: diff usable y sin desborde horizontal', async ({
  window,
}, testInfo) => {
  await window.getByText('apply-coupon').first().click()
  await window.getByText('Archivos').first().click()
  await expect(window.getByText('@@').first()).toBeVisible()

  for (const viewport of VIEWPORTS) {
    await setViewport(window, viewport.w, viewport.h)

    // El árbol de archivos puede haberse vuelto drawer (botón "N archivos" en
    // la toolbar); el diff, en cambio, existe siempre.
    //
    // `expect.poll` y NO una medición única: el colapso del árbol lo dispara el
    // `ResizeObserver` de `useElementWidth`, que es ASÍNCRONO respecto del
    // cambio de viewport. Medir el `boundingBox()` justo después de
    // `setViewport` puede capturar el layout de ANTES del colapso — al pasar de
    // 1920x540 a 960x540 eso da exactamente 580-260=320px (el árbol todavía
    // como columna) y el test falla por una foto sacada demasiado pronto, no
    // por un layout roto. Reproducido en CI (run 30171070743); en local no
    // aparece ni con la máquina saturada, porque ahí el observer llega antes.
    // El umbral NO se afloja: sigue exigiendo >400, solo se le da tiempo a que
    // el layout se asiente.
    await expect
      .poll(
        async () => {
          const box = await diffPane(window).boundingBox()
          return box === null ? -1 : Math.round(box.width)
        },
        { message: `diff usable en ${viewport.name} (${viewport.w}x${viewport.h})` },
      )
      .toBeGreaterThan(400)

    const overflow = await window.evaluate(() => ({
      scrollWidth: document.body.scrollWidth,
      innerWidth: window.innerWidth,
    }))
    expect(
      overflow.scrollWidth,
      `sin scroll horizontal del documento en ${viewport.name}`,
    ).toBeLessThanOrEqual(overflow.innerWidth)

    // El contenido del diff sigue siendo contenido, no un panel vacío.
    await expect(window.getByText('@@').first()).toBeVisible()

    await attachScreenshot(window, testInfo, `shell-${viewport.w}x${viewport.h}`)
  }
})

test('con la ventana angosta la lista de PRs pasa a drawer y se abre desde el TitleBar', async ({
  window,
}, testInfo) => {
  const prTitle = 'Add refunds table and migration'

  // A 1920 la lista es una columna acoplada: se ve sin tocar nada.
  await setViewport(window, 1920, 1080)
  await expect(window.getByText(prTitle).first()).toBeVisible()
  await expect(window.getByRole('button', { name: 'Lista de PRs' })).toHaveCount(0)

  // A 960 (mitad de un monitor 1080p) la columna cede el ancho al centro y la
  // lista pasa a drawer: deja de estar en el DOM hasta que se la pide.
  await setViewport(window, 960, 1080)
  const toggle = window.getByRole('button', { name: 'Lista de PRs' })
  await expect(toggle).toBeVisible()
  await expect(window.getByText(prTitle)).toHaveCount(0)

  await toggle.click()
  await expect(window.getByText(prTitle).first()).toBeVisible()
  await attachScreenshot(window, testInfo, 'drawer-lista-abierto')

  // Elegir un PR cierra el drawer (gesto de un solo click).
  await window.getByText(prTitle).first().click()
  await expect(window.getByText(prTitle)).toHaveCount(0)
})

test('Settings: todo el contenido es alcanzable con la ventana tileada', async ({
  window,
}, testInfo) => {
  for (const viewport of [
    { name: 'un cuarto', w: 960, h: 540 },
    { name: 'mitad horizontal', w: 1920, h: 540 },
  ]) {
    await setViewport(window, viewport.w, viewport.h)
    await window
      .locator('button:has(svg.lucide-settings), button:has([class*="lucide-settings"])')
      .first()
      .click()

    const dialog = window.locator('[role="dialog"]')
    await expect(dialog).toBeVisible()

    // El diálogo entra en la ventana (nada del modal cae fuera del viewport).
    const box = await dialog.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.y, `modal dentro del viewport en ${viewport.name}`).toBeGreaterThanOrEqual(0)
    expect(Math.round(box!.y + box!.height)).toBeLessThanOrEqual(viewport.h)

    // Sección de GitHub: visible apenas se abre, sin desplegar nada.
    await expect(window.getByText('Acceso a GitHub').first()).toBeVisible()

    // Y el otro extremo del modal (tabs + lista de modelos + campo "Otro") se
    // alcanza scrolleando. Antes de F16 esto era IMPOSIBLE a 540px de alto.
    const tab = window.locator('[role="tab"]', { hasText: 'Codex' })
    await tab.scrollIntoViewIfNeeded()
    await expect(tab).toBeVisible()
    await tab.click()

    // With a real CLI session on the machine (Codex/Claude installed and logged in) the
    // dynamic model catalog arrives mid-test and swaps the list, detaching the first
    // card while Playwright waits for it to be stable; retry until the list settles.
    const firstModelCard = window.locator('[role="tabpanel"] button').first()
    await expect(async () => {
      await firstModelCard.scrollIntoViewIfNeeded({ timeout: 2_000 })
    }).toPass({ timeout: 15_000 })
    await expect(firstModelCard).toBeVisible()

    await attachScreenshot(window, testInfo, `settings-${viewport.w}x${viewport.h}`)
    await window.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
  }
})
