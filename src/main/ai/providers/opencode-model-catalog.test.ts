import { afterEach, describe, expect, it, vi } from 'vitest'
import { AI_PROVIDER_CATALOG } from '../../../shared/ai-providers'

/**
 * `fetchOpencodeModelCatalog` (T57) depende de `getOpencodeServer`
 * (`./opencode-runtime.ts`, singleton lazy) para saber a qué URL hablarle —
 * se mockea ese módulo para no spawnear un server real. El cliente del SDK en
 * sí (`provider.list`) se inyecta vía el parámetro `createClient` (mismo
 * patrón de inyección que `fetchCodexModelCatalog`/`FakeCodexAppServerClient`
 * en `./codex-model-catalog.test.ts`), así que no hace falta mockear
 * `@opencode-ai/sdk`.
 */
const getOpencodeServerMock = vi.fn()
vi.mock('./opencode-runtime', () => ({
  getOpencodeServer: (...args: unknown[]) => getOpencodeServerMock(...args),
}))

const { fetchOpencodeModelCatalog } = await import('./opencode-model-catalog')

/** Mismo shape (estructural) que las interfaces privadas de `./opencode-model-catalog.ts` — no se exportan, así que el test define su propia copia mínima. */
interface FakeModel {
  id: string
  name: string
  variants?: Record<string, unknown>
}

interface FakeProvider {
  id: string
  name: string
  models: Record<string, FakeModel>
}

interface FakeProviderListData {
  all: FakeProvider[]
  default: Record<string, string>
  connected: string[]
}

function fakeClient(data: FakeProviderListData | undefined, error?: Error) {
  return () => ({
    provider: {
      list: () => (error ? Promise.reject(error) : Promise.resolve({ data })),
    },
  })
}

