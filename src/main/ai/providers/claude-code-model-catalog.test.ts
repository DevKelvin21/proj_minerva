import { describe, expect, it, vi } from 'vitest'
import { AI_PROVIDER_CATALOG } from '../../../shared/ai-providers'
import { fetchClaudeCodeModelCatalog, type ClaudeModelSession } from './claude-code-model-catalog'

/**
 * `fetchClaudeCodeModelCatalog` con la sesión INYECTADA (mismo patrón que
 * `./codex-model-catalog.test.ts` con `createClient`): nunca spawnea el CLI
 * real, así que estos tests no dependen de tener `claude` instalado ni logueado.
 *
 * Las filas de ejemplo son las que devolvió el binario real
 * (`claude` 2.1.220 + Agent SDK 0.3.203) en el probe que abrió F19, recortadas
 * a los campos que el módulo lee.
 */
const REAL_ROWS = [
  {
    value: 'default',
    resolvedModel: 'claude-opus-5[1m]',
    displayName: 'Default (recommended)',
    description: 'Opus 5 with 1M context',
    supportsEffort: true,
    supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
  },
  {
    value: 'opus[1m]',
    resolvedModel: 'claude-opus-5[1m]',
    displayName: 'Opus (1M context)',
    supportsEffort: true,
    supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
  },
  {
    value: 'sonnet',
    resolvedModel: 'claude-sonnet-5',
    displayName: 'Sonnet',
    supportsEffort: true,
    supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
  },
  {
    value: 'haiku',
    resolvedModel: 'claude-haiku-4-5-20251001',
    displayName: 'Haiku',
  },
]

function sessionOf(rows: unknown[], close = vi.fn()): () => ClaudeModelSession {
  return () =>
    ({
      supportedModels: () => Promise.resolve(rows),
      close,
    }) as unknown as ClaudeModelSession
}

describe('fetchClaudeCodeModelCatalog', () => {
  it('mapea las filas reales de supportedModels() a AiModelOption', async () => {
    const models = await fetchClaudeCodeModelCatalog(sessionOf(REAL_ROWS))

    expect(models.map((model) => model.id)).toEqual(['opus[1m]', 'sonnet', 'haiku'])
    expect(models[0]).toMatchObject({
      id: 'opus[1m]',
      label: 'Opus (1M context)',
      vendor: 'Anthropic',
      aliasFor: 'claude-opus-5[1m]',
    })
  })

  it('descarta la fila alias "default" (duplicaría el modelo concreto al que resuelve)', async () => {
    const models = await fetchClaudeCodeModelCatalog(sessionOf(REAL_ROWS))

    expect(models.some((model) => model.id === 'default')).toBe(false)
  })

  it('arma el descriptor "effort" con los niveles reportados y "high" por default', async () => {
    const models = await fetchClaudeCodeModelCatalog(sessionOf(REAL_ROWS))
    const effort = models.find((model) => model.id === 'sonnet')?.options?.[0]

    expect(effort?.id).toBe('effort')
    expect(effort?.choices.map((choice) => choice.value)).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ])
    expect(effort?.choices.find((choice) => choice.isDefault)?.value).toBe('high')
    // Etiquetas/descripciones compartidas con el catálogo curado (no las manda el SDK).
    expect(effort?.choices[0]).toMatchObject({ label: 'Low', description: expect.any(String) })
  })

  it('un modelo sin soporte de effort (Haiku hoy) queda sin options', async () => {
    const models = await fetchClaudeCodeModelCatalog(sessionOf(REAL_ROWS))

    expect(models.find((model) => model.id === 'haiku')?.options).toBeUndefined()
  })

  it('si el nivel "high" no está en la lista, el default es el primero reportado', async () => {
    const models = await fetchClaudeCodeModelCatalog(
      sessionOf([{ value: 'x', supportsEffort: true, supportedEffortLevels: ['low', 'medium'] }]),
    )

    expect(models[0]?.options?.[0]?.choices.find((choice) => choice.isDefault)?.value).toBe('low')
  })

  it('no pone aliasFor cuando resolvedModel es igual al value (no es un alias)', async () => {
    const models = await fetchClaudeCodeModelCatalog(
      sessionOf([{ value: 'claude-sonnet-5', resolvedModel: 'claude-sonnet-5', displayName: 'Sonnet 5' }]),
    )

    expect(models[0]).not.toHaveProperty('aliasFor')
  })

  it('cae al displayName ausente usando el value como label', async () => {
    const models = await fetchClaudeCodeModelCatalog(sessionOf([{ value: 'algo-nuevo' }]))

    expect(models[0]).toMatchObject({ id: 'algo-nuevo', label: 'algo-nuevo' })
  })

  it('descarta filas sin un value usable, sin tirar el resto', async () => {
    const models = await fetchClaudeCodeModelCatalog(
      sessionOf([{ value: '' }, { displayName: 'sin value' }, { value: 'sonnet' }]),
    )

    expect(models.map((model) => model.id)).toEqual(['sonnet'])
  })

  it('cae al catálogo curado si supportedModels() no devuelve nada usable', async () => {
    const models = await fetchClaudeCodeModelCatalog(sessionOf([]))

    expect(models).toEqual(AI_PROVIDER_CATALOG['claude-code'].models)
  })

  it('cae al catálogo curado si abrir la sesión lanza (CLI ausente) sin propagar el error', async () => {
    const models = await fetchClaudeCodeModelCatalog(() => {
      throw new Error('El CLI «claude» no está en el PATH.')
    })

    expect(models).toEqual(AI_PROVIDER_CATALOG['claude-code'].models)
  })

  it('cae al catálogo curado si supportedModels() rechaza (sin sesión, handshake roto)', async () => {
    const close = vi.fn()
    const models = await fetchClaudeCodeModelCatalog(() => ({
      supportedModels: () => Promise.reject(new Error('not authenticated')),
      close,
    }))

    expect(models).toEqual(AI_PROVIDER_CATALOG['claude-code'].models)
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('cierra la sesión SIEMPRE (éxito: no debe quedar un proceso claude huérfano por refresco)', async () => {
    const close = vi.fn()
    await fetchClaudeCodeModelCatalog(sessionOf(REAL_ROWS, close))

    expect(close).toHaveBeenCalledTimes(1)
  })

  it('cae al catálogo curado cuando el CLI no responde dentro del timeout, y cierra la sesión', async () => {
    vi.useFakeTimers()
    const close = vi.fn()
    try {
      const promise = fetchClaudeCodeModelCatalog(() => ({
        supportedModels: () => new Promise(() => {}),
        close,
      }))
      await vi.advanceTimersByTimeAsync(15_001)

      expect(await promise).toEqual(AI_PROVIDER_CATALOG['claude-code'].models)
      expect(close).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
