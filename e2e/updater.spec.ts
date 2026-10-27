import { test, expect, launchMinerva, closeMinerva, mainWindow, setViewport, attachScreenshot } from './fixtures'
import type { Page } from './fixtures'

/**
 * F17/T94 — auto-updater. `MINERVA_MOCK_UPDATER` (`main/updater/mock-updater.ts`)
 * es LA vía para ejercitar la UI en e2e: la suite corre sin empaquetar, así que
 * ahí el updater real queda `disabled` por diseño (`resolveUpdaterCapability`,
 * `main/updater/capability.ts`) y `UpdateSection` no monta nada en ese estado.
 * `e2e/fixtures.ts` fija `MINERVA_UPDATER: 'off'` como default para TODO el
 * resto de la suite; estos tests lo pisan con `MINERVA_MOCK_UPDATER`, que en
 * `initUpdater()` (`main/updater/updater.ts`) se resuelve ANTES que ese kill
 * switch, así que no hay conflicto.
 *
 * Selectores aprendidos verificando a mano (no repetirlos mal):
 * - El chip de Settings se localiza por `getByRole('button', { name: /^Settings/ })`
 *   — el último `header button` es "Panel didáctico", no Settings.
 * - El heading de la sección es `getByRole('heading', { name: 'Updates' })`:
 *   `getByText('Updates')` viola el modo estricto (matchea también el
 *   botón "Buscar actualizaciones").
 * - NUNCA afirmar un número de versión concreto: sin empaquetar,
 *   `app.getVersion()` es la versión de Electron, no la de Minerva.
 */

async function openSettings(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Settings/ }).click()
  await expect(page.locator('[role="dialog"]')).toBeVisible()
}

const updateBadge = (page: Page) => page.locator('span[title="An update is available"]')

// eslint-disable-next-line no-empty-pattern
test('camino feliz (MINERVA_MOCK_UPDATER=1): checkear, descargar e instalar al salir', async ({}, testInfo) => {
  const app = await launchMinerva(testInfo.outputPath('user-data'), {
    env: { MINERVA_MOCK_UPDATER: '1' },
  })
  try {
    const window = await mainWindow(app)
    await openSettings(window)

    // La sección existe y muestra la versión instalada (patrón, nunca el
    // literal — ver gotcha de arriba).
    await expect(window.getByRole('heading', { name: 'Updates' })).toBeVisible()
    await expect(window.getByText(/Installed version/).first()).toBeVisible()
    const versionText = await window
      .locator('p', { hasText: 'Installed version' })
      .locator('span')
      .innerText()
    expect(versionText.trim(), 'la versión instalada tiene forma semver').toMatch(/^\d+\.\d+\.\d+/)

    // Sin badge todavía: recién arrancó, el estado inicial es `idle`.
    await expect(updateBadge(window)).toHaveCount(0)

    await window.getByRole('button', { name: 'Check for updates' }).click()

    const availableText = window.getByText(/^Available v\d+\.\d+\.\d+$/)
    await expect(availableText).toBeVisible()
    await attachScreenshot(window, testInfo, 'updater-available')

    // Badge en el chip de Configuración: presente apenas hay una versión
    // disponible (T93), aunque el modal de Settings esté por encima.
    await expect(updateBadge(window)).toBeVisible()

    await window.getByRole('button', { name: /^Download/ }).click()

    // Progreso visible (el guion mock dura <1s a propósito, ver
    // `mock-updater.ts`): al menos un frame de "Descargando v…" con un
    // porcentaje, antes de llegar a `downloaded`.
    await expect(window.getByText(/^Downloading v\d+\.\d+\.\d+…$/)).toBeVisible()
    // Scoped to the progress line: Appearance shows a contrast percentage too.
    await expect(window.locator('p').filter({ hasText: /^\d+%$/ })).toBeVisible()
    await attachScreenshot(window, testInfo, 'updater-downloading')

    await expect(window.getByText('It will be installed when you quit Minerva.')).toBeVisible()
    await attachScreenshot(window, testInfo, 'updater-downloaded')

    // "Reiniciar ahora" existe pero es la acción SECUNDARIA (link-button
    // subordinado, no un CTA) — el camino principal es seguir usando Minerva.
    const restartButton = window.getByRole('button', { name: 'Restart now' })
    await expect(restartButton).toBeVisible()
    await expect(restartButton).toHaveClass(/underline/)

    // El badge sigue presente en `downloaded`.
    await expect(updateBadge(window)).toBeVisible()
  } finally {
    await closeMinerva(app)
  }
})

