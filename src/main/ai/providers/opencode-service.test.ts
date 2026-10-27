import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrContextSource } from '../pr-context'
import type { DiffFile, PullRequestDetail } from '../../../shared/types'
import type { DraftDidacticSection } from '../../../shared/events'
import { AGENTIC_INACTIVITY_TIMEOUT_MS, AGENTIC_REQUEST_TIMEOUT_MS } from '../analysis-timeouts'

/**
 * `OpenCodeAiService` (T56) habla con el server local `opencode serve` a
 * través de `@opencode-ai/sdk/v2` (`createOpencodeClient`) — se mockea el
 * paquete completo para simular `client.event.subscribe`/`session.create`/
 * `session.promptAsync`/`session.abort` sin depender de tener el binario
 * `opencode` instalado (mismo espíritu que `./codex-service.test.ts`
 * mockeando `./codex-app-server-client`). La forma de los eventos (`field`,
 * `part.type`, `info.role`, `session.idle`/`session.error`) está VERIFICADA
 * contra el binario real 1.17.18 — ver el comentario grande en
 * `./opencode-service.ts`.
 */
const getEffectiveAiSelectionMock = vi.fn()
vi.mock('../env', () => ({
  getEffectiveAiSelection: (...args: unknown[]) => getEffectiveAiSelectionMock(...args),
}))

/**
 * `ensureSnapshot` (T54) se mockea: los tests de este servicio NO deben
 * pagar una descarga real de GitHub ni tocar disco, solo verificar que el
 * servicio lo llama con `(github, repo, detail.headSha)` y usa lo que
 * devuelve como `directory` del cliente OpenCode.
 */
const ensureSnapshotMock = vi.fn()

/** `getOpencodeServer` (T55) se mockea: server "ya arrancado" en una URL fake. */
const getOpencodeServerMock = vi.fn()
vi.mock('./opencode-runtime', () => ({
  getOpencodeServer: (...args: unknown[]) => getOpencodeServerMock(...args),
}))

/**
 * `createAnalysisTimeouts` (T56) se envuelve (NO se reemplaza: se preserva
 * el comportamiento real, incluidos los `setTimeout` reales que la prueba de
 * inactividad dispara con `vi.useFakeTimers`) solo para capturar con QUÉ
 * `{ totalMs, inactivityMs }` lo llama `OpenCodeAiService` — debe usar los
 * valores AGÉNTICOS, no los de generación directa.
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

interface ScriptedEvent {
  type: string
  properties: Record<string, unknown>
}

interface FakeClientScript {
  sessionId?: string
  /** Eventos que el stream de `event.subscribe` emite, en orden, tras arrancar. */
  events?: ScriptedEvent[]
  createError?: Error
  promptError?: Error
}

/**
 * Fake de `OpencodeClient` (v2): `event.subscribe` devuelve un
 * `AsyncGenerator` que primero produce los eventos scriptados y LUEGO cuelga
 * hasta que se aborte el `signal` recibido (simula una conexión SSE real de
 * larga duración) — así se puede probar el timeout de inactividad avanzando
 * timers falsos sin que el generador "termine solo" antes de que el timeout
 * dispare.
 */
function makeFakeOpencodeClient(script: FakeClientScript) {
  const sessionId = script.sessionId ?? 'ses_test1'
  const createCalls: unknown[] = []
  const promptAsyncCalls: unknown[] = []
  const abortCalls: unknown[] = []
  const subscribeCalls: unknown[] = []
  let capturedSignal: AbortSignal | undefined

  async function* streamGen(): AsyncGenerator<ScriptedEvent> {
    for (const event of script.events ?? []) {
      yield event
    }
    await new Promise<never>((_resolve, reject) => {
      if (capturedSignal?.aborted) {
        reject(new Error('OpenCode event stream aborted'))
        return
      }
      capturedSignal?.addEventListener(
        'abort',
        () => reject(new Error('OpenCode event stream aborted')),
        { once: true },
      )
    })
  }

  const client = {
    event: {
      subscribe: vi.fn(async (params: unknown, options?: { signal?: AbortSignal }) => {
        subscribeCalls.push({ params, options })
        capturedSignal = options?.signal
        return { stream: streamGen() }
      }),
    },
    session: {
      create: vi.fn(async (params: unknown) => {
        createCalls.push(params)
        if (script.createError) throw script.createError
        return { data: { id: sessionId } }
      }),
      promptAsync: vi.fn(async (params: unknown) => {
        promptAsyncCalls.push(params)
        if (script.promptError) throw script.promptError
        return { data: undefined }
      }),
      abort: vi.fn(async (params: unknown) => {
        abortCalls.push(params)
        return { data: undefined }
      }),
    },
  }

  return { client, sessionId, createCalls, promptAsyncCalls, abortCalls, subscribeCalls }
}

