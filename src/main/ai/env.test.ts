import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `getEffectiveAiSelection` consulta `settingsStore` (`../settings/store.ts`),
 * que a su vez usa `app.getPath('userData')` (Electron) — mockear el módulo
 * entero en vez de solo `electron` deja controlar exactamente qué "hay
 * persistido" por test (`vi.mocked(...).mockReturnValue(...)`), sin depender
 * de un `settings.json` real en disco ni pelear con la cache interna del
 * singleton `settingsStore` (que solo carga una vez por proceso).
 *
 * Desde T59 este módulo ya NO resuelve ninguna API key (OpenRouter,
 * eliminado como proveedor directo): no hay nada que mockear de
 * `./openrouter-key-store.ts` (borrado junto con el proveedor).
 */
vi.mock('../settings/store', () => ({
  settingsStore: {
    getPersistedSettings: vi.fn(() => null),
    getPersistedModelOptions: vi.fn(() => ({})),
  },
}))

const { getAiSettingsInfo, getEffectiveAiSelection, parseDotEnv, providerNeedingCatalogWarmup } =
  await import('./env')
const { settingsStore } = await import('../settings/store')
const { recordProviderModels, clearProviderModelsSnapshot } = await import(
  './providers/model-catalog-snapshot'
)

describe('parseDotEnv', () => {
  it('parsea pares KEY=VALUE simples', () => {
    expect(parseDotEnv('MINERVA_AI_PROVIDER=codex\nMINERVA_AI_MODEL=gpt-5.5')).toEqual({
      MINERVA_AI_PROVIDER: 'codex',
      MINERVA_AI_MODEL: 'gpt-5.5',
    })
  })

  it('ignora comentarios y líneas vacías', () => {
    const content = [
      '# comentario de cabecera',
      '',
      'MINERVA_AI_PROVIDER=codex',
      '  # otro comentario indentado',
      '',
      'MINERVA_AI_MODEL=gpt-5.5',
    ].join('\n')

    expect(parseDotEnv(content)).toEqual({
      MINERVA_AI_PROVIDER: 'codex',
      MINERVA_AI_MODEL: 'gpt-5.5',
    })
  })

  it('recorta espacios alrededor de key y value', () => {
    expect(parseDotEnv('  MINERVA_AI_PROVIDER  =   codex  ')).toEqual({
      MINERVA_AI_PROVIDER: 'codex',
    })
  })

  it('quita comillas dobles o simples que envuelven el valor completo', () => {
    expect(parseDotEnv('A="hello world"\nB=\'single quoted\'')).toEqual({
      A: 'hello world',
      B: 'single quoted',
    })
  })

  it('no quita comillas que no envuelven todo el valor', () => {
    expect(parseDotEnv('A=hello "world"')).toEqual({ A: 'hello "world"' })
  })

  it('ignora líneas sin "="', () => {
    expect(parseDotEnv('no es una línea válida\nMINERVA_AI_PROVIDER=codex')).toEqual({
      MINERVA_AI_PROVIDER: 'codex',
    })
  })

  it('permite valores vacíos', () => {
    expect(parseDotEnv('EMPTY=')).toEqual({ EMPTY: '' })
  })

  it('devuelve objeto vacío para contenido vacío', () => {
    expect(parseDotEnv('')).toEqual({})
  })

  it('un "=" dentro del valor no rompe el parseo (solo el primero separa key/value)', () => {
    expect(parseDotEnv('MINERVA_AI_MODEL=anthropic/claude-sonnet-4.5?x=1')).toEqual({
      MINERVA_AI_MODEL: 'anthropic/claude-sonnet-4.5?x=1',
    })
  })
})

