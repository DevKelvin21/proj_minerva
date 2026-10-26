import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrContextSource } from '../pr-context'
import type { DiffFile, PullRequestDetail } from '../../../shared/types'
import type { DraftDidacticSection } from '../../../shared/events'
import { AGENTIC_INACTIVITY_TIMEOUT_MS, AGENTIC_REQUEST_TIMEOUT_MS } from '../analysis-timeouts'

/**
 * `CodexAiService` (T29) habla con `codex app-server` vía
 * `./codex-app-server-client.ts` (JSON-RPC 2.0 sobre stdio) — se mockea ESE
 * cliente por completo (nunca el `child_process` real) para simular el
 * handshake real (`initialize`/`initialized`/`account/read`/`thread/start`/
 * `turn/start`) y el stream de notificaciones. La forma de los mensajes está
 * verificada contra `codex app-server` 0.142.x (esquema `generate-ts` + un
 * turno de humo real): los deltas de texto son `item/agentMessage/delta` con
 * `params.delta`, y el fin del turno es la notificación `turn/completed` (NO
 * la resolución de `turn/start`, que es un ack inmediato).
 */
const getEffectiveAiSelectionMock = vi.fn()
vi.mock('../env', () => ({
  getEffectiveAiSelection: (...args: unknown[]) => getEffectiveAiSelectionMock(...args),
}))

/**
 * `ensureSnapshot` (T54) se mockea: los tests de este servicio NO deben
 * pagar una descarga real de GitHub ni tocar disco, solo verificar que el
 * servicio lo llama con `(github, repo, detail.headSha)` y usa lo que
 * devuelve como `cwd` de `thread/start` (T58).
 */
const ensureSnapshotMock = vi.fn()

/**
 * `createAnalysisTimeouts` (T56) se envuelve (NO se reemplaza: se preserva
 * el comportamiento real) solo para capturar con QUÉ `{ totalMs, inactivityMs }`
 * lo llama `CodexAiService` — T58 pide verificar que usa los valores
 * AGÉNTICOS (`AGENTIC_REQUEST_TIMEOUT_MS`/`AGENTIC_INACTIVITY_TIMEOUT_MS`),
 * no los de generación directa.
 */
const createAnalysisTimeoutsCalls: Array<{ totalMs?: number; inactivityMs?: number } | undefined> = []
vi.mock('../analysis-timeouts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../analysis-timeouts')>()
  return {
    ...actual,
    createAnalysisTimeouts: (
      controller: AbortController,
      options?: { totalMs?: number; inactivityMs?: number },
    ) => {
      createAnalysisTimeoutsCalls.push(options)
      return actual.createAnalysisTimeouts(controller, options)
    },
  }
})

interface FakeClientScript {
  requestResults: Map<string, unknown[]>
  requestErrors: Map<string, Error>
  /** Notificaciones que el server emite durante `turn/start`, en orden. Tras emitirlas, el fake cierra el turno con `turn/completed` (salvo que el script ya incluya uno). */
  notifications: Array<{ method: string; params?: unknown }>
}