describe('fetchOpencodeModelCatalog', () => {
  afterEach(() => vi.clearAllMocks())

  it('devuelve el catálogo curado si getOpencodeServer rechaza (binario ausente / timeout de arranque)', async () => {
    getOpencodeServerMock.mockRejectedValue(new Error('no arrancó'))

    const models = await fetchOpencodeModelCatalog()

    expect(models).toEqual(AI_PROVIDER_CATALOG.opencode.models)
  })

  it('devuelve el catálogo curado si provider.list rechaza', async () => {
    getOpencodeServerMock.mockResolvedValue({ url: 'http://127.0.0.1:1' })

    const models = await fetchOpencodeModelCatalog(fakeClient(undefined, new Error('ECONNREFUSED')))

    expect(models).toEqual(AI_PROVIDER_CATALOG.opencode.models)
  })

  it('devuelve el catálogo curado si la respuesta no trae `data`', async () => {
    getOpencodeServerMock.mockResolvedValue({ url: 'http://127.0.0.1:1' })

    const models = await fetchOpencodeModelCatalog(fakeClient(undefined))

    expect(models).toEqual(AI_PROVIDER_CATALOG.opencode.models)
  })

  it('devuelve el catálogo curado si ningún provider está en `connected` (sin upstream conectado)', async () => {
    getOpencodeServerMock.mockResolvedValue({ url: 'http://127.0.0.1:1' })
    const data: FakeProviderListData = {
      all: [
        {
          id: 'anthropic',
          name: 'Anthropic',
          models: { 'claude-sonnet-5': { id: 'claude-sonnet-5', name: 'Claude Sonnet 5' } },
        },
      ],
      default: {},
      connected: [],
    }

    const models = await fetchOpencodeModelCatalog(fakeClient(data))

    expect(models).toEqual(AI_PROVIDER_CATALOG.opencode.models)
  })

  it('SOLO incluye modelos de providers en `connected`, con slug `<provider>/<model>`', async () => {
    getOpencodeServerMock.mockResolvedValue({ url: 'http://127.0.0.1:1' })
    const data: FakeProviderListData = {
      all: [
        {
          id: 'opencode',
          name: 'OpenCode',
          models: { 'big-pickle': { id: 'big-pickle', name: 'Big Pickle' } },
        },
        {
          id: 'anthropic',
          name: 'Anthropic',
          models: { 'claude-sonnet-5': { id: 'claude-sonnet-5', name: 'Claude Sonnet 5' } },
        },
      ],
      default: {},
      connected: ['opencode'],
    }

    const models = await fetchOpencodeModelCatalog(fakeClient(data))

    expect(models).toEqual([{ id: 'opencode/big-pickle', label: 'Big Pickle', vendor: 'OpenCode' }])
  })

  it('arma el descriptor `variant` a partir de las CLAVES de model.variants, con Low/Medium/High para low/medium/high', async () => {
    getOpencodeServerMock.mockResolvedValue({ url: 'http://127.0.0.1:1' })
    const data: FakeProviderListData = {
      all: [
        {
          id: 'unknown-provider',
          name: 'Unknown Provider',
          models: {
            'hy3-free': {
              id: 'hy3-free',
              name: 'Hy3 Free',
              variants: { low: {}, medium: {}, high: {} },
            },
          },
        },
      ],
      default: {},
      connected: ['unknown-provider'],
    }

    const models = await fetchOpencodeModelCatalog(fakeClient(data))

    expect(models).toEqual([
      {
        id: 'unknown-provider/hy3-free',
        label: 'Hy3 Free',
        vendor: 'Unknown Provider',
        options: [
          {
            id: 'variant',
            label: 'Variant',
            choices: [
              { value: 'low', label: 'Low', isDefault: false },
              { value: 'medium', label: 'Medium', isDefault: false },
              { value: 'high', label: 'High', isDefault: false },
            ],
          },
        ],
      },
    ])
  })

  it('default de variante: anthropic/google → "high" si existe', async () => {
    getOpencodeServerMock.mockResolvedValue({ url: 'http://127.0.0.1:1' })
    const data: FakeProviderListData = {
      all: [
        {
          id: 'anthropic',
          name: 'Anthropic',
          models: {
            'claude-sonnet-5': {
              id: 'claude-sonnet-5',
              name: 'Claude Sonnet 5',
              variants: { low: {}, medium: {}, high: {} },
            },
          },
        },
        {
          id: 'google-vertex',
          name: 'Google Vertex',
          models: {
            'gemini-3.5-flash': {
              id: 'gemini-3.5-flash',
              name: 'Gemini 3.5 Flash',
              variants: { medium: {}, high: {} },
            },
          },
        },
      ],
      default: {},
      connected: ['anthropic', 'google-vertex'],
    }

    const models = await fetchOpencodeModelCatalog(fakeClient(data))

    const anthropicChoices = models.find((m) => m.id === 'anthropic/claude-sonnet-5')?.options?.[0]?.choices
    const googleChoices = models.find((m) => m.id === 'google-vertex/gemini-3.5-flash')?.options?.[0]?.choices
    expect(anthropicChoices?.find((c) => c.value === 'high')?.isDefault).toBe(true)
    expect(anthropicChoices?.filter((c) => c.isDefault)).toHaveLength(1)
    expect(googleChoices?.find((c) => c.value === 'high')?.isDefault).toBe(true)
  })

  it('default de variante: openai/opencode → "medium" si existe, si no "high"', async () => {
    getOpencodeServerMock.mockResolvedValue({ url: 'http://127.0.0.1:1' })
    const data: FakeProviderListData = {
      all: [
        {
          id: 'openai',
          name: 'OpenAI',
          models: {
            'gpt-5.5': { id: 'gpt-5.5', name: 'GPT-5.5', variants: { low: {}, medium: {}, high: {} } },
          },
        },
        {
          id: 'opencode',
          name: 'OpenCode',
          models: {
            'north-mini-code-free': {
              id: 'north-mini-code-free',
              name: 'North Mini Code Free',
              variants: { none: {}, high: {} },
            },
          },
        },
      ],
      default: {},
      connected: ['openai', 'opencode'],
    }

    const models = await fetchOpencodeModelCatalog(fakeClient(data))

    const openaiChoices = models.find((m) => m.id === 'openai/gpt-5.5')?.options?.[0]?.choices
    const opencodeChoices = models.find((m) => m.id === 'opencode/north-mini-code-free')?.options?.[0]?.choices
    expect(openaiChoices?.find((c) => c.value === 'medium')?.isDefault).toBe(true)
    // Sin "medium" entre sus variantes: cae a "high".
    expect(opencodeChoices?.find((c) => c.value === 'high')?.isDefault).toBe(true)
    expect(opencodeChoices?.find((c) => c.value === 'none')?.isDefault).toBe(false)
  })

  it('default de variante: única variante ⇒ esa, sin importar el provider', async () => {
    getOpencodeServerMock.mockResolvedValue({ url: 'http://127.0.0.1:1' })
    const data: FakeProviderListData = {
      all: [
        {
          id: 'requesty',
          name: 'Requesty',
          models: { 'big-pickle': { id: 'big-pickle', name: 'Big Pickle', variants: { default: {} } } },
        },
      ],
      default: {},
      connected: ['requesty'],
    }

    const models = await fetchOpencodeModelCatalog(fakeClient(data))

    expect(models[0]!.options![0]!.choices).toEqual([{ value: 'default', label: 'Default', isDefault: true }])
  })

  it('un modelo sin variants queda sin descriptor options', async () => {
    getOpencodeServerMock.mockResolvedValue({ url: 'http://127.0.0.1:1' })
    const data: FakeProviderListData = {
      all: [
        {
          id: 'opencode',
          name: 'OpenCode',
          models: { 'big-pickle': { id: 'big-pickle', name: 'Big Pickle' } },
        },
      ],
      default: {},
      connected: ['opencode'],
    }

    const models = await fetchOpencodeModelCatalog(fakeClient(data))

    expect(models).toEqual([{ id: 'opencode/big-pickle', label: 'Big Pickle', vendor: 'OpenCode' }])
  })

  it('agrega el sub-proveedor al label SOLO cuando dos providers conectados ofrecen un modelo con el mismo nombre', async () => {
    getOpencodeServerMock.mockResolvedValue({ url: 'http://127.0.0.1:1' })
    const data: FakeProviderListData = {
      all: [
        {
          id: 'openai',
          name: 'OpenAI',
          models: { 'gpt-5.4': { id: 'gpt-5.4', name: 'GPT-5.4' } },
        },
        {
          id: 'github-copilot',
          name: 'GitHub Copilot',
          models: { 'gpt-5.4': { id: 'gpt-5.4', name: 'GPT-5.4' } },
        },
      ],
      default: {},
      connected: ['openai', 'github-copilot'],
    }

    const models = await fetchOpencodeModelCatalog(fakeClient(data))

    expect(models.map((m) => m.label).sort()).toEqual(['GPT-5.4 · GitHub Copilot', 'GPT-5.4 · OpenAI'])
  })

  it('ordena el resultado por label', async () => {
    getOpencodeServerMock.mockResolvedValue({ url: 'http://127.0.0.1:1' })
    const data: FakeProviderListData = {
      all: [
        {
          id: 'opencode',
          name: 'OpenCode',
          models: {
            'north-mini-code-free': { id: 'north-mini-code-free', name: 'North Mini Code Free' },
            'big-pickle': { id: 'big-pickle', name: 'Big Pickle' },
            'hy3-free': { id: 'hy3-free', name: 'Hy3 Free' },
          },
        },
      ],
      default: {},
      connected: ['opencode'],
    }

    const models = await fetchOpencodeModelCatalog(fakeClient(data))

    expect(models.map((m) => m.label)).toEqual(['Big Pickle', 'Hy3 Free', 'North Mini Code Free'])
  })
})