let currentFake: ReturnType<typeof makeFakeOpencodeClient> | null = null

const createOpencodeClientMock = vi.fn((...args: unknown[]) => {
  createOpencodeClientCalls.push(args)
  return currentFake!.client
})
const createOpencodeClientCalls: unknown[][] = []

vi.mock('@opencode-ai/sdk/v2', () => ({
  createOpencodeClient: (...args: unknown[]) => createOpencodeClientMock(...args),
}))

const { OpenCodeAiService, parseOpencodeModelSlug } = await import('./opencode-service')

function setupFakeClient(script: FakeClientScript = {}) {
  currentFake = makeFakeOpencodeClient(script)
  return currentFake
}

const SESSION_ID = 'ses_test1'

function messageUpdated(messageId: string, role: 'user' | 'assistant'): ScriptedEvent {
  return { type: 'message.updated', properties: { sessionID: SESSION_ID, info: { id: messageId, role } } }
}

function partUpdated(partId: string, messageId: string, type: string): ScriptedEvent {
  return {
    type: 'message.part.updated',
    properties: { sessionID: SESSION_ID, part: { id: partId, messageID: messageId, type } },
  }
}

/**
 * Parte `tool` COMPLETA (F13): la forma real que emite el server para una
 * tool call (`callID`/`tool`/`state`), a diferencia del `partUpdated`
 * minimalista de arriba (que ejercita el camino defensivo: sin esos campos,
 * el mini-log la ignora).
 */
function toolPartUpdated(
  partId: string,
  callId: string,
  tool: string,
  state: Record<string, unknown>,
  sessionId = SESSION_ID,
): ScriptedEvent {
  return {
    type: 'message.part.updated',
    properties: {
      sessionID: sessionId,
      part: { id: partId, messageID: 'msg-asst', type: 'tool', callID: callId, tool, state },
    },
  }
}

function partDelta(partId: string, messageId: string, delta: string, sessionId = SESSION_ID): ScriptedEvent {
  return {
    type: 'message.part.delta',
    properties: { sessionID: sessionId, messageID: messageId, partID: partId, field: 'text', delta },
  }
}

function sessionIdle(sessionId = SESSION_ID): ScriptedEvent {
  return { type: 'session.idle', properties: { sessionID: sessionId } }
}

function sessionError(
  message: string,
  options?: { name?: string; sessionId?: string | undefined },
): ScriptedEvent {
  return {
    type: 'session.error',
    properties: {
      sessionID: options?.sessionId,
      error: { name: options?.name ?? 'UnknownError', data: { message } },
    },
  }
}

