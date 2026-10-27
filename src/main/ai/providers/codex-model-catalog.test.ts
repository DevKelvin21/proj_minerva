import { describe, expect, it } from 'vitest'
import { AI_PROVIDER_CATALOG } from '../../../shared/ai-providers'
import { fetchCodexModelCatalog } from './codex-model-catalog'

/**
 * `fetchCodexModelCatalog` (T35) habla con `codex app-server` vía
 * `CodexAppServerClient` (`./codex-app-server-client.ts`) — se pasa un
 * cliente FALSO por el parámetro `createClient` (nunca se mockea el módulo:
 * la firma ya está pensada para inyección) que responde con la forma REAL de
 * `model/list` (`{ data, nextCursor }`, NO `{ models }`).
 */
interface FakeClientScript {
  /** Resultado de `initialize`; por defecto un objeto vacío (no importa su forma). */
  initializeResult?: unknown
  /** Si se define, `initialize`/`model/list` rechazan con este error. */
  requestError?: Error
  /** Páginas de `model/list`, en el orden en que se deben devolver (una por llamada). */
  pages?: unknown[]
}

class FakeCodexAppServerClient {
  readonly requestCalls: Array<{ method: string; params: unknown }> = []
  readonly notifyCalls: Array<{ method: string; params: unknown }> = []
  killCalls = 0
  private pageIndex = 0

  constructor(private readonly script: FakeClientScript) {}

  request<T>(method: string, params?: unknown): Promise<T> {
    this.requestCalls.push({ method, params })
    if (this.script.requestError) return Promise.reject(this.script.requestError)

    if (method === 'initialize') return Promise.resolve((this.script.initializeResult ?? {}) as T)
    if (method === 'model/list') {
      const pages = this.script.pages ?? []
      const page = pages[this.pageIndex]
      this.pageIndex++
      return Promise.resolve(page as T)
    }
    return Promise.reject(new Error('método inesperado en el fake: ' + method))
  }

  notify(method: string, params?: unknown): void {
    this.notifyCalls.push({ method, params })
  }

  kill(): void {
    this.killCalls++
  }
}

function withFakeClient(script: FakeClientScript) {
  let created: FakeCodexAppServerClient | null = null
  const createClient = () => {
    created = new FakeCodexAppServerClient(script)
    // El tipo público de `fetchCodexModelCatalog` espera un
    // `CodexAppServerClient` real; el fake implementa el mismo subconjunto de
    // superficie (`request`/`notify`/`kill`) que la función usa, así que el
    // cast es seguro para este test.
    return created as unknown as import('./codex-app-server-client').CodexAppServerClient
  }
  return { createClient, getClient: () => created! }
}

