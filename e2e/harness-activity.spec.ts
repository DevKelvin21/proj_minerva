import { test, expect, attachScreenshot, openAnalysisTab } from './fixtures'

/**
 * Port de scripts/smoke-harness-activity.mjs (F13): el mini-log de actividad
 * del harness. Se suscribe a onAnalysisProgress, dispara un análisis (mock,
 * determinista) y verifica que los eventos traen el buffer `activity`
 * (running→done colapsando por id, labels en español derivados en main), que
 * el evento TERMINAL no lo trae, que `ai:getAnalysisState` lo expone a mitad
 * de vuelo (late-attach) y que la UI lo PINTA (no solo que viaja por el wire).
 *
 * Con userData limpio no hace falta invalidar cache: el primer análisis
 * siempre streamea de verdad.
 */

interface ActivityItem {
  id: string
  status: string
  label: string
}

test('los eventos de progreso llevan el buffer activity y la UI lo pinta', async ({
  window,
}, testInfo) => {
  // El PR bajo prueba tiene que estar SELECCIONADO para que el panel lo pinte
  // (el análisis se dispara por IPC directo, no con el botón).
  await window.getByText('Add POST /carts/:id/apply-coupon').first().click()
  await openAnalysisTab(window)

  const result = await window.evaluate(async () => {
    const repo = { provider: 'github', owner: 'shopwave', name: 'api', fullName: 'shopwave/api' }
    const events: {
      done: boolean
      phase: string | null
      nSections: number
      activity: { id: string; status: string; label: string }[] | null
    }[] = []
    const unsub = window.minerva.events.onAnalysisProgress(
      (ev: {
        number: number
        done: boolean
        phase?: string
        sections: unknown[]
        activity?: { id: string; status: string; label: string }[]
      }) => {
        if (ev.number !== 482) return
        events.push({
          done: ev.done,
          phase: ev.phase ?? null,
          nSections: ev.sections.length,
          activity: ev.activity ?? null,
        })
      },
    )

    const analysisPromise = window.minerva.ai.analyzePullRequest({ repo, number: 482 })

    // Muestrear a mitad de vuelo: estado in-flight (late-attach) + UI.
    let midState: { status: string; activity: unknown[] } | null = null
    const uiSamples: { hasLabel: boolean; hasSection: boolean }[] = []
    for (let i = 0; i < 14; i++) {
      await new Promise((r) => setTimeout(r, 120))
      const state = await window.minerva.ai.getAnalysisState({ repo, number: 482 })
      if (state.status === 'streaming' && (state.activity?.length ?? 0) > 0 && !midState) {
        midState = { status: state.status, activity: state.activity }
      }
      const panel = document.body.innerText
      uiSamples.push({
        hasLabel: /Read src\/api\/routes\.ts|Searched "router"|Listed the structure|Thinking…/.test(
          panel,
        ),
        hasSection: panel.includes('Summary'),
      })
    }

    let error: string | null = null
    try {
      await analysisPromise
    } catch (e) {
      error = (e as Error).message
    }
    unsub()

    // Colapso por identidad: un id que aparece primero running y después done
    // en eventos DISTINTOS, sin duplicarse dentro de un mismo buffer.
    let collapsed = false
    let duplicated = false
    const runningSeen = new Set<string>()
    for (const ev of events) {
      for (const item of ev.activity ?? []) {
        const ids = (ev.activity ?? []).filter((x) => x.id === item.id)
        if (ids.length > 1) duplicated = true
        if (item.status === 'running') runningSeen.add(item.id)
        if (item.status === 'done' && runningSeen.has(item.id)) collapsed = true
      }
    }

    const nonTerminal = events.filter((e) => !e.done)
    const terminal = events[events.length - 1] ?? null
    const allLabels = nonTerminal.flatMap((e) => (e.activity ?? []).map((i) => i.label))

    return {
      error,
      nEvents: events.length,
      withActivity: nonTerminal.filter((e) => (e.activity?.length ?? 0) > 0).length,
      exploringWithActivity: nonTerminal.some(
        (e) => e.phase === 'exploring' && (e.activity?.length ?? 0) > 0,
      ),
      writingWithActivity: nonTerminal.some(
        (e) => e.phase === 'writing' && (e.activity?.length ?? 0) > 0 && e.nSections > 0,
      ),
      collapsed,
      duplicated,
      labelSample: allLabels.slice(0, 8),
      hasSpanishLabel: allLabels.some((l) => /Read |Searched|Listed|Thinking/.test(l)),
      terminalHasActivity: terminal ? terminal.activity !== null : null,
      terminalDone: terminal?.done ?? null,
      midState,
      uiSawLabel: uiSamples.some((s) => s.hasLabel),
      uiSawLabelWithSection: uiSamples.some((s) => s.hasLabel && s.hasSection),
    }
  })

  expect(result.error, 'análisis terminó sin error').toBeNull()
  expect(result.withActivity, 'eventos no-terminales traen activity').toBeGreaterThanOrEqual(1)
  expect(result.exploringWithActivity, 'hay activity durante la fase exploring').toBe(true)
  expect(
    result.writingWithActivity,
    'hay activity durante la fase writing (con secciones ya streameando)',
  ).toBe(true)
  expect(result.collapsed, 'colapso por identidad: un id pasa de running a done').toBe(true)
  expect(result.duplicated, 'ningún buffer trae un id duplicado').toBe(false)
  expect(
    result.hasSpanishLabel,
    'labels derived in main: ' + JSON.stringify(result.labelSample),
  ).toBe(true)
  expect(result.terminalDone, 'hubo evento terminal').toBe(true)
  expect(result.terminalHasActivity, 'el evento TERMINAL no trae activity (efímero)').toBe(false)
  expect(result.midState?.status, 'getAnalysisState expone activity a mitad de vuelo').toBe(
    'streaming',
  )
  expect(((result.midState?.activity as ActivityItem[]) ?? []).length).toBeGreaterThan(0)
  expect(result.uiSawLabel, 'la UI pinta un label del mini-log durante el análisis').toBe(true)
  expect(
    result.uiSawLabelWithSection,
    'la franja de actividad convive con secciones ya pintadas (fase writing)',
  ).toBe(true)

  await attachScreenshot(window, testInfo, 'harness-activity-final')
})
