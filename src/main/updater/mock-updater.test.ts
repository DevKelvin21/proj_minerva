import { describe, expect, it } from 'vitest'
import { createMockUpdaterEngine, nextMinorVersion, parseMockUpdaterMode } from './mock-updater'
import type { UpdaterStatus } from '../../shared/types'

/** Corre el motor y devuelve la secuencia de `phase` emitida por `setStatus`, en orden. */
function collectPhases(statuses: UpdaterStatus[]): string[] {
  return statuses.map((s) => s.phase)
}

describe('parseMockUpdaterMode', () => {
  it('"notify" y "error" seleccionan esos guiones; cualquier otro valor (incluido "1") cae al camino feliz', () => {
    expect(parseMockUpdaterMode('notify')).toBe('notify')
    expect(parseMockUpdaterMode('error')).toBe('error')
    expect(parseMockUpdaterMode('1')).toBe('happy')
    expect(parseMockUpdaterMode('cualquier-otra-cosa')).toBe('happy')
  })
})

describe('nextMinorVersion', () => {
  it('sube el minor en uno y resetea el patch a 0', () => {
    expect(nextMinorVersion('0.6.3')).toBe('0.7.0')
    expect(nextMinorVersion('1.9.12')).toBe('1.10.0')
  })
})

describe('createMockUpdaterEngine', () => {
  it('guion feliz (mode="happy"): checking -> available -> (download) downloading x4 -> downloaded, en <=2s', async () => {
    const engine = createMockUpdaterEngine('happy', '0.6.3')
    const statuses: UpdaterStatus[] = []
    const setStatus = (s: UpdaterStatus): void => {
      statuses.push(s)
    }

    const start = Date.now()
    engine.init(setStatus)
    await engine.checkNow(setStatus)
    await engine.download(setStatus, statuses[statuses.length - 1])
    const elapsedMs = Date.now() - start

    expect(collectPhases(statuses)).toEqual([
      'idle',
      'checking',
      'available',
      'downloading',
      'downloading',
      'downloading',
      'downloading',
      'downloaded',
    ])
    expect(elapsedMs).toBeLessThanOrEqual(2000)

    const available = statuses.find((s) => s.phase === 'available')
    expect(available?.phase === 'available' && available.info.version).toBe('0.7.0')
    expect(available?.phase === 'available' && available.info.releaseUrl).toContain(
      'github.com/DevKelvin21/proj_minerva/releases/tag/v0.7.0',
    )

    const percents = statuses
      .filter((s): s is Extract<UpdaterStatus, { phase: 'downloading' }> => s.phase === 'downloading')
      .map((s) => s.percent)
    expect(percents).toEqual([0, 25, 50, 75])
  })

  it('guion "notify": checking -> unsupported con available poblado; download() no transiciona a downloading', async () => {
    const engine = createMockUpdaterEngine('notify', '0.6.3')
    const statuses: UpdaterStatus[] = []
    const setStatus = (s: UpdaterStatus): void => {
      statuses.push(s)
    }

    engine.init(setStatus)
    await engine.checkNow(setStatus)
    const afterCheck = statuses.length
    await engine.download(setStatus, statuses[statuses.length - 1])

    expect(collectPhases(statuses)).toEqual(['unsupported', 'checking', 'unsupported'])
    // download() no debe agregar NINGÚN estado nuevo (nunca `downloading`).
    expect(statuses.length).toBe(afterCheck)

    const last = statuses[statuses.length - 1]
    expect(last.phase === 'unsupported' && last.reason).toBe('mac-unsigned')
    expect(last.phase === 'unsupported' && last.available?.version).toBe('0.7.0')
  })

  it('guion "error": checking -> error con mensaje de exhibición', async () => {
    const engine = createMockUpdaterEngine('error', '0.6.3')
    const statuses: UpdaterStatus[] = []
    const setStatus = (s: UpdaterStatus): void => {
      statuses.push(s)
    }

    engine.init(setStatus)
    await engine.checkNow(setStatus)

    expect(collectPhases(statuses)).toEqual(['idle', 'checking', 'error'])
    const last = statuses[statuses.length - 1]
    expect(last.phase === 'error' && last.message.length > 0).toBe(true)
  })

  it('download() sin un "available" previo (current no es "available") es no-op', async () => {
    const engine = createMockUpdaterEngine('happy', '0.6.3')
    const statuses: UpdaterStatus[] = []
    const setStatus = (s: UpdaterStatus): void => {
      statuses.push(s)
    }

    engine.init(setStatus)
    await engine.download(setStatus, { phase: 'idle' })

    expect(statuses).toEqual([{ phase: 'idle' }])
  })
})