describe('fetchCodexModelCatalog', () => {
  it('hace el handshake real (initialize con clientInfo/capabilities, luego initialized sin params)', async () => {
    const { createClient, getClient } = withFakeClient({
      pages: [{ data: [], nextCursor: null }],
    })

    await fetchCodexModelCatalog(createClient)

    const client = getClient()
    expect(client.requestCalls[0]).toEqual({
      method: 'initialize',
      params: {
        clientInfo: { name: 'minerva', title: 'Minerva', version: '0.1.0' },
        capabilities: { experimentalApi: true, requestAttestation: false },
      },
    })
    expect(client.notifyCalls).toEqual([{ method: 'initialized', params: undefined }])
  })

  it('mapea un Model con supportedReasoningEfforts al AiModelOption esperado (descriptor effort, isDefault correcto)', async () => {
    const { createClient } = withFakeClient({
      pages: [
        {
          data: [
            {
              id: 'gpt-5.5',
              displayName: 'GPT-5.5',
              hidden: false,
              supportedReasoningEfforts: [
                { reasoningEffort: 'low', description: 'Rápido, menos razonamiento.' },
                { reasoningEffort: 'high', description: 'Razonamiento profundo.' },
              ],
              defaultReasoningEffort: 'medium',
            },
          ],
          nextCursor: null,
        },
      ],
    })

    const models = await fetchCodexModelCatalog(createClient)

    expect(models).toEqual([
      {
        id: 'gpt-5.5',
        label: 'GPT-5.5',
        vendor: 'OpenAI',
        options: [
          {
            id: 'effort',
            label: 'Reasoning',
            choices: [
              {
                value: 'low',
                label: 'Low',
                description: 'Rápido, menos razonamiento.',
                isDefault: false,
              },
              {
                value: 'high',
                label: 'High',
                description: 'Razonamiento profundo.',
                isDefault: false,
              },
            ],
          },
        ],
      },
    ])
  })

  it('etiqueta los niveles de la familia GPT-5.6: "max" → "Max", "ultra" → "Ultra", y un nivel desconocido cae a capitalizado', async () => {
    const { createClient } = withFakeClient({
      pages: [
        {
          data: [
            {
              id: 'gpt-5.6-sol',
              displayName: 'GPT-5.6-Sol',
              supportedReasoningEfforts: [
                { reasoningEffort: 'max', description: 'Maximum reasoning depth for the hardest problems' },
                { reasoningEffort: 'ultra', description: 'Maximum reasoning with automatic task delegation' },
                { reasoningEffort: 'hyper', description: 'Un nivel futuro que este mapa no conoce' },
              ],
              defaultReasoningEffort: 'ultra',
            },
          ],
          nextCursor: null,
        },
      ],
    })

    const models = await fetchCodexModelCatalog(createClient)

    expect(models[0]!.options![0]!.choices).toEqual([
      {
        value: 'max',
        label: 'Max',
        description: 'Maximum reasoning depth for the hardest problems',
        isDefault: false,
      },
      {
        value: 'ultra',
        label: 'Ultra',
        description: 'Maximum reasoning with automatic task delegation',
        isDefault: true,
      },
      {
        value: 'hyper',
        label: 'Hyper',
        description: 'Un nivel futuro que este mapa no conoce',
        isDefault: false,
      },
    ])
  })

  it('un modelo con defaultReasoningEffort que SÍ está entre sus choices marca isDefault en la choice correcta', async () => {
    const { createClient } = withFakeClient({
      pages: [
        {
          data: [
            {
              id: 'gpt-5.4',
              displayName: 'GPT-5.4',
              supportedReasoningEfforts: [
                { reasoningEffort: 'low', description: 'low' },
                { reasoningEffort: 'medium', description: 'medium' },
              ],
              defaultReasoningEffort: 'medium',
            },
          ],
          nextCursor: null,
        },
      ],
    })

    const models = await fetchCodexModelCatalog(createClient)

    expect(models[0]!.options![0]!.choices).toEqual([
      { value: 'low', label: 'Low', description: 'low', isDefault: false },
      { value: 'medium', label: 'Medium', description: 'medium', isDefault: true },
    ])
  })

  it('un modelo sin supportedReasoningEfforts (array vacío) queda sin descriptor options', async () => {
    const { createClient } = withFakeClient({
      pages: [
        {
          data: [{ id: 'gpt-5.3-codex-spark', displayName: 'GPT-5.3 Codex Spark', supportedReasoningEfforts: [] }],
          nextCursor: null,
        },
      ],
    })

    const models = await fetchCodexModelCatalog(createClient)

    expect(models).toEqual([{ id: 'gpt-5.3-codex-spark', label: 'GPT-5.3 Codex Spark', vendor: 'OpenAI' }])
  })

  it('usa el id como label cuando falta displayName', async () => {
    const { createClient } = withFakeClient({
      pages: [{ data: [{ id: 'gpt-5.4-mini' }], nextCursor: null }],
    })

    const models = await fetchCodexModelCatalog(createClient)

    expect(models).toEqual([{ id: 'gpt-5.4-mini', label: 'gpt-5.4-mini', vendor: 'OpenAI' }])
  })

  it('NO filtra modelos con hidden: true (se exponen tal cual los da la RPC)', async () => {
    const { createClient } = withFakeClient({
      pages: [{ data: [{ id: 'gpt-5.5', displayName: 'GPT-5.5', hidden: true }], nextCursor: null }],
    })

    const models = await fetchCodexModelCatalog(createClient)

    expect(models).toEqual([{ id: 'gpt-5.5', label: 'GPT-5.5', vendor: 'OpenAI' }])
  })

  it('pagina mientras nextCursor no sea null, pasando { cursor } en la request siguiente', async () => {
    const { createClient, getClient } = withFakeClient({
      pages: [
        { data: [{ id: 'gpt-5.5', displayName: 'GPT-5.5' }], nextCursor: 'page-2' },
        { data: [{ id: 'gpt-5.4', displayName: 'GPT-5.4' }], nextCursor: null },
      ],
    })

    const models = await fetchCodexModelCatalog(createClient)

    expect(models.map((m) => m.id)).toEqual(['gpt-5.5', 'gpt-5.4'])
    const client = getClient()
    const listCalls = client.requestCalls.filter((c) => c.method === 'model/list')
    expect(listCalls).toEqual([
      { method: 'model/list', params: {} },
      { method: 'model/list', params: { cursor: 'page-2' } },
    ])
  })

  it('devuelve el catálogo curado si la RPC rechaza (sin sesión/timeout/binario ausente) y mata el cliente igual', async () => {
    const { createClient, getClient } = withFakeClient({
      requestError: new Error('codex no encontrado en PATH'),
    })

    const models = await fetchCodexModelCatalog(createClient)

    expect(models).toEqual(AI_PROVIDER_CATALOG.codex.models)
    expect(getClient().killCalls).toBe(1)
  })

  it('devuelve el catálogo curado si model/list viene vacío (sin páginas con modelos)', async () => {
    const { createClient } = withFakeClient({
      pages: [{ data: [], nextCursor: null }],
    })

    const models = await fetchCodexModelCatalog(createClient)

    expect(models).toEqual(AI_PROVIDER_CATALOG.codex.models)
  })

  it('mata el cliente en el finally incluso en el camino feliz', async () => {
    const { createClient, getClient } = withFakeClient({
      pages: [{ data: [{ id: 'gpt-5.5', displayName: 'GPT-5.5' }], nextCursor: null }],
    })

    await fetchCodexModelCatalog(createClient)

    expect(getClient().killCalls).toBe(1)
  })
})