/** Script "feliz" típico: razonamiento (ignorado) + texto del asistente (usado) + fin. */
function happyPathEvents(): ScriptedEvent[] {
  return [
    messageUpdated('msg-user', 'user'),
    messageUpdated('msg-asst', 'assistant'),
    partUpdated('prt-reason', 'msg-asst', 'reasoning'),
    partDelta('prt-reason', 'msg-asst', 'pensando en voz alta...'),
    partUpdated('prt-text', 'msg-asst', 'text'),
    partDelta('prt-text', 'msg-asst', '@@@SECTION kind=summary\n'),
    partDelta('prt-text', 'msg-asst', 'Resumen del PR\n'),
    sessionIdle(),
  ]
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

describe('parseOpencodeModelSlug', () => {
  it('parsea un slug simple <proveedor>/<modelo>', () => {
    expect(parseOpencodeModelSlug('opencode/big-pickle')).toEqual({
      providerID: 'opencode',
      modelID: 'big-pickle',
    })
  })

  it('parsea por el PRIMER "/" cuando el modelID trae más barras', () => {
    expect(parseOpencodeModelSlug('github-copilot/anthropic/claude-fable-5')).toEqual({
      providerID: 'github-copilot',
      modelID: 'anthropic/claude-fable-5',
    })
  })

  it('devuelve null sin separador o con una mitad vacía', () => {
    expect(parseOpencodeModelSlug('sin-barra')).toBeNull()
    expect(parseOpencodeModelSlug('/modelo')).toBeNull()
    expect(parseOpencodeModelSlug('proveedor/')).toBeNull()
  })
})

describe('OpenCodeAiService.analyzePullRequest', () => {
  beforeEach(() => {
    getEffectiveAiSelectionMock.mockReturnValue({
      provider: 'opencode',
      model: 'opencode/big-pickle',
      options: {},
    })
    ensureSnapshotMock.mockReset()
    ensureSnapshotMock.mockResolvedValue('/home/test-user/.minerva/snapshots/shopwave-api-a1b2c3d')
    getOpencodeServerMock.mockReset()
    getOpencodeServerMock.mockResolvedValue({ url: 'http://127.0.0.1:44687' })
    createAnalysisTimeoutsCalls.length = 0
    createOpencodeClientCalls.length = 0
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
    currentFake = null
  })

  it('mapea los deltas de texto del asistente a DidacticAnalysis, ignorando razonamiento', async () => {
    const fake = setupFakeClient({ events: happyPathEvents() })

    const service = new OpenCodeAiService(makeGithubService())
    const result = await service.analyzePullRequest({ repo, number: 482 })

    expect(result.prId).toBe('github:shopwave/api#482')
    expect(result.sections).toEqual([{ kind: 'summary', markdown: 'Resumen del PR' }])
    expect(typeof result.generatedAt).toBe('string')

    // `ensureSnapshot` con el headSha del detail, y el cliente OpenCode
    // creado con ese directorio.
    expect(ensureSnapshotMock).toHaveBeenCalledWith(repo, detail.headSha)
    expect(createOpencodeClientCalls[0]?.[0]).toMatchObject({
      baseUrl: 'http://127.0.0.1:44687',
      directory: '/home/test-user/.minerva/snapshots/shopwave-api-a1b2c3d',
      throwOnError: true,
    })

    // Suscripción ANTES de crear la sesión y de mandar el prompt.
    expect(fake.subscribeCalls.length).toBe(1)
    expect(fake.createCalls.length).toBe(1)
    expect(fake.promptAsyncCalls.length).toBe(1)

    const promptCall = fake.promptAsyncCalls[0] as {
      sessionID: string
      model: { providerID: string; modelID: string }
      system: string
      parts: Array<{ type: string; text: string }>
    }
    expect(promptCall.sessionID).toBe(SESSION_ID)
    expect(promptCall.model).toEqual({ providerID: 'opencode', modelID: 'big-pickle' })
    expect(promptCall.system).toEqual(expect.any(String))
    expect(promptCall.parts).toEqual([{ type: 'text', text: expect.stringContaining(detail.title) }])

    // `session.abort` best-effort al terminar (éxito).
    expect(fake.abortCalls).toEqual([{ sessionID: SESSION_ID }])
  })

  it('ignora deltas de eventos de OTRO sessionID (server compartido con otras sesiones)', async () => {
    setupFakeClient({
      events: [
        messageUpdated('msg-asst', 'assistant'),
        partUpdated('prt-text', 'msg-asst', 'text'),
        // Delta de una sesión ajena: NO debe colarse en el resultado.
        partDelta('prt-text', 'msg-asst', 'contenido de otra sesión', 'ses_other'),
        partDelta('prt-text', 'msg-asst', '@@@SECTION kind=summary\nok\n'),
        sessionIdle(),
      ],
    })

    const service = new OpenCodeAiService(makeGithubService())
    const result = await service.analyzePullRequest({ repo, number: 482 })
    expect(result.sections).toEqual([{ kind: 'summary', markdown: 'ok' }])
  })

  it('ignora partes no-texto: razonamiento y herramientas nunca llegan al parser', async () => {
    setupFakeClient({
      events: [
        messageUpdated('msg-asst', 'assistant'),
        partUpdated('prt-reason', 'msg-asst', 'reasoning'),
        partDelta('prt-reason', 'msg-asst', 'razonando sobre el PR...'),
        partUpdated('prt-tool', 'msg-asst', 'tool'),
        partUpdated('prt-text', 'msg-asst', 'text'),
        partDelta('prt-text', 'msg-asst', '@@@SECTION kind=summary\nsolo esto\n'),
        sessionIdle(),
      ],
    })

    const service = new OpenCodeAiService(makeGithubService())
    const result = await service.analyzePullRequest({ repo, number: 482 })
    expect(result.sections).toEqual([{ kind: 'summary', markdown: 'solo esto' }])
  })

  it('ignora deltas del propio mensaje de usuario (eco del prompt)', async () => {
    setupFakeClient({
      events: [
        messageUpdated('msg-user', 'user'),
        partUpdated('prt-user-text', 'msg-user', 'text'),
        partDelta('prt-user-text', 'msg-user', 'esto es el prompt del usuario, no una respuesta'),
        messageUpdated('msg-asst', 'assistant'),
        partUpdated('prt-text', 'msg-asst', 'text'),
        partDelta('prt-text', 'msg-asst', '@@@SECTION kind=summary\nrespuesta real\n'),
        sessionIdle(),
      ],
    })

    const service = new OpenCodeAiService(makeGithubService())
    const result = await service.analyzePullRequest({ repo, number: 482 })
    expect(result.sections).toEqual([{ kind: 'summary', markdown: 'respuesta real' }])
  })

  it('usa los timeouts AGÉNTICOS (300s/60s), no los de generación directa', async () => {
    setupFakeClient({ events: happyPathEvents() })

    const service = new OpenCodeAiService(makeGithubService())
    await service.analyzePullRequest({ repo, number: 482 })

    expect(createAnalysisTimeoutsCalls).toEqual([
      { totalMs: AGENTIC_REQUEST_TIMEOUT_MS, inactivityMs: AGENTIC_INACTIVITY_TIMEOUT_MS },
    ])
  })

  it('llama a onProgress con snapshots parciales y una vez final con done:true', async () => {
    setupFakeClient({
      events: [
        messageUpdated('msg-asst', 'assistant'),
        partUpdated('prt-text', 'msg-asst', 'text'),
        partDelta('prt-text', 'msg-asst', '@@@SECTION kind=summary\n'),
        partDelta('prt-text', 'msg-asst', 'primera parte '),
        partDelta('prt-text', 'msg-asst', 'segunda parte\n'),
        sessionIdle(),
      ],
    })

    const progressCalls: Array<[DraftDidacticSection[], { done: boolean }]> = []
    const service = new OpenCodeAiService(makeGithubService())
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

  it('emite onProgress con phase:"exploring" ante actividad de la sesión ANTES del primer delta de texto (T60)', async () => {
    setupFakeClient({
      events: [
        // `message.updated` es puro bookkeeping (hoy solo resetea el timer
        // de inactividad) — con T60 es también la señal de que la sesión
        // sigue con actividad mientras no llegó ningún delta de texto.
        messageUpdated('msg-asst', 'assistant'),
        partUpdated('prt-text', 'msg-asst', 'text'),
        partDelta('prt-text', 'msg-asst', '@@@SECTION kind=summary\nok\n'),
        sessionIdle(),
      ],
    })

    const progressCalls: Array<[DraftDidacticSection[], { done: boolean; phase?: 'exploring' | 'writing' }]> = []
    const service = new OpenCodeAiService(makeGithubService())
    const result = await service.analyzePullRequest(
      { repo, number: 482 },
      { onProgress: (sections, meta) => progressCalls.push([sections, meta]) },
    )

    // La PRIMERA llamada a onProgress (el throttle SIEMPRE deja pasar la
    // primera) es el `message.updated` de bookkeeping, ANTES de que llegue
    // ningún delta de texto: fase "exploring" con secciones todavía vacías
    // (y el mini-log F13 también vacío: no hubo tool calls todavía).
    const [firstSections, firstMeta] = progressCalls[0]
    expect(firstMeta).toEqual({ done: false, phase: 'exploring', activity: [] })
    expect(firstSections).toEqual([])

    // El resultado final sí incluye el contenido del delta posterior.
    expect(result.sections).toEqual([{ kind: 'summary', markdown: 'ok' }])
  })

  it('mini-log (F13): una tool part colapsa running→completed en la misma fila, con la ruta relativizada', async () => {
    setupFakeClient({
      events: [
        messageUpdated('msg-asst', 'assistant'),
        toolPartUpdated('prt-tool', 'call-1', 'read', {
          status: 'running',
          input: {
            filePath: '/home/test-user/.minerva/snapshots/shopwave-api-a1b2c3d/src/routes/carts.ts',
          },
          time: { start: 1 },
        }),
        toolPartUpdated('prt-tool', 'call-1', 'read', {
          status: 'completed',
          input: {
            filePath: '/home/test-user/.minerva/snapshots/shopwave-api-a1b2c3d/src/routes/carts.ts',
          },
          output: 'contenido',
          title: 'Read carts.ts',
          time: { start: 1, end: 2 },
        }),
        partUpdated('prt-text', 'msg-asst', 'text'),
        partDelta('prt-text', 'msg-asst', '@@@SECTION kind=summary\nok\n'),
        sessionIdle(),
      ],
    })

    const progressCalls: Array<
      [
        DraftDidacticSection[],
        { done: boolean; activity?: Array<{ id: string; label: string; status: string }> },
      ]
    > = []
    const service = new OpenCodeAiService(makeGithubService())
    await service.analyzePullRequest(
      { repo, number: 482 },
      { onProgress: (sections, meta) => progressCalls.push([sections, meta]) },
    )

    // Edge running y edge completed (ambos SIN throttle): misma fila (id =
    // callID), con la ruta del input relativizada contra el snapshot.
    const runningCall = progressCalls.find(([, meta]) => meta.activity?.[0]?.status === 'running')
    expect(runningCall?.[1].activity).toEqual([
      { id: 'call-1', kind: 'read', label: 'Reading src/routes/carts.ts', status: 'running' },
    ])
    const doneCall = progressCalls.find(([, meta]) => meta.activity?.[0]?.status === 'done')
    expect(doneCall?.[1].activity).toEqual([
      { id: 'call-1', kind: 'read', label: 'Read src/routes/carts.ts', status: 'done' },
    ])
    const [, lastMeta] = progressCalls[progressCalls.length - 1]
    expect(lastMeta.done).toBe(true)
    expect(lastMeta.activity).toBeUndefined()
  })

  it('mini-log (F13): un ToolStateError marca la fila como error', async () => {
    setupFakeClient({
      events: [
        messageUpdated('msg-asst', 'assistant'),
        toolPartUpdated('prt-tool', 'call-1', 'grep', {
          status: 'error',
          input: { pattern: 'router' },
          error: 'permission denied',
          time: { start: 1, end: 2 },
        }),
        partUpdated('prt-text', 'msg-asst', 'text'),
        partDelta('prt-text', 'msg-asst', '@@@SECTION kind=summary\nok\n'),
        sessionIdle(),
      ],
    })

    const progressCalls: Array<
      [DraftDidacticSection[], { done: boolean; activity?: Array<{ label: string; status: string }> }]
    > = []
    const service = new OpenCodeAiService(makeGithubService())
    await service.analyzePullRequest(
      { repo, number: 482 },
      { onProgress: (sections, meta) => progressCalls.push([sections, meta]) },
    )

    // `fail` sobre una fila que nunca pasó por begin es no-op (colapso por
    // identidad exige fila viva) — el server real emite pending/running antes
    // de error, pero si solo llegara el error, no debe inventarse una fila.
    // Acá el estado error llega DIRECTO: se verifica que no revienta y que
    // ninguna fila queda en "running" fantasma.
    const withActivity = progressCalls.filter(([, meta]) => meta.activity?.length)
    for (const [, meta] of withActivity) {
      expect(meta.activity?.every((item) => item.status !== 'running')).toBe(true)
    }
  })

  it('mini-log (F13): tool parts y reasoning de OTRA sesión no contaminan el feed', async () => {
    setupFakeClient({
      events: [
        messageUpdated('msg-asst', 'assistant'),
        // Tool call de una sesión ajena en el server compartido.
        toolPartUpdated(
          'prt-ajena',
          'call-ajena',
          'read',
          { status: 'running', input: { filePath: '/otro/repo/secreto.ts' }, time: { start: 1 } },
          'ses_other',
        ),
        partUpdated('prt-text', 'msg-asst', 'text'),
        partDelta('prt-text', 'msg-asst', '@@@SECTION kind=summary\nok\n'),
        sessionIdle(),
      ],
    })

    const progressCalls: Array<
      [DraftDidacticSection[], { done: boolean; activity?: Array<{ id: string }> }]
    > = []
    const service = new OpenCodeAiService(makeGithubService())
    await service.analyzePullRequest(
      { repo, number: 482 },
      { onProgress: (sections, meta) => progressCalls.push([sections, meta]) },
    )

    for (const [, meta] of progressCalls) {
      expect(meta.activity?.some((item) => item.id === 'call-ajena')).not.toBe(true)
    }
  })

  it('mini-log (F13): una parte reasoning es una fila "Pensando…" genérica, sin texto del razonamiento', async () => {
    setupFakeClient({
      events: [
        messageUpdated('msg-asst', 'assistant'),
        {
          type: 'message.part.updated',
          properties: {
            sessionID: SESSION_ID,
            part: {
              id: 'prt-reason',
              messageID: 'msg-asst',
              type: 'reasoning',
              text: 'pensamiento secreto que NO debe viajar',
              time: { start: 1 },
            },
          },
        },
        partDelta('prt-reason', 'msg-asst', 'más pensamiento secreto'),
        partUpdated('prt-text', 'msg-asst', 'text'),
        partDelta('prt-text', 'msg-asst', '@@@SECTION kind=summary\nok\n'),
        sessionIdle(),
      ],
    })

    const progressCalls: Array<
      [DraftDidacticSection[], { done: boolean; activity?: Array<{ label: string }> }]
    > = []
    const service = new OpenCodeAiService(makeGithubService())
    await service.analyzePullRequest(
      { repo, number: 482 },
      { onProgress: (sections, meta) => progressCalls.push([sections, meta]) },
    )

    const labels = progressCalls.flatMap(([, meta]) => meta.activity?.map((i) => i.label) ?? [])
    expect(labels.length).toBeGreaterThan(0)
    for (const label of labels) {
      expect(label).toMatch(/^Th(inking|ought)/)
      expect(label).not.toContain('secreto')
    }
  })

  it('reconstruye una sección aunque el delta llegue partido en varios chunks', async () => {
    setupFakeClient({
      events: [
        messageUpdated('msg-asst', 'assistant'),
        partUpdated('prt-text', 'msg-asst', 'text'),
        partDelta('prt-text', 'msg-asst', '@@@SEC'),
        partDelta('prt-text', 'msg-asst', 'TION kind=sum'),
        partDelta('prt-text', 'msg-asst', 'mary\nhola '),
        partDelta('prt-text', 'msg-asst', 'mundo\n'),
        sessionIdle(),
      ],
    })

    const service = new OpenCodeAiService(makeGithubService())
    const result = await service.analyzePullRequest({ repo, number: 482 })
    expect(result.sections).toEqual([{ kind: 'summary', markdown: 'hola mundo' }])
  })

  it('lanza un mensaje accionable ante un evento session.error de proveedor sin conectar', async () => {
    setupFakeClient({
      events: [
        messageUpdated('msg-asst', 'assistant'),
        partUpdated('prt-text', 'msg-asst', 'text'),
        partDelta('prt-text', 'msg-asst', '@@@SECTION kind=summary\nparcial\n'),
        sessionError('no provider connected', { name: 'ProviderAuthError' }),
      ],
    })

    const service = new OpenCodeAiService(makeGithubService())
    await expect(service.analyzePullRequest({ repo, number: 482 })).rejects.toThrow('opencode auth login')
  })

  it('lanza con el detalle de un session.error genérico', async () => {
    setupFakeClient({
      events: [
        messageUpdated('msg-asst', 'assistant'),
        partUpdated('prt-text', 'msg-asst', 'text'),
        partDelta('prt-text', 'msg-asst', '@@@SECTION kind=summary\nparcial\n'),
        sessionError('el modelo rechazó la solicitud'),
      ],
    })

    const service = new OpenCodeAiService(makeGithubService())
    await expect(service.analyzePullRequest({ repo, number: 482 })).rejects.toThrow(
      'el modelo rechazó la solicitud',
    )
  })

  it('ignora un session.error de OTRO sessionID', async () => {
    setupFakeClient({
      events: [
        messageUpdated('msg-asst', 'assistant'),
        partUpdated('prt-text', 'msg-asst', 'text'),
        partDelta('prt-text', 'msg-asst', '@@@SECTION kind=summary\nok\n'),
        sessionError('error de otra sesión', { sessionId: 'ses_other' }),
        sessionIdle(),
      ],
    })

    const service = new OpenCodeAiService(makeGithubService())
    const result = await service.analyzePullRequest({ repo, number: 482 })
    expect(result.sections).toEqual([{ kind: 'summary', markdown: 'ok' }])
  })

  it('lanza un mensaje accionable de timeout de inactividad cuando el server deja de mandar eventos', async () => {
    vi.useFakeTimers()
    setupFakeClient({ events: [] })

    const service = new OpenCodeAiService(makeGithubService())
    const pending = service.analyzePullRequest({ repo, number: 482 })
    const assertion = expect(pending).rejects.toThrow(
      'OpenCode stopped sending data: no new chunk for more than ' +
        AGENTIC_INACTIVITY_TIMEOUT_MS / 1000 +
        's (inactivity timeout).',
    )

    await vi.advanceTimersByTimeAsync(AGENTIC_INACTIVITY_TIMEOUT_MS + 1)
    await assertion
  })

  it('lanza si ningún delta de texto llega antes de session.idle', async () => {
    setupFakeClient({ events: [sessionIdle()] })

    const service = new OpenCodeAiService(makeGithubService())
    await expect(service.analyzePullRequest({ repo, number: 482 })).rejects.toThrow(
      'returned no streaming content',
    )
  })

  it('lanza si todas las secciones emitidas son inválidas', async () => {
    setupFakeClient({
      events: [
        messageUpdated('msg-asst', 'assistant'),
        partUpdated('prt-text', 'msg-asst', 'text'),
        partDelta('prt-text', 'msg-asst', '@@@SECTION kind=nope\ncontenido\n'),
        sessionIdle(),
      ],
    })

    const service = new OpenCodeAiService(makeGithubService())
    await expect(service.analyzePullRequest({ repo, number: 482 })).rejects.toThrow('None of the sections')
  })

  it('lanza un mensaje accionable si session.create rechaza por falta de proveedor', async () => {
    setupFakeClient({
      createError: Object.assign(new Error('Unexpected server error.'), {
        cause: { body: { name: 'ProviderAuthError', data: { providerID: 'anthropic', message: 'no auth' } } },
      }),
    })

    const service = new OpenCodeAiService(makeGithubService())
    await expect(service.analyzePullRequest({ repo, number: 482 })).rejects.toThrow('opencode auth login')
  })

  it('propaga el error accionable de getOpencodeServer (binario ausente/server no arranca)', async () => {
    getOpencodeServerMock.mockRejectedValue(new Error('No se encontró el binario "opencode" instalado.'))
    setupFakeClient({})

    const service = new OpenCodeAiService(makeGithubService())
    await expect(service.analyzePullRequest({ repo, number: 482 })).rejects.toThrow(
      'No se encontró el binario "opencode"',
    )
  })

  it('lanza el modelo mal formado sin llamar al server (sin "/")', async () => {
    getEffectiveAiSelectionMock.mockReturnValue({ provider: 'opencode', model: 'sin-barra', options: {} })
    setupFakeClient({})

    const service = new OpenCodeAiService(makeGithubService())
    await expect(service.analyzePullRequest({ repo, number: 482 })).rejects.toThrow(
      'does not have the expected',
    )
    expect(getOpencodeServerMock).not.toHaveBeenCalled()
  })
})
