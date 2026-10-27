import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect, launchMinerva, closeMinerva, mainWindow, attachScreenshot } from './fixtures'
import type { Page } from './fixtures'

/**
 * Port de scripts/smoke-settings.mjs (T61/T62, mundo post-T59 de 3
 * proveedores). Diferencias con la suite legacy:
 * - userData aislado ⇒ el settings.json bajo prueba es el del test (se lee
 *   directo de disco desde Node) y NO hay ritual de snapshot/restauración.
 * - El paso de "modelo inválido" necesita OpenCode REAL autenticado (con
 *   MINERVA_MOCK_AI el análisis resolvería OK): test aparte que lanza sin el
 *   flag y se auto-skipea si no hay sesión — mismo gate que la legacy.
 */

const PROVIDERS = ['claude-code', 'codex', 'opencode']
const CUSTOM_OPENCODE_SLUG = 'openrouter/z-ai/glm-5.2'

const settingsOnDisk = (userDataDir: string) =>
  JSON.parse(readFileSync(join(userDataDir, 'settings.json'), 'utf-8')) as {
    aiProvider?: string
    models?: Record<string, string>
  }

const openSettingsModal = async (page: Page) => {
  await page.locator('button:has(svg.lucide-settings), button:has([class*="lucide-settings"])').first().click()
}

test('contrato IPC: 3 proveedores, persistencia y slug libre de opencode', async ({
  window,
}, testInfo) => {
  const userDataDir = testInfo.outputPath('user-data')
  const snapshot = await window.evaluate(() => window.minerva.settings.get())

  // (a) Forma de 3 proveedores: selección efectiva + catálogo EXACTO
  // claude-code/codex/opencode, sin `openrouter` como clave.
  const catalogKeys = Object.keys(snapshot.catalog ?? {}).sort()
  expect(PROVIDERS).toContain(snapshot.provider)
  expect(typeof snapshot.model).toBe('string')
  expect(snapshot.model.length).toBeGreaterThan(0)
  expect(['settings', 'env', 'default']).toContain(snapshot.modelSource)
  expect(catalogKeys, 'catálogo con exactamente los 3 proveedores').toEqual(
    [...PROVIDERS].sort(),
  )
  for (const p of PROVIDERS) {
    expect(Array.isArray(snapshot.catalog[p].models), `catálogo de ${p} con models[]`).toBe(true)
  }

  // (b) El catálogo de opencode incluye el fallback opencode/big-pickle (T57).
  const opencodeIds = snapshot.catalog.opencode.models.map((m: { id: string }) => m.id)
  expect(opencodeIds, 'fallback big-pickle presente').toContain('opencode/big-pickle')

  // (c) setAiProvider cambia y persiste el proveedor activo entre los 3.
  for (const provider of PROVIDERS) {
    const swapped = await window.evaluate(
      (p) => window.minerva.settings.setAiProvider({ provider: p }),
      provider,
    )
    expect(swapped.provider, `selección efectiva = ${provider}`).toBe(provider)
    expect(settingsOnDisk(userDataDir).aiProvider, `persistido en disco = ${provider}`).toBe(
      provider,
    )
  }

  // (d) setProviderModel acepta un slug libre para opencode (campo "Otro
  // (avanzado)", único proveedor con id libre tras T59) y lo refleja+persiste.
  await window.evaluate(() => window.minerva.settings.setAiProvider({ provider: 'opencode' }))
  const withCustomModel = await window.evaluate(
    (model) => window.minerva.settings.setProviderModel({ provider: 'opencode', model }),
    CUSTOM_OPENCODE_SLUG,
  )
  expect(withCustomModel.model).toBe(CUSTOM_OPENCODE_SLUG)
  expect(withCustomModel.modelSource).toBe('settings')
  expect(withCustomModel.perProviderModel?.opencode).toBe(CUSTOM_OPENCODE_SLUG)
  expect(
    settingsOnDisk(userDataDir).models?.opencode,
    'slug libre persistido en settings.json',
  ).toBe(CUSTOM_OPENCODE_SLUG)
})