describe('getEffectiveAiSelection (T26, precedencia proveedor+modelo)', () => {
  beforeEach(() => {
    vi.mocked(settingsStore.getPersistedSettings).mockReturnValue(null)
    vi.mocked(settingsStore.getPersistedModelOptions).mockReturnValue({})
  })

  afterEach(() => {
    delete process.env.MINERVA_AI_PROVIDER
    delete process.env.MINERVA_AI_MODEL
    vi.clearAllMocks()
  })

  it('sin nada persistido ni en el entorno, cae al default del catálogo (OpenCode + su modelo default)', () => {
    expect(getEffectiveAiSelection()).toEqual({
      provider: 'opencode',
      model: 'opencode/big-pickle',
      options: {},
    })
  })

  it('MINERVA_AI_PROVIDER + MINERVA_AI_MODEL del entorno ganan sobre el default cuando no hay settings', () => {
    process.env.MINERVA_AI_PROVIDER = 'claude-code'
    process.env.MINERVA_AI_MODEL = 'claude-sonnet-5'

    expect(getEffectiveAiSelection()).toEqual({
      provider: 'claude-code',
      model: 'claude-sonnet-5',
      options: { effort: 'high' },
    })
  })

  it('un MINERVA_AI_PROVIDER desconocido se ignora (con console.warn) y cae al proveedor default', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    process.env.MINERVA_AI_PROVIDER = 'gemini-cli'

    expect(getEffectiveAiSelection().provider).toBe('opencode')
    expect(warnSpy).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('gemini-cli'))

    warnSpy.mockRestore()
  })

  it('MINERVA_AI_PROVIDER="openrouter" (proveedor eliminado en T59) se trata como inválido: warn + default, nunca crashea', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    process.env.MINERVA_AI_PROVIDER = 'openrouter'

    expect(() => getEffectiveAiSelection()).not.toThrow()
    expect(getEffectiveAiSelection().provider).toBe('opencode')
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('openrouter'))

    warnSpy.mockRestore()
  })

  it('settings.json (aiProvider + su modelo) gana sobre el entorno', () => {
    process.env.MINERVA_AI_PROVIDER = 'codex'
    process.env.MINERVA_AI_MODEL = 'gpt-5.5-codex'
    vi.mocked(settingsStore.getPersistedSettings).mockReturnValue({
      aiProvider: 'claude-code',
      models: { 'claude-code': 'claude-sonnet-5' },
    })

    expect(getEffectiveAiSelection()).toEqual({
      provider: 'claude-code',
      model: 'claude-sonnet-5',
      options: { effort: 'high' },
    })
  })

  it('si el proveedor persistido no tiene modelo propio persistido, el modelo cae a MINERVA_AI_MODEL (aplicado al proveedor YA resuelto)', () => {
    process.env.MINERVA_AI_MODEL = 'claude-haiku-4-5'
    vi.mocked(settingsStore.getPersistedSettings).mockReturnValue({
      aiProvider: 'claude-code',
      models: {},
    })

    expect(getEffectiveAiSelection()).toEqual({
      provider: 'claude-code',
      model: 'claude-haiku-4-5',
      options: { effort: 'high' },
    })
  })

  it('si el proveedor persistido no tiene modelo propio ni hay MINERVA_AI_MODEL, cae al default de ESE proveedor', () => {
    vi.mocked(settingsStore.getPersistedSettings).mockReturnValue({
      aiProvider: 'codex',
      models: {},
    })

    expect(getEffectiveAiSelection()).toEqual({
      provider: 'codex',
      model: 'gpt-5.5',
      options: { effort: 'medium' },
    })
  })
})

