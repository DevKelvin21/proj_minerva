import { test, expect } from './fixtures'

/**
 * Port de scripts/smoke-streaming.mjs (T13): suscripción a onAnalysisProgress
 * + análisis del #482 → deben llegar eventos progresivos ANTES del resultado
 * final (streaming real, no batch). Con userData virgen no hace falta
 * invalidar cache (la trampa del cache-hit sin eventos de la suite legacy).
 */

const PR_482 = { repo: { provider: 'github', owner: 'shopwave', name: 'api', fullName: 'shopwave/api' }, number: 482 }

test('el análisis streamea eventos progresivos hasta done:true', async ({ window }) => {
  const result = await window.evaluate(async (pr) => {
    const events: { t: number; done: boolean; mdLen: number }[] = []
    const t0 = Date.now()
    const unsub = window.minerva.events.onAnalysisProgress(
      (ev: { done: boolean; sections: { markdown?: string }[] }) => {
        events.push({
          t: Date.now() - t0,
          done: ev.done,
          mdLen: ev.sections.reduce((a, s) => a + (s.markdown?.length ?? 0), 0),
        })
      },
    )
    const final = await window.minerva.ai.analyzePullRequest(pr)
    unsub()
    return {
      finalKinds: final.sections.map((s: { kind: string }) => s.kind),
      totalMs: Date.now() - t0,
      firstEventMs: events[0]?.t ?? null,
      nEvents: events.length,
      progressive: events.some((e, i) => i > 0 && e.mdLen > events[i - 1].mdLen),
      lastDone: events.length > 0 ? events[events.length - 1].done : null,
    }
  }, PR_482)

  expect(result.nEvents, 'llegaron ≥2 eventos de progreso').toBeGreaterThanOrEqual(2)
  expect(result.progressive, 'el contenido crece progresivamente').toBe(true)
  expect(result.lastDone, 'último evento con done:true').toBe(true)
  expect(result.firstEventMs, 'primer evento antes que el final (streaming, no batch)').toBeLessThan(
    result.totalMs * 0.8,
  )
  expect(result.finalKinds, 'resultado final con sección summary').toContain('summary')
})
