import { test, expect, launchMinerva, closeMinerva, mainWindow } from './fixtures'

/**
 * Port de scripts/smoke-persistence.mjs (F9 T40): sellado headSha +
 * generatedWith y rehidratación de la cache desde disco tras REINICIAR la
 * app. La suite legacy necesitaba 4 invocaciones manuales con un reinicio a
 * mano en medio; aquí el mismo test relanza Electron sobre el MISMO userData.
 *
 * `generatedWith.provider` refleja la SELECCIÓN activa (settings), no el
 * servicio que respondió — con MINERVA_MOCK_AI=1 responde el mock pero el
 * análisis queda sellado como opencode.
 */

const PR_482 = { repo: { provider: 'github', owner: 'shopwave', name: 'api', fullName: 'shopwave/api' }, number: 482 }

// eslint-disable-next-line no-empty-pattern
test('el análisis se sella (headSha/generatedWith) y sobrevive un reinicio de la app', async ({}, testInfo) => {
  const userDataDir = testInfo.outputPath('user-data')

  // --- Sesión 1: sellar y analizar ---
  const app1 = await launchMinerva(userDataDir)
  const win1 = await mainWindow(app1)

  const providerSet = await win1.evaluate(() =>
    window.minerva.settings.setAiProvider({ provider: 'opencode' }),
  )
  expect(providerSet.provider).toBe('opencode')

  const analysis = await win1.evaluate((p) => window.minerva.ai.analyzePullRequest(p), PR_482)
  expect(Array.isArray(analysis.sections)).toBe(true)
  expect(analysis.headSha, 'headSha sellado con el del PR mock').toMatch(/^a482f001/)
  expect(analysis.generatedWith?.provider, 'sellado con la selección activa').toBe('opencode')
  expect(typeof analysis.generatedWith?.model).toBe('string')
  expect(analysis.generatedWith.model.length).toBeGreaterThan(0)

  const state1 = await win1.evaluate(
    (p) => window.minerva.ai.getAnalysisState(p).then((s: { status: string }) => s.status),
    PR_482,
  )
  expect(state1).toBe('cached')

  await closeMinerva(app1)

  // --- Sesión 2: mismo userData, SIN analizar — hidrata de disco ---
  const app2 = await launchMinerva(userDataDir)
  try {
    const win2 = await mainWindow(app2)
    const state2 = await win2.evaluate(
      (p) => window.minerva.ai.getAnalysisState(p),
      PR_482,
    )
    expect(state2.status, 'cached tras reinicio (hidratado de disco)').toBe('cached')
    expect(state2.analysis.headSha, 'headSha persistido').toMatch(/^a482f001/)
    expect(state2.analysis.generatedWith?.provider, 'generatedWith persistido').toBe('opencode')
  } finally {
    await closeMinerva(app2)
  }
})