function makeFakeClientModule(script: FakeClientScript) {
  const requestCalls: Array<{ method: string; params: unknown }> = []
  const notifyCalls: Array<{ method: string; params: unknown }> = []
  let killCalls = 0
  let notificationHandler: ((n: { method: string; params?: unknown }) => void) | null = null

  class FakeCodexAppServerClient {
    request(method: string, params: unknown): Promise<unknown> {
      requestCalls.push({ method, params })
      const error = script.requestErrors.get(method)
      if (error) return Promise.reject(error)

      const queue = script.requestResults.get(method) ?? []
      const result = queue.shift()

      if (method === 'turn/start') {
        // El server real emite las notificaciones del turno (deltas, item/*)
        // y cierra con `turn/completed`; `turn/start` en sí resuelve de
        // inmediato con un ack. Se emiten las scriptadas y, si ninguna cerró
        // el turno, se auto-emite un `turn/completed` exitoso.
        const closesTurn = (n: { method: string }) =>
          n.method === 'turn/completed' || n.method === 'error'
        for (const notification of script.notifications) {
          notificationHandler?.(notification)
        }
        if (!script.notifications.some(closesTurn)) {
          notificationHandler?.({
            method: 'turn/completed',
            params: { threadId: 't-1', turn: { status: 'completed' } },
          })
        }
      }

      return Promise.resolve(result)
    }

    notify(method: string, params: unknown): void {
      notifyCalls.push({ method, params })
    }

    onNotification(handler: (n: { method: string; params?: unknown }) => void): () => void {
      notificationHandler = handler
      return () => {
        notificationHandler = null
      }
    }

    kill(): void {
      killCalls++
    }
  }

  return {
    module: {
      CodexAppServerClient: FakeCodexAppServerClient,
      CodexSpawnError: class CodexSpawnError extends Error {},
      JsonRpcRemoteError: class JsonRpcRemoteError extends Error {
        constructor(
          message: string,
          readonly code: number,
        ) {
          super(message)
        }
      },
    },
    requestCalls,
    notifyCalls,
    getKillCalls: () => killCalls,
  }
}

let currentFake: ReturnType<typeof makeFakeClientModule> | null = null

vi.mock('./codex-app-server-client', () => ({
  get CodexAppServerClient() {
    return currentFake!.module.CodexAppServerClient
  },
  get CodexSpawnError() {
    return currentFake!.module.CodexSpawnError
  },
  get JsonRpcRemoteError() {
    return currentFake!.module.JsonRpcRemoteError
  },
}))

const { CodexAiService } = await import('./codex-service')

function setupFakeClient(script: Partial<FakeClientScript> = {}) {
  const full: FakeClientScript = {
    requestResults: script.requestResults ?? new Map(),
    requestErrors: script.requestErrors ?? new Map(),
    notifications: script.notifications ?? [],
  }
  currentFake = makeFakeClientModule(full)
  return currentFake
}

/** Handshake exitoso completo; thread/start responde la forma real `{ thread: { id } }`. */
function happyPathResults(): Map<string, unknown[]> {
  return new Map<string, unknown[]>([
    ['initialize', [{ userAgent: 'minerva/0.1.0' }]],
    ['account/read', [{ account: { type: 'chatgpt', email: 'edilson@example.com' }, requiresOpenaiAuth: true }]],
    ['thread/start', [{ thread: { id: 't-1' }, model: 'gpt-5.5' }]],
    ['turn/start', [{ turn: { status: 'inProgress' } }]],
  ])
}

/** Delta de texto del asistente, con el método REAL `item/agentMessage/delta`. */
function itemDelta(text: string): { method: string; params: unknown } {
  return { method: 'item/agentMessage/delta', params: { threadId: 't-1', turnId: 'x', itemId: 'y', delta: text } }
}

const repo = {
  provider: 'github' as const,
  owner: 'shopwave',
  name: 'api',
  fullName: 'shopwave/api',
}

const detail: PullRequestDetail = {
  id: 'shopwave/api#482',
  number: 482,
  title: 'Add apply-coupon endpoint',
  author: { login: 'jdoe', avatarUrl: 'https://example.com/a.png' },
  repo,
  state: 'open',
  isDraft: false,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
  headRef: 'feat/apply-coupon',
  baseRef: 'main',
  headSha: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
  webUrl: 'https://github.com/shopwave/api/pull/482',
  commentCount: 0,
  reviewDecision: null,
  ciStatus: 'success',
  additions: 40,
  deletions: 2,
  changedFiles: 2,
  bodyMarkdown: 'Adds a coupon endpoint.',
  labels: [{ name: 'feature', color: '00ff00' }],
  reviewers: [],
  commits: 1,
}