describe('getEffectiveAiSelection().options (T34, resolución de option descriptors)', () => {
  beforeEach(() => {
    vi.mocked(settingsStore.getPersistedSettings).mockReturnValue(null)
    vi.mocked(settingsStore.getPersistedModelOptions).mockReturnValue({})
  })

  afterEach(() => {
    delete process.env.MINERVA_AI_PROVIDER
    delete process.env.MINERVA_AI_MODEL
    vi.clearAllMocks()
  })

  it('modelo sin descriptor "effort" (OpenCode big-pickle, el default) → options vacío', () => {
    expect(getEffectiveAiSelection().options).toEqual({})
  })

  it('effort guardado válido para el modelo activo se respeta (claude-sonnet-5 soporta "max")', () => {
    vi.mocked(settingsStore.getPersistedSettings).mockReturnValue({
      aiProvider: 'claude-code',
      models: { 'claude-code': 'claude-sonnet-5' },
    })
    vi.mocked(settingsStore.getPersistedModelOptions).mockReturnValue({ effort: 'max' })

    expect(getEffectiveAiSelection()).toEqual({
      provider: 'claude-code',
      model: 'claude-sonnet-5',
      options: { effort: 'max' },
    })
  })

  it('resolución robusta: effort guardado inválido para el modelo activo (xhigh en haiku-4-5, que no lo soporta) cae al default del modelo ("high")', () => {
    vi.mocked(settingsStore.getPersistedSettings).mockReturnValue({
      aiProvider: 'claude-code',
      models: { 'claude-code': 'claude-haiku-4-5' },
    })
    vi.mocked(settingsStore.getPersistedModelOptions).mockReturnValue({ effort: 'xhigh' })

    expect(getEffectiveAiSelection()).toEqual({
      provider: 'claude-code',
      model: 'claude-haiku-4-5',
      options: { effort: 'high' },
    })
  })

  it('modelo sin descriptor "effort" (OpenCode big-pickle) ignora cualquier "effort" persistido: options queda vacío', () => {
    vi.mocked(settingsStore.getPersistedSettings).mockReturnValue({
      aiProvider: 'opencode',
      models: { opencode: 'opencode/big-pickle' },
    })
    vi.mocked(settingsStore.getPersistedModelOptions).mockReturnValue({ effort: 'high' })

    expect(getEffectiveAiSelection().options).toEqual({})
  })

  it('Codex resuelve el effort guardado (todos sus modelos soportan low|medium|high|xhigh): xhigh se respeta', () => {
    vi.mocked(settingsStore.getPersistedSettings).mockReturnValue({
      aiProvider: 'codex',
      models: { codex: 'gpt-5.5' },
    })
    vi.mocked(settingsStore.getPersistedModelOptions).mockReturnValue({ effort: 'xhigh' })

    expect(getEffectiveAiSelection()).toEqual({
      provider: 'codex',
      model: 'gpt-5.5',
      options: { effort: 'xhigh' },
    })
  })

  it('Codex GPT-5.6 (Sol) soporta los niveles nuevos: un effort "ultra" guardado se respeta', () => {
    vi.mocked(settingsStore.getPersistedSettings).mockReturnValue({
      aiProvider: 'codex',
      models: { codex: 'gpt-5.6-sol' },
    })
    vi.mocked(settingsStore.getPersistedModelOptions).mockReturnValue({ effort: 'ultra' })

    expect(getEffectiveAiSelection()).toEqual({
      provider: 'codex',
      model: 'gpt-5.6-sol',
      options: { effort: 'ultra' },
    })
  })

  it('resolución robusta en Codex: "ultra" guardado no aplica a GPT-5.6-Luna (llega hasta "max") y cae a su default ("medium")', () => {
    vi.mocked(settingsStore.getPersistedSettings).mockReturnValue({
      aiProvider: 'codex',
      models: { codex: 'gpt-5.6-luna' },
    })
    vi.mocked(settingsStore.getPersistedModelOptions).mockReturnValue({ effort: 'ultra' })

    expect(getEffectiveAiSelection()).toEqual({
      provider: 'codex',
      model: 'gpt-5.6-luna',
      options: { effort: 'medium' },
    })
  })
})

/**
 * F19: los descriptores del modelo activo se buscan PRIMERO en el último
 * catálogo dinámico conocido (`./providers/model-catalog-snapshot.ts`) y solo
 * después en el curado. Sin esto, cualquier modelo nuevo —que por definición no
 * está en el curado— perdía en silencio el `effort` que el usuario había
 * elegido en Settings.
 */
