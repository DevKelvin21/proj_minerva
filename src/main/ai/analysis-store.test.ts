import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DidacticAnalysis } from '../../shared/types'

/**
 * Mismo mock que `../settings/store.test.ts`: `AnalysisStore` usa
 * `app.getPath('userData')` (Electron), que fuera de un proceso Electron real
 * no existe como función. Se usa un directorio temporal real por test (no
 * memfs) para probar lectura/escritura de punta a punta, incluida la
 * escritura atómica.
 */
let userDataDir = ''

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name !== 'userData') throw new Error('getPath inesperado: ' + name)
      return userDataDir
    },
  },
}))

const { AnalysisStore } = await import('./analysis-store')

function analysesFilePath(): string {
  return join(userDataDir, 'analyses.json')
}

function analysis(prId: string, overrides: Partial<DidacticAnalysis> = {}): DidacticAnalysis {
  return {
    prId,
    sections: [{ kind: 'summary', markdown: prId }],
    generatedAt: '2026-07-06T00:00:00.000Z',
    headSha: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
    generatedWith: { provider: 'opencode', model: 'opencode/big-pickle', options: {} },
    language: 'en',
    ...overrides,
  }
}

describe('AnalysisStore', () => {
  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'minerva-analysis-store-test-'))
  })

  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true })
  })

  it('devuelve vacío si no hay analyses.json (sin log, archivo ausente es el caso normal)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const store = new AnalysisStore()

    expect(store.loadEntries()).toEqual([])
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('devuelve vacío + console.warn si el archivo tiene JSON inválido (corrupto)', () => {
    writeFileSync(analysesFilePath(), '{ esto no es json', 'utf-8')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const store = new AnalysisStore()
    expect(store.loadEntries()).toEqual([])
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('devuelve vacío + console.warn si el JSON es válido pero no tiene la forma esperada', () => {
    writeFileSync(analysesFilePath(), JSON.stringify({ foo: 'bar' }), 'utf-8')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const store = new AnalysisStore()
    expect(store.loadEntries()).toEqual([])
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()

    writeFileSync(analysesFilePath(), JSON.stringify({ version: 99, entries: [] }), 'utf-8')
    expect(new AnalysisStore().loadEntries()).toEqual([])

    writeFileSync(analysesFilePath(), JSON.stringify(['not', 'an', 'object']), 'utf-8')
    expect(new AnalysisStore().loadEntries()).toEqual([])
  })

  it('drops a version 1 file (old owner/name#n keys) quietly, without crashing', () => {
    const entries = [{ key: 'shopwave/api#1', analysis: analysis('shopwave/api#1') }]
    writeFileSync(analysesFilePath(), JSON.stringify({ version: 1, entries }), 'utf-8')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const store = new AnalysisStore()
    expect(store.loadEntries()).toEqual([])
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()

    store.saveEntries([{ key: 'github:shopwave/api#1', analysis: analysis('x') }])
    expect(JSON.parse(readFileSync(analysesFilePath(), 'utf-8')).version).toBe(2)
  })

  it('descarta entries con forma inválida pero conserva las válidas', () => {
    const valid = { key: 'shopwave/api#1', analysis: analysis('shopwave/api#1') }
    const badKey = { key: '', analysis: analysis('bad-key') }
    const badAnalysisMissingHeadSha = {
      key: 'shopwave/api#2',
      analysis: { prId: 'x', sections: [], generatedAt: '2026-07-06T00:00:00.000Z' },
    }
    const badGeneratedWith = {
      key: 'shopwave/api#3',
      analysis: analysis('bad-generated-with', {
        generatedWith: { provider: 'not-a-provider', model: 'x', options: {} } as never,
      }),
    }
    const notAnObject = 'nope'

    writeFileSync(
      analysesFilePath(),
      JSON.stringify({
        version: 2,
        entries: [valid, badKey, badAnalysisMissingHeadSha, badGeneratedWith, notAnObject],
      }),
      'utf-8',
    )
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const store = new AnalysisStore()
    expect(store.loadEntries()).toEqual([valid])
    warn.mockRestore()
  })

  it('roundtrip: saveEntries + loadEntries en la misma instancia (cache en memoria)', () => {
    const store = new AnalysisStore()
    const entries = [
      { key: 'shopwave/api#1', analysis: analysis('a') },
      { key: 'shopwave/api#2', analysis: analysis('b') },
    ]

    store.saveEntries(entries)
    expect(store.loadEntries()).toEqual(entries)
  })

  it('roundtrip tras "reinicio": una instancia nueva lee lo persistido en disco', () => {
    const entries = [{ key: 'shopwave/api#1', analysis: analysis('a') }]
    new AnalysisStore().saveEntries(entries)

    const restarted = new AnalysisStore()
    expect(restarted.loadEntries()).toEqual(entries)
  })

  it('escritura atómica: analyses.json queda íntegro (JSON parseable, forma correcta) y sin dejar el .tmp', () => {
    const entries = [{ key: 'shopwave/api#1', analysis: analysis('a') }]
    new AnalysisStore().saveEntries(entries)

    const raw = readFileSync(analysesFilePath(), 'utf-8')
    expect(JSON.parse(raw)).toEqual({ version: 2, entries })
    expect(raw).toContain('\n') // pretty-printed
    expect(existsSync(analysesFilePath() + '.tmp')).toBe(false)
  })

  it('cap 20 + orden LRU: saveEntries recorta a las últimas 20 (más recientes), descartando las más viejas', () => {
    const entries = Array.from({ length: 25 }, (_, i) => ({
      key: 'shopwave/api#' + (i + 1),
      analysis: analysis('pr' + (i + 1)),
    }))

    const store = new AnalysisStore()
    store.saveEntries(entries)

    const loaded = store.loadEntries()
    expect(loaded).toHaveLength(20)
    // Se descartan las 5 más viejas (#1..#5); sobreviven #6..#25 en el mismo orden.
    expect(loaded[0]?.key).toBe('shopwave/api#6')
    expect(loaded[19]?.key).toBe('shopwave/api#25')
  })

  it('cap 20 también se aplica al leer un archivo escrito a mano con más de 20 entries válidas', () => {
    const entries = Array.from({ length: 23 }, (_, i) => ({
      key: 'shopwave/api#' + (i + 1),
      analysis: analysis('pr' + (i + 1)),
    }))
    writeFileSync(analysesFilePath(), JSON.stringify({ version: 2, entries }), 'utf-8')

    const loaded = new AnalysisStore().loadEntries()
    expect(loaded).toHaveLength(20)
    expect(loaded[0]?.key).toBe('shopwave/api#4')
    expect(loaded[19]?.key).toBe('shopwave/api#23')
  })
})