test('modal F12: strip "En uso", tabs de proveedor y activación por card', async ({
  window,
}, testInfo) => {
  // userData virgen ⇒ el proveedor activo es el default (opencode); nada que
  // resincronizar: este test opera SOLO vía UI.
  const snapshot = await window.evaluate(() => window.minerva.settings.get())
  // El modelo objetivo sale del MISMO canal que puebla el picker
  // (`ai:getProviderModels`), no de `snapshot.catalog`: desde F19 Claude Code
  // tiene catálogo dinámico, así que en una máquina con `claude` instalado las
  // cards son las que reporta el CLI y no las curadas. Con el CLI ausente (CI)
  // el canal degrada al catálogo curado, y este test sigue siendo determinista
  // en los dos casos.
  const targetModel: string = await window.evaluate(() =>
    window.minerva.ai
      .getProviderModels({ provider: 'claude-code' })
      .then((models: { id: string }[]) => models[0].id),
  )

  await openSettingsModal(window)

  // Strip "En uso" (uppercase vía CSS ⇒ case-insensitive) y 3 proveedores.
  await expect(window.getByText(/in use/i).first()).toBeVisible()
  await expect(window.getByText('OpenCode').first()).toBeVisible()
  await expect(window.getByText('Claude Code').first()).toBeVisible()
  await expect(window.getByText('Codex').first()).toBeVisible()
  await expect(window.getByText('OpenRouter')).toHaveCount(0)

  await expect(window.locator('[role="tab"]'), '3 tabs de proveedor').toHaveCount(3)

  // Cambiar de tab es SOLO ver: el proveedor activo no se toca.
  await window.locator('[role="tab"]', { hasText: 'Claude Code' }).click()
  const afterTabView = await window.evaluate(() => window.minerva.settings.get())
  expect(afterTabView.provider, 'proveedor activo intacto tras cambiar de tab').toBe(
    snapshot.provider,
  )

  // Click en una card de modelo del tab visto = ACTIVAR proveedor+modelo
  // juntos (contrato T62, sin radios ni botón Guardar).
  await window
    .locator('[role="tabpanel"] button', { hasText: targetModel })
    .first()
    .click()
  await expect
    .poll(
      () =>
        window.evaluate(() =>
          window.minerva.settings.get().then((s: { provider: string; model: string }) => s.provider + '/' + s.model),
        ),
      { message: 'la card activa proveedor+modelo' },
    )
    .toBe('claude-code/' + targetModel)

  // El strip "En uso" y el badge "Activo" reflejan la activación.
  await expect(window.getByText(targetModel).first()).toBeVisible()
  await expect(window.getByText('Active').first()).toBeVisible()

  await attachScreenshot(window, testInfo, 'settings-modal-activacion')
})

// eslint-disable-next-line no-empty-pattern
test('modelo opencode inexistente rechaza el análisis con error accionable', async ({}, testInfo) => {
  // IA REAL: se lanza SIN MINERVA_MOCK_AI. Solo corre con opencode
  // autenticado (sesión del CLI); si no, skip — en CI siempre se skipea.
  const app = await launchMinerva(testInfo.outputPath('user-data'), {
    env: { MINERVA_MOCK_AI: undefined },
  })
  try {
    const window = await mainWindow(app)
    const status = await window.evaluate(() => window.minerva.ai.getProviderStatus())
    test.skip(
      status?.opencode?.status !== 'authenticated',
      'opencode no está authenticated — correr con sesión real de opencode para cubrir este paso',
    )

    await window.evaluate(() =>
      window.minerva.settings.setAiProvider({ provider: 'opencode' }),
    )
    await window.evaluate(() =>
      window.minerva.settings.setProviderModel({
        provider: 'opencode',
        model: 'opencode/proj-minerva-invalid-model-e2e',
      }),
    )
    const err = await window.evaluate(() =>
      window.minerva.ai
        .analyzePullRequest({
          repo: { provider: 'github', owner: 'shopwave', name: 'api', fullName: 'shopwave/api' },
          number: 482,
        })
        .then(
          () => 'INESPERADO_OK',
          (e: Error) => e.message,
        ),
    )
    expect(err, 'el análisis rechaza (no resuelve OK)').not.toBe('INESPERADO_OK')
    expect(typeof err).toBe('string')
    expect((err as string).trim().length, 'mensaje de error no vacío').toBeGreaterThan(0)
  } finally {
    await closeMinerva(app)
  }
})