// eslint-disable-next-line no-empty-pattern
test('notify (MINERVA_MOCK_UPDATER=notify): nunca ofrece descargar', async ({}, testInfo) => {
  const app = await launchMinerva(testInfo.outputPath('user-data'), {
    env: { MINERVA_MOCK_UPDATER: 'notify' },
  })
  try {
    const window = await mainWindow(app)
    await openSettings(window)

    await expect(window.getByRole('heading', { name: 'Updates' })).toBeVisible()

    // El estado inicial de `notify` ya explica por qué no puede actualizarse
    // sola, pero todavía no consultó el feed: "Ver la release" aparece recién
    // cuando el chequeo encuentra una versión más nueva. El chequeo manual
    // existe TAMBIÉN en este estado (si no, habría que esperar al scheduler).
    await expect(window.getByText(/cannot update itself/)).toBeVisible()
    await expect(window.getByRole('button', { name: 'View the release' })).toHaveCount(0)

    await window.getByRole('button', { name: 'Check for updates' }).click()
    await expect(window.getByRole('button', { name: 'View the release' })).toBeVisible()

    // Aserción de seguridad de producto: esta instalación JAMÁS debe ofrecer
    // un botón de descarga, sin importar qué encuentre el feed.
    await expect(window.getByRole('button', { name: /^Download/ })).toHaveCount(0)

    await expect(window.getByRole('button', { name: 'View the release' })).toBeVisible()
    await attachScreenshot(window, testInfo, 'updater-notify')
  } finally {
    await closeMinerva(app)
  }
})

// eslint-disable-next-line no-empty-pattern
test('error (MINERVA_MOCK_UPDATER=error): el volcado crudo de electron-updater llega como UNA línea corta', async ({}, testInfo) => {
  const app = await launchMinerva(testInfo.outputPath('user-data'), {
    env: { MINERVA_MOCK_UPDATER: 'error' },
  })
  try {
    const window = await mainWindow(app)
    await openSettings(window)

    await expect(window.getByRole('heading', { name: 'Updates' })).toBeVisible()
    await window.getByRole('button', { name: 'Check for updates' }).click()

    // El guion `error` arranca del MISMO HttpError que mostró v0.8.1 en macOS
    // (status + headers + stack, `MOCK_RAW_FEED_ERROR` en `mock-updater.ts`)
    // y lo pasa por `updaterErrorMessage` — así se afirma sobre el texto real.
    const message = window.getByText(/has no update manifest for this platform \(latest-mac\.yml\)/)
    await expect(message).toBeVisible()
    const text = await message.innerText()
    expect(text, 'sin headers HTTP').not.toContain('Headers')
    expect(text, 'sin stack trace').not.toMatch(/\bat \w+ \(/)
    expect(text, 'sin saltos de línea').not.toContain('\n')
    expect(text, 'sin el consejo sobre tokens de electron-updater').not.toContain('authentication token')

    // En error el botón pasa a "Reintentar" y nunca hay descarga ni badge.
    await expect(window.getByRole('button', { name: 'Retry' })).toBeVisible()
    await expect(window.getByRole('button', { name: /^Download/ })).toHaveCount(0)
    await expect(updateBadge(window)).toHaveCount(0)
    // El mensaje ocupa 3 líneas y el botón va centrado a su lado: scrollear
    // el botón deja la última línea fuera de vista; scrollear el párrafo no.
    await message.scrollIntoViewIfNeeded()
    await attachScreenshot(window, testInfo, 'updater-error')
  } finally {
    await closeMinerva(app)
  }
})

// eslint-disable-next-line no-empty-pattern
test('ventana tileada (960x540): la sección de Actualizaciones se alcanza por scroll', async ({}, testInfo) => {
  const app = await launchMinerva(testInfo.outputPath('user-data'), {
    env: { MINERVA_MOCK_UPDATER: '1' },
  })
  try {
    const window = await mainWindow(app)
    await setViewport(window, 960, 540)
    await openSettings(window)

    const heading = window.getByRole('heading', { name: 'Updates' })
    // Aserción clave (lección de F16): si un ancestro clipea la sección sin
    // scroller, este paso falla — que es exactamente la regresión a cazar.
    await heading.scrollIntoViewIfNeeded()
    await expect(heading).toBeVisible()

    await attachScreenshot(window, testInfo, 'updater-responsive-960x540')
  } finally {
    await closeMinerva(app)
  }
})