describe('getEffectiveAiSelection (F19, opciones desde el catálogo DINÁMICO)', () => {
  beforeEach(() => {
    clearProviderModelsSnapshot()
    vi.mocked(settingsStore.getPersistedSettings).mockReturnValue(null)
    vi.mocked(settingsStore.getPersistedModelOptions).mockReturnValue({})
  })

  afterEach(() => {
    clearProviderModelsSnapshot()
    vi.clearAllMocks()
  })

  it('un modelo que SOLO existe en el catálogo dinámico resuelve su effort guardado', () => {
    recordProviderModels('claude-code', [
      {
        id: 'opus[1m]',
        label: 'Opus (1M context)',
        vendor: 'Anthropic',
        aliasFor: 'claude-opus-5[1m]',
        options: [
          {
            id: 'effort',
            label: 'Razonamiento',
            choices: [
              { value: 'high', label: 'Alto', isDefault: true },
              { value: 'max', label: 'Máximo' },
            ],
          },
        ],
      },
    ])
    vi.mocked(settingsStore.getPersistedSettings).mockReturnValue({
      aiProvider: 'claude-code',
      models: { 'claude-code': 'opus[1m]' },
    })
    vi.mocked(settingsStore.getPersistedModelOptions).mockReturnValue({ effort: 'max' })

    expect(getEffectiveAiSelection()).toEqual({
      provider: 'claude-code',
      model: 'opus[1m]',
      options: { effort: 'max' },
    })
  })

  it('sin snapshot todavía (arranque en frío), el mismo modelo dinámico cae al curado y no resuelve nada', () => {
    vi.mocked(settingsStore.getPersistedSettings).mockReturnValue({
      aiProvider: 'claude-code',
      models: { 'claude-code': 'opus[1m]' },
    })
    vi.mocked(settingsStore.getPersistedModelOptions).mockReturnValue({ effort: 'max' })

    expect(getEffectiveAiSelection().options).toEqual({})
  })

  it('un id canónico persistido matchea la fila ALIAS del catálogo dinámico (claude-sonnet-5 → sonnet)', () => {
    recordProviderModels('claude-code', [
      {
        id: 'sonnet',
        label: 'Sonnet',
        vendor: 'Anthropic',
        aliasFor: 'claude-sonnet-5',
        options: [
          {
            id: 'effort',
            label: 'Razonamiento',
            choices: [
              { value: 'low', label: 'Bajo' },
              { value: 'xhigh', label: 'Muy alto', isDefault: true },
            ],
          },
        ],
      },
    ])
    vi.mocked(settingsStore.getPersistedSettings).mockReturnValue({
      aiProvider: 'claude-code',
      models: { 'claude-code': 'claude-sonnet-5' },
    })
    vi.mocked(settingsStore.getPersistedModelOptions).mockReturnValue({ effort: 'low' })

    expect(getEffectiveAiSelection().options).toEqual({ effort: 'low' })
  })

  it('providerNeedingCatalogWarmup: null cuando el curado ya conoce el modelo activo (no spawnear el CLI de gratis)', () => {
    vi.mocked(settingsStore.getPersistedSettings).mockReturnValue({
      aiProvider: 'opencode',
      models: { opencode: 'opencode/big-pickle' },
    })

    expect(providerNeedingCatalogWarmup()).toBeNull()
  })

  it('providerNeedingCatalogWarmup: devuelve el proveedor cuando ningún catálogo conoce el modelo activo', () => {
    vi.mocked(settingsStore.getPersistedSettings).mockReturnValue({
      aiProvider: 'claude-code',
      models: { 'claude-code': 'opus[1m]' },
    })

    expect(providerNeedingCatalogWarmup()).toBe('claude-code')
  })

  it('providerNeedingCatalogWarmup: null una vez que el snapshot dinámico trae ese modelo', () => {
    recordProviderModels('claude-code', [
      { id: 'opus[1m]', label: 'Opus (1M context)', vendor: 'Anthropic' },
    ])
    vi.mocked(settingsStore.getPersistedSettings).mockReturnValue({
      aiProvider: 'claude-code',
      models: { 'claude-code': 'opus[1m]' },
    })

    expect(providerNeedingCatalogWarmup()).toBeNull()
  })

  it('el catálogo dinámico manda sobre el curado para el MISMO id: sus niveles reales son los que aplican', () => {
    // `claude-haiku-4-5` en el curado no soporta `xhigh`; si la cuenta real lo
    // ofreciera, el snapshot debe ganar en vez de degradar al default curado.
    recordProviderModels('claude-code', [
      {
        id: 'claude-haiku-4-5',
        label: 'Haiku 4.5',
        vendor: 'Anthropic',
        options: [
          {
            id: 'effort',
            label: 'Razonamiento',
            choices: [
              { value: 'high', label: 'Alto', isDefault: true },
              { value: 'xhigh', label: 'Muy alto' },
            ],
          },
        ],
      },
    ])
    vi.mocked(settingsStore.getPersistedSettings).mockReturnValue({
      aiProvider: 'claude-code',
      models: { 'claude-code': 'claude-haiku-4-5' },
    })
    vi.mocked(settingsStore.getPersistedModelOptions).mockReturnValue({ effort: 'xhigh' })

    expect(getEffectiveAiSelection().options).toEqual({ effort: 'xhigh' })
  })
})

describe('getAiSettingsInfo (T34, selectedOptions)', () => {
  beforeEach(() => {
    vi.mocked(settingsStore.getPersistedSettings).mockReturnValue(null)
    vi.mocked(settingsStore.getPersistedModelOptions).mockReturnValue({})
  })

  afterEach(() => {
    delete process.env.MINERVA_AI_PROVIDER
    delete process.env.MINERVA_AI_MODEL
    vi.clearAllMocks()
  })

  it('expone las opciones RESUELTAS del proveedor+modelo activo, indexadas por proveedor', () => {
    vi.mocked(settingsStore.getPersistedSettings).mockReturnValue({
      aiProvider: 'claude-code',
      models: { 'claude-code': 'opus' },
    })
    vi.mocked(settingsStore.getPersistedModelOptions).mockReturnValue({ effort: 'xhigh' })

    expect(getAiSettingsInfo().selectedOptions).toEqual({ 'claude-code': { effort: 'xhigh' } })
  })

  it('modelo activo sin descriptores (default de OpenCode) → selectedOptions con un objeto vacío para ese proveedor', () => {
    expect(getAiSettingsInfo().selectedOptions).toEqual({ opencode: {} })
  })
})
