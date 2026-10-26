import { test, expect } from './fixtures'

/**
 * Port de los checks 1–3, 9 y 10a de scripts/smoke-detach.mjs: cache LRU de
 * análisis en main, dedupe de llamadas in-flight y getAnalysisState durante
 * un streaming. Todo vía window.minerva (IPC), sin UI.
 */

const PR_482 = { repo: { provider: 'github', owner: 'shopwave', name: 'api', fullName: 'shopwave/api' }, number: 482 }
const PR_201 = { repo: { provider: 'github', owner: 'shopwave', name: 'web', fullName: 'shopwave/web' }, number: 201 }

test('primer análisis streamea; el segundo es cache hit instantáneo sin eventos', async ({
  window,
}) => {
  const run = (pr: typeof PR_482) =>
    window.evaluate(async (p) => {
      let events = 0
      const unsub = window.minerva.events.onAnalysisProgress(() => {
        events++
      })
      const t0 = Date.now()
      await window.minerva.ai.analyzePullRequest(p)
      unsub()
      return { ms: Date.now() - t0, events }
    }, pr)

  const first = await run(PR_482)
  expect(first.events, 'primer análisis streamea (eventos > 0)').toBeGreaterThan(0)

  const second = await run(PR_482)
  expect(second.ms, 'cache hit instantáneo (<300ms)').toBeLessThan(300)
  expect(second.events, 'cache hit sin eventos de streaming').toBe(0)

  const cachedKinds = await window.evaluate(
    (p) => window.minerva.ai.getCachedAnalysis(p).then((a: { sections: { kind: string }[] } | null) => a?.sections.map((s) => s.kind) ?? null),
    PR_482,
  )
  expect(cachedKinds, 'getCachedAnalysis devuelve secciones').not.toBeNull()
  expect(cachedKinds!.length).toBeGreaterThan(0)
})

test('dedupe in-flight: dos analyzePullRequest concurrentes resuelven el MISMO análisis', async ({
  window,
}) => {
  const dedupe = await window.evaluate(async (p) => {
    const [a, b] = await Promise.all([
      window.minerva.ai.analyzePullRequest(p),
      window.minerva.ai.analyzePullRequest(p),
    ])
    return {
      sameGeneratedAt: a.generatedAt === b.generatedAt,
      sameKinds:
        JSON.stringify(a.sections.map((s: { kind: string }) => s.kind)) ===
        JSON.stringify(b.sections.map((s: { kind: string }) => s.kind)),
    }
  }, PR_201)
  expect(dedupe.sameGeneratedAt, 'mismo generatedAt (cero llamadas extra al mock/LLM)').toBe(true)
  expect(dedupe.sameKinds).toBe(true)
})

test('getAnalysisState reporta streaming a mitad de un análisis y cached al final', async ({
  window,
}) => {
  // Disparar sin esperar (el mock tarda ~900ms) y mirar el estado a mitad.
  await window.evaluate((p) => {
    void window.minerva.ai.analyzePullRequest(p)
  }, PR_482)
  const midState = await window.evaluate(
    (p) => window.minerva.ai.getAnalysisState(p).then((s: { status: string }) => s.status),
    PR_482,
  )
  expect(midState, 'estado streaming a mitad del análisis').toBe('streaming')

  await expect
    .poll(
      () =>
        window.evaluate(
          (p) => window.minerva.ai.getAnalysisState(p).then((s: { status: string }) => s.status),
          PR_482,
        ),
      { message: 'el estado termina en cached (sin quedar colgado)', timeout: 15_000 },
    )
    .toBe('cached')
})