const files: DiffFile[] = [
  {
    path: 'src/routes/carts.ts',
    status: 'modified',
    additions: 30,
    deletions: 2,
    isBinary: false,
    patch: '@@ -1,1 +1,1 @@\n-old\n+new',
  },
]

function makeGithubService(): PrContextSource {
  return {
    getDetail: vi.fn().mockResolvedValue(detail),
    getFiles: vi.fn().mockResolvedValue(files),
    ensureSnapshot: (...args: unknown[]) => ensureSnapshotMock(...args),
  } as unknown as PrContextSource
}

describe('CodexAiService.analyzePullRequest', () => {
  beforeEach(() => {
    getEffectiveAiSelectionMock.mockReturnValue({ provider: 'codex', model: 'gpt-5.5', options: {} })
    ensureSnapshotMock.mockReset()
    ensureSnapshotMock.mockResolvedValue('/home/test-user/.minerva/snapshots/shopwave-api-a1b2c3d')
    createAnalysisTimeoutsCalls.length = 0
  })

  afterEach(() => {
    vi.restoreAllMocks()
    currentFake = null
  })

  it('mapea los deltas de item/agentMessage/delta a DidacticAnalysis y hace el handshake real', async () => {
    const fake = setupFakeClient({
      requestResults: happyPathResults(),
      notifications: [itemDelta('@@@SECTION kind=summary\n'), itemDelta('Resumen del PR\n')],
    })

    const service = new CodexAiService(makeGithubService())
    const result = await service.analyzePullRequest({ repo, number: 482 })

    expect(result.prId).toBe('github:shopwave/api#482')
    expect(result.sections).toEqual([{ kind: 'summary', markdown: 'Resumen del PR' }])
    expect(typeof result.generatedAt).toBe('string')

    const methods = fake.requestCalls.map((c) => c.method)
    expect(methods).toEqual(['initialize', 'account/read', 'thread/start', 'turn/start'])
    expect(fake.notifyCalls).toEqual([{ method: 'initialized', params: undefined }])

    const initCall = fake.requestCalls.find((c) => c.method === 'initialize')!
    expect(initCall.params).toMatchObject({
      clientInfo: { name: 'minerva' },
      capabilities: { experimentalApi: true },
    })

    const threadStartCall = fake.requestCalls.find((c) => c.method === 'thread/start')!
    expect(threadStartCall.params).toEqual({
      model: 'gpt-5.5',
      baseInstructions: expect.any(String),
      // AGÉNTICO (T58): cwd = snapshot local del PR, sandbox/approvalPolicy
      // SIN CAMBIOS (T29).
      cwd: '/home/test-user/.minerva/snapshots/shopwave-api-a1b2c3d',
      sandbox: 'read-only',
      approvalPolicy: 'never',
    })

    const turnStartCall = fake.requestCalls.find((c) => c.method === 'turn/start')!
    expect(turnStartCall.params).toEqual({
      threadId: 't-1',
      input: [
        { type: 'text', text: expect.stringContaining(detail.title), text_elements: [] },
      ],
    })

    // `ensureSnapshot` se llama con el headSha del detail (T58).
    expect(ensureSnapshotMock).toHaveBeenCalledWith(repo, detail.headSha)

    expect(fake.getKillCalls()).toBeGreaterThan(0)
  })

  it('usa los timeouts AGÉNTICOS (300s/60s), no los de generación directa (T58)', async () => {
    setupFakeClient({
      requestResults: happyPathResults(),
      notifications: [itemDelta('@@@SECTION kind=summary\nok\n')],
    })

    const service = new CodexAiService(makeGithubService())
    await service.analyzePullRequest({ repo, number: 482 })

    expect(createAnalysisTimeoutsCalls).toEqual([
      { totalMs: AGENTIC_REQUEST_TIMEOUT_MS, inactivityMs: AGENTIC_INACTIVITY_TIMEOUT_MS },
    ])
  })

  it('resetea el timer de inactividad con notificaciones que no son deltas de texto (item de tool-use, T58)', async () => {
    setupFakeClient({
      requestResults: happyPathResults(),
      notifications: [
        { method: 'item/started', params: { item: { id: 'x', type: 'fileRead' } } },
        { method: 'item/completed', params: { item: { id: 'x', type: 'fileRead' } } },
        itemDelta('@@@SECTION kind=summary\nok\n'),
      ],
    })

    const service = new CodexAiService(makeGithubService())
    const result = await service.analyzePullRequest({ repo, number: 482 })
    // No revienta por inactividad ni pierde contenido: las notificaciones de
    // tool-use (sin delta de texto) igual cuentan como actividad.
    expect(result.sections).toEqual([{ kind: 'summary', markdown: 'ok' }])
  })

  it('llama a onProgress con snapshots parciales y una vez final con done:true', async () => {
    setupFakeClient({
      requestResults: happyPathResults(),
      notifications: [
        itemDelta('@@@SECTION kind=summary\n'),
        itemDelta('primera parte '),
        itemDelta('segunda parte\n'),
      ],
    })

    const progressCalls: Array<[DraftDidacticSection[], { done: boolean }]> = []
    const service = new CodexAiService(makeGithubService())
    const result = await service.analyzePullRequest(
      { repo, number: 482 },
      { onProgress: (sections, meta) => progressCalls.push([sections, meta]) },
    )

    expect(result.sections).toEqual([{ kind: 'summary', markdown: 'primera parte segunda parte' }])
    expect(progressCalls.length).toBeGreaterThan(0)

    const [lastSections, lastMeta] = progressCalls[progressCalls.length - 1]
    expect(lastMeta.done).toBe(true)
    expect(lastSections).toEqual(result.sections)
    expect(progressCalls.slice(0, -1).every(([, meta]) => meta.done === false)).toBe(true)
  })

  it('emite onProgress con phase:"exploring" ante actividad item/* ANTES del primer delta de texto (T60)', async () => {
    setupFakeClient({
      requestResults: happyPathResults(),
      notifications: [
        { method: 'item/started', params: { item: { id: 'x', type: 'fileRead' } } },
        itemDelta('@@@SECTION kind=summary\nok\n'),
      ],
    })

    const progressCalls: Array<[DraftDidacticSection[], { done: boolean; phase?: 'exploring' | 'writing' }]> = []
    const service = new CodexAiService(makeGithubService())
    const result = await service.analyzePullRequest(
      { repo, number: 482 },
      { onProgress: (sections, meta) => progressCalls.push([sections, meta]) },
    )

    // La PRIMERA llamada a onProgress es el EDGE del mini-log (F13): el
    // `item/started` abre una fila running y eso emite SIN throttle, ANTES
    // de que llegue ningún delta de texto: fase "exploring" con secciones
    // todavía vacías. El label es el genérico ("Leyendo un archivo…"):
    // los items verificados solo traen { id, type }, sin ruta.
    const [firstSections, firstMeta] = progressCalls[0]
    expect(firstMeta).toEqual({
      done: false,
      phase: 'exploring',
      activity: [{ id: 'x', kind: 'read', label: 'Leyendo un archivo…', status: 'running' }],
    })
    expect(firstSections).toEqual([])

    // El resultado final sí incluye el contenido del delta posterior.
    expect(result.sections).toEqual([{ kind: 'summary', markdown: 'ok' }])
  })

  it('mini-log (F13): item/started + item/completed colapsan en una fila running→done; el terminal no trae actividad', async () => {
    setupFakeClient({
      requestResults: happyPathResults(),
      notifications: [
        { method: 'item/started', params: { item: { id: 'x', type: 'fileRead' } } },
        { method: 'item/completed', params: { item: { id: 'x', type: 'fileRead' } } },
        itemDelta('@@@SECTION kind=summary\nok\n'),
      ],
    })

    const progressCalls: Array<
      [
        DraftDidacticSection[],
        { done: boolean; activity?: Array<{ id: string; label: string; status: string }> },
      ]
    > = []
    const service = new CodexAiService(makeGithubService())
    await service.analyzePullRequest(
      { repo, number: 482 },
      { onProgress: (sections, meta) => progressCalls.push([sections, meta]) },
    )

    // Edge 1 (begin) y edge 2 (complete), ambos SIN throttle aunque lleguen
    // pegados: MISMA fila (mismo id, colapso por identidad).
    expect(progressCalls[0][1].activity).toEqual([
      { id: 'x', kind: 'read', label: 'Leyendo un archivo…', status: 'running' },
    ])
    const doneCall = progressCalls.find(([, meta]) => meta.activity?.[0]?.status === 'done')
    expect(doneCall?.[1].activity).toEqual([
      { id: 'x', kind: 'read', label: 'Leyó un archivo', status: 'done' },
    ])
    const [, lastMeta] = progressCalls[progressCalls.length - 1]
    expect(lastMeta.done).toBe(true)
    expect(lastMeta.activity).toBeUndefined()
  })

  it('mini-log (F13): item/reasoning/textDelta repetidos son UNA fila "Pensando…" y los items agentMessage se saltan', async () => {
    setupFakeClient({
      requestResults: happyPathResults(),
      notifications: [
        { method: 'item/reasoning/textDelta', params: { delta: 'pensando en secreto...' } },
        { method: 'item/reasoning/textDelta', params: { delta: 'más pensamiento' } },
        { method: 'item/started', params: { item: { id: 'msg-1', type: 'agentMessage' } } },
        itemDelta('@@@SECTION kind=summary\nok\n'),
      ],
    })

    const progressCalls: Array<
      [DraftDidacticSection[], { done: boolean; activity?: Array<{ label: string; status: string }> }]
    > = []
    const service = new CodexAiService(makeGithubService())
    await service.analyzePullRequest(
      { repo, number: 482 },
      { onProgress: (sections, meta) => progressCalls.push([sections, meta]) },
    )

    // Una sola fila "Pensando…" (deltas repetidos = no-op, el texto del
    // razonamiento jamás viaja) y NINGUNA fila por el item agentMessage.
    const withActivity = progressCalls.filter(([, meta]) => !meta.done && meta.activity?.length)
    expect(withActivity.length).toBeGreaterThan(0)
    for (const [, meta] of withActivity) {
      expect(meta.activity).toHaveLength(1)
      expect(meta.activity?.[0].label).toMatch(/^Pens/)
    }
  })

  it('ignora notificaciones de razonamiento y las que no son agentMessage delta', async () => {
    setupFakeClient({
      requestResults: happyPathResults(),
      notifications: [
        { method: 'item/reasoning/textDelta', params: { delta: 'pensando...' } },
        { method: 'item/started', params: { item: { id: 'x' } } },
        { method: 'item/plan/delta', params: { delta: 'plan interno' } },
        itemDelta('@@@SECTION kind=summary\nok\n'),
      ],
    })

    const service = new CodexAiService(makeGithubService())
    const result = await service.analyzePullRequest({ repo, number: 482 })
    expect(result.sections).toEqual([{ kind: 'summary', markdown: 'ok' }])
  })

  it('reconstruye una sección aunque el delta llegue partido en varios chunks', async () => {
    setupFakeClient({
      requestResults: happyPathResults(),
      notifications: [
        itemDelta('@@@SEC'),
        itemDelta('TION kind=sum'),
        itemDelta('mary\nhola '),
        itemDelta('mundo\n'),
      ],
    })

    const service = new CodexAiService(makeGithubService())
    const result = await service.analyzePullRequest({ repo, number: 482 })
    expect(result.sections).toEqual([{ kind: 'summary', markdown: 'hola mundo' }])
  })

  it('rechaza el turno ante una notificación de error del servidor', async () => {
    setupFakeClient({
      requestResults: happyPathResults(),
      notifications: [
        itemDelta('@@@SECTION kind=summary\nparcial\n'),
        { method: 'error', params: { message: 'stream interrumpido' } },
      ],
    })

    const service = new CodexAiService(makeGithubService())
    await expect(service.analyzePullRequest({ repo, number: 482 })).rejects.toThrow('stream interrumpido')
  })

  it('lanza un mensaje accionable de login cuando account/read rechaza', async () => {
    const results = happyPathResults()
    results.delete('account/read')
    setupFakeClient({
      requestResults: results,
      requestErrors: new Map([['account/read', new Error('unauthorized')]]),
    })

    const service = new CodexAiService(makeGithubService())
    await expect(service.analyzePullRequest({ repo, number: 482 })).rejects.toThrow('codex login')
  })

  it('lanza un mensaje accionable de login cuando account/read resuelve sin cuenta', async () => {
    const results = happyPathResults()
    results.set('account/read', [{ account: null, requiresOpenaiAuth: true }])
    setupFakeClient({ requestResults: results })

    const service = new CodexAiService(makeGithubService())
    await expect(service.analyzePullRequest({ repo, number: 482 })).rejects.toThrow('codex login')
  })

  it('lanza si el turno no emite ningún delta de texto', async () => {
    setupFakeClient({ requestResults: happyPathResults(), notifications: [] })

    const service = new CodexAiService(makeGithubService())
    await expect(service.analyzePullRequest({ repo, number: 482 })).rejects.toThrow(
      'no devolvió contenido de streaming',
    )
  })

  it('lanza si todas las secciones emitidas son inválidas', async () => {
    setupFakeClient({
      requestResults: happyPathResults(),
      notifications: [itemDelta('@@@SECTION kind=nope\ncontenido\n')],
    })

    const service = new CodexAiService(makeGithubService())
    await expect(service.analyzePullRequest({ repo, number: 482 })).rejects.toThrow('Ninguna sección')
  })

  it('agrega "effort" a los params de turn/start cuando la selección efectiva trae uno (T36)', async () => {
    getEffectiveAiSelectionMock.mockReturnValue({
      provider: 'codex',
      model: 'gpt-5.5',
      options: { effort: 'high' },
    })
    const fake = setupFakeClient({
      requestResults: happyPathResults(),
      notifications: [itemDelta('@@@SECTION kind=summary\nok\n')],
    })

    const service = new CodexAiService(makeGithubService())
    await service.analyzePullRequest({ repo, number: 482 })

    const turnStartCall = fake.requestCalls.find((c) => c.method === 'turn/start')!
    expect(turnStartCall.params).toEqual({
      threadId: 't-1',
      input: [{ type: 'text', text: expect.stringContaining(detail.title), text_elements: [] }],
      effort: 'high',
    })
  })

  it('NO manda "effort" en turn/start cuando la selección efectiva no trae uno (sin regresión)', async () => {
    getEffectiveAiSelectionMock.mockReturnValue({ provider: 'codex', model: 'gpt-5.5', options: {} })
    const fake = setupFakeClient({
      requestResults: happyPathResults(),
      notifications: [itemDelta('@@@SECTION kind=summary\nok\n')],
    })

    const service = new CodexAiService(makeGithubService())
    await service.analyzePullRequest({ repo, number: 482 })

    const turnStartCall = fake.requestCalls.find((c) => c.method === 'turn/start')!
    expect(turnStartCall.params).not.toHaveProperty('effort')
  })

  it('siempre mata el proceso hijo, incluso en el camino de error', async () => {
    const fake = setupFakeClient({
      requestResults: new Map(),
      requestErrors: new Map([['initialize', new Error('spawn falló')]]),
    })

    const service = new CodexAiService(makeGithubService())
    await expect(service.analyzePullRequest({ repo, number: 482 })).rejects.toThrow()
    expect(fake.getKillCalls()).toBeGreaterThan(0)
  })
})
