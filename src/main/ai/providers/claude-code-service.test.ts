import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrContextSource } from '../pr-context'
import type { DiffFile, PullRequestDetail } from '../../../shared/types'
import type { DraftDidacticSection } from '../../../shared/events'
import { AGENTIC_INACTIVITY_TIMEOUT_MS, AGENTIC_REQUEST_TIMEOUT_MS } from '../analysis-timeouts'

/**
 * `ClaudeCodeAiService` (T28) habla con `@anthropic-ai/claude-agent-sdk`
 * (`query()`), NUNCA con una sesión real de Claude — se mockea el paquete
 * completo para simular el `AsyncGenerator<SDKMessage>` que devuelve `query()`
 * sin depender de que quien corre los tests tenga `claude` instalado/logueado.
 *
 * También se mockea `../env` (`getEffectiveAiSelection`) para no pasar por
 * `settingsStore`/Electron real, igual que `../index.test.ts`.
 */
const getEffectiveAiSelectionMock = vi.fn()
vi.mock('../env', () => ({
  getEffectiveAiSelection: (...args: unknown[]) => getEffectiveAiSelectionMock(...args),
}))

/**
 * `resolveCliPath` (T31) se mockea para no depender de si la máquina que
 * corre los tests tiene `claude` instalado: por defecto "lo encuentra" en
 * una ruta absoluta fake, así el resto de los tests (a los que no les
 * importa la resolución en sí) siguen viendo un `query()` normal.
 */
const resolveCliPathMock = vi.fn()
vi.mock('./resolve-cli', () => ({
  resolveCliPath: (...args: unknown[]) => resolveCliPathMock(...args),
}))

/**
 * `ensureSnapshot` (T54) se mockea: los tests de este servicio NO deben
 * pagar una descarga real de GitHub ni tocar disco, solo verificar que el
 * servicio lo llama con `(github, repo, detail.headSha)` y usa lo que
 * devuelve como `cwd` (T58).
 */
const ensureSnapshotMock = vi.fn()

/**
 * `createAnalysisTimeouts` (T56) se envuelve (NO se reemplaza: se preserva
 * el comportamiento real) solo para capturar con QUÉ `{ totalMs, inactivityMs }`
 * lo llama `ClaudeCodeAiService` — T58 pide verificar que usa los valores
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

/** Misma forma que la clase real exportada por el SDK: `class AbortError extends Error {}`, sin `.name` custom. */
class FakeAbortError extends Error {}

const queryMock = vi.fn()
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  AbortError: FakeAbortError,
  query: (...args: unknown[]) => queryMock(...args),
}))

const { ClaudeCodeAiService, normalizeClaudeEffort } = await import('./claude-code-service')

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

interface FakeSdkMessage {
  type: string
  [key: string]: unknown
}

/** `content_block_delta` de texto, la forma exacta que consume el servicio (`event.delta.type === 'text_delta'`). */
function textDeltaMessage(text: string): FakeSdkMessage {
  return {
    type: 'stream_event',
    event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
    parent_tool_use_id: null,
    uuid: 'u1',
    session_id: 's1',
  }
}

/** Delta de "pensamiento" (extended thinking): debe ser IGNORADO por el servicio, nunca llega al parser. */
function thinkingDeltaMessage(text: string): FakeSdkMessage {
  return {
    type: 'stream_event',
    event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: text } },
    parent_tool_use_id: null,
    uuid: 'u-thinking',
    session_id: 's1',
  }
}

/** Arranque de un bloque `tool_use` (F13): trae el nombre de la tool y el id del bloque; los args llegan después por `input_json_delta`. */
function toolUseStartMessage(index: number, id: string, name: string): FakeSdkMessage {
  return {
    type: 'stream_event',
    event: {
      type: 'content_block_start',
      index,
      content_block: { type: 'tool_use', id, name, input: {} },
    },
    parent_tool_use_id: null,
    uuid: 'u-tool-start',
    session_id: 's1',
  }
}

/** Fragmento del JSON de args de la tool en curso (F13): se acumula por `index`. */
function inputJsonDeltaMessage(index: number, partialJson: string): FakeSdkMessage {
  return {
    type: 'stream_event',
    event: {
      type: 'content_block_delta',
      index,
      delta: { type: 'input_json_delta', partial_json: partialJson },
    },
    parent_tool_use_id: null,
    uuid: 'u-json',
    session_id: 's1',
  }
}

/** Cierre de un bloque de contenido (F13): para un `tool_use`, el momento de parsear los args acumulados. */
function contentBlockStopMessage(index: number): FakeSdkMessage {
  return {
    type: 'stream_event',
    event: { type: 'content_block_stop', index },
    parent_tool_use_id: null,
    uuid: 'u-stop',
    session_id: 's1',
  }
}

function systemInitMessage(): FakeSdkMessage {
  return { type: 'system', subtype: 'init', session_id: 's1', uuid: 'u-init' }
}

function resultSuccessMessage(): FakeSdkMessage {
  return { type: 'result', subtype: 'success', is_error: false, session_id: 's1', uuid: 'u-result' }
}

/** Construye un `query()` mock que devuelve un `AsyncGenerator` sobre `messages`, exponiendo qué `options` recibió. */
function fakeQuery(messages: FakeSdkMessage[]): void {
  queryMock.mockImplementation(function fakeQueryImpl() {
    return (async function* generator() {
      for (const message of messages) {
        yield message
      }
    })()
  })
}

/** `query()` mock cuya iteración lanza `error` inmediatamente (simula un spawn fallido o un abort). */
function fakeQueryThrows(error: unknown): void {
  queryMock.mockImplementation(function fakeQueryImpl() {
    // eslint-disable-next-line require-yield -- a propósito: simula que `query()` rechaza antes de emitir ningún mensaje.
    return (async function* generator() {
      throw error
    })()
  })
}

describe('ClaudeCodeAiService.analyzePullRequest', () => {
  beforeEach(() => {
    getEffectiveAiSelectionMock.mockReturnValue({
      provider: 'claude-code',
      model: 'claude-sonnet-5',
      options: {},
    })
    resolveCliPathMock.mockReset()
    resolveCliPathMock.mockReturnValue('/home/test-user/.local/bin/claude')
    ensureSnapshotMock.mockReset()
    ensureSnapshotMock.mockResolvedValue('/home/test-user/.minerva/snapshots/shopwave-api-a1b2c3d')
    createAnalysisTimeoutsCalls.length = 0
  })

  afterEach(() => {
    vi.restoreAllMocks()
    queryMock.mockReset()
  })

  it('mapea un stream de deltas de texto a DidacticAnalysis', async () => {
    process.env.GITHUB_TOKEN = 'gh-secret'
    try {
      fakeQuery([
        systemInitMessage(),
        textDeltaMessage('@@@SECTION kind=summary\n'),
        textDeltaMessage('Resumen del PR\n'),
        resultSuccessMessage(),
      ])

      const service = new ClaudeCodeAiService(makeGithubService())
      const result = await service.analyzePullRequest({ repo, number: 482 })

      expect(result.prId).toBe('github:shopwave/api#482')
      expect(result.sections).toEqual([{ kind: 'summary', markdown: 'Resumen del PR' }])
      expect(typeof result.generatedAt).toBe('string')
      expect(() => new Date(result.generatedAt).toISOString()).not.toThrow()

      // Verifica la forma EXACTA de las opciones pasadas a `query()`.
      const [call] = queryMock.mock.calls[0] as [
        { prompt: string; options: Record<string, unknown> },
      ]
      expect(call.options.model).toBe('claude-sonnet-5')
      expect(call.options.pathToClaudeCodeExecutable).toBe('/home/test-user/.local/bin/claude')
      expect(call.options.systemPrompt).toEqual(expect.any(String))
      // AGÉNTICO (T58): cwd = snapshot local del PR, tools de solo lectura,
      // permissionMode restrictivo y maxTurns alto (ya no una sola vuelta
      // sin herramientas).
      expect(call.options.cwd).toBe('/home/test-user/.minerva/snapshots/shopwave-api-a1b2c3d')
      expect(call.options.tools).toEqual(['Read', 'Grep', 'Glob'])
      expect(call.options.allowedTools).toEqual(['Read', 'Grep', 'Glob'])
      expect(call.options.permissionMode).toBe('dontAsk')
      expect(call.options.maxTurns).toBe(30)
      // CRÍTICO: settingSources: [] + persistSession: false NO cambian con
      // el snapshot como cwd — el snapshot es código hostil (T58).
      expect(call.options.persistSession).toBe(false)
      expect(call.options.settingSources).toEqual([])
      expect(call.options.includePartialMessages).toBe(true)
      expect(call.options.abortController).toBeInstanceOf(AbortController)
      expect(call.prompt).toContain(detail.title)

      // `ensureSnapshot` se llama con el headSha del detail (T58).
      expect(ensureSnapshotMock).toHaveBeenCalledWith(repo, detail.headSha)

      // Timeouts AGÉNTICOS (300s/60s), no los de generación directa (T58).
      expect(createAnalysisTimeoutsCalls).toEqual([
        { totalMs: AGENTIC_REQUEST_TIMEOUT_MS, inactivityMs: AGENTIC_INACTIVITY_TIMEOUT_MS },
      ])

      // El entorno del subproceso que arma el SDK internamente no debe traer
      // secretos de otros proveedores (frontera de seguridad, T31).
      const env = call.options.env as NodeJS.ProcessEnv
      expect(env.GITHUB_TOKEN).toBeUndefined()
    } finally {
      delete process.env.GITHUB_TOKEN
    }
  })

  it('pasa "effort" en las options de query() cuando la selección efectiva trae uno (T36)', async () => {
    getEffectiveAiSelectionMock.mockReturnValue({
      provider: 'claude-code',
      model: 'claude-sonnet-5',
      options: { effort: 'xhigh' },
    })
    fakeQuery([textDeltaMessage('@@@SECTION kind=summary\nok\n')])

    const service = new ClaudeCodeAiService(makeGithubService())
    await service.analyzePullRequest({ repo, number: 482 })

    const [call] = queryMock.mock.calls[0] as [{ options: Record<string, unknown> }]
    expect(call.options.effort).toBe('xhigh')
  })

  it('NO pasa "effort" en las options de query() cuando la selección efectiva no trae uno (sin regresión)', async () => {
    getEffectiveAiSelectionMock.mockReturnValue({
      provider: 'claude-code',
      model: 'claude-sonnet-5',
      options: {},
    })
    fakeQuery([textDeltaMessage('@@@SECTION kind=summary\nok\n')])

    const service = new ClaudeCodeAiService(makeGithubService())
    await service.analyzePullRequest({ repo, number: 482 })

    const [call] = queryMock.mock.calls[0] as [{ options: Record<string, unknown> }]
    expect(call.options).not.toHaveProperty('effort')
  })

  it('lanza un mensaje accionable si resolveCliPath no encuentra "claude" instalado, sin llamar a query() ni ensureSnapshot', async () => {
    resolveCliPathMock.mockReturnValue(null)

    const service = new ClaudeCodeAiService(makeGithubService())
    await expect(service.analyzePullRequest({ repo, number: 482 })).rejects.toThrow(
      'The "claude" CLI is not installed',
    )
    expect(queryMock).not.toHaveBeenCalled()
    expect(ensureSnapshotMock).not.toHaveBeenCalled()
  })

  it('el link accionable apunta a code.claude.com/docs/en/setup (no al docs.claude.com viejo)', async () => {
    resolveCliPathMock.mockReturnValue(null)

    const service = new ClaudeCodeAiService(makeGithubService())
    await expect(service.analyzePullRequest({ repo, number: 482 })).rejects.toThrow(
      'https://code.claude.com/docs/en/setup',
    )
  })

  it('reconstruye una sección aunque el delta llegue partido en varios chunks', async () => {
    fakeQuery([
      textDeltaMessage('@@@SEC'),
      textDeltaMessage('TION kind=sum'),
      textDeltaMessage('mary\nhola '),
      textDeltaMessage('mundo\n'),
    ])

    const service = new ClaudeCodeAiService(makeGithubService())
    const result = await service.analyzePullRequest({ repo, number: 482 })
    expect(result.sections).toEqual([{ kind: 'summary', markdown: 'hola mundo' }])
  })

  it('ignora eventos que no son texto (init, thinking, result) sin romper el parseo', async () => {
    fakeQuery([
      systemInitMessage(),
      thinkingDeltaMessage('pensando...'),
      textDeltaMessage('@@@SECTION kind=summary\nok\n'),
      resultSuccessMessage(),
    ])

    const service = new ClaudeCodeAiService(makeGithubService())
    const result = await service.analyzePullRequest({ repo, number: 482 })
    expect(result.sections).toEqual([{ kind: 'summary', markdown: 'ok' }])
  })

  it('llama a onProgress con snapshots parciales y una vez final con done:true', async () => {
    fakeQuery([
      textDeltaMessage('@@@SECTION kind=summary\n'),
      textDeltaMessage('primera parte '),
      textDeltaMessage('segunda parte\n'),
    ])

    const progressCalls: Array<[DraftDidacticSection[], { done: boolean }]> = []
    const service = new ClaudeCodeAiService(makeGithubService())
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

  it('emite onProgress con phase:"exploring" ante actividad de tool-use ANTES del primer delta de texto (T60)', async () => {
    fakeQuery([
      // Evento crudo del stream que NO es un `text_delta` (mismo tipo que
      // llega durante una vuelta de `Read`/`Grep`/`Glob`, ver el comentario
      // del módulo): actividad de tool-use sin texto todavía.
      thinkingDeltaMessage('explorando el snapshot del PR...'),
      textDeltaMessage('@@@SECTION kind=summary\nok\n'),
    ])

    const progressCalls: Array<[DraftDidacticSection[], { done: boolean; phase?: 'exploring' | 'writing' }]> = []
    const service = new ClaudeCodeAiService(makeGithubService())
    const result = await service.analyzePullRequest(
      { repo, number: 482 },
      { onProgress: (sections, meta) => progressCalls.push([sections, meta]) },
    )

    // La PRIMERA llamada a onProgress es el EDGE del mini-log (F13): el
    // thinking_delta abre una fila "Pensando…" y eso emite SIN throttle,
    // ANTES de que llegue ningún delta de texto: fase "exploring" con
    // secciones todavía vacías.
    const [firstSections, firstMeta] = progressCalls[0]
    expect(firstMeta).toEqual({
      done: false,
      phase: 'exploring',
      activity: [{ id: 'think-0', kind: 'thinking', label: 'Thinking…', status: 'running' }],
    })
    expect(firstSections).toEqual([])

    // El resultado final sí incluye el contenido del delta posterior.
    expect(result.sections).toEqual([{ kind: 'summary', markdown: 'ok' }])
  })

  it('mini-log (F13): una tool call colapsa running→done en la misma fila, con la ruta relativizada al snapshot', async () => {
    fakeQuery([
      toolUseStartMessage(0, 'toolu_1', 'Read'),
      // Args partidos en dos deltas, con la ruta ABSOLUTA dentro del snapshot
      // (la que manda el agente): el label final debe mostrarla relativa.
      inputJsonDeltaMessage(0, '{"file_path": "/home/test-user/.minerva/snapsho'),
      inputJsonDeltaMessage(0, 'ts/shopwave-api-a1b2c3d/src/routes/carts.ts"}'),
      contentBlockStopMessage(0),
      textDeltaMessage('@@@SECTION kind=summary\nok\n'),
    ])

    const progressCalls: Array<
      [
        DraftDidacticSection[],
        { done: boolean; activity?: Array<{ id: string; label: string; status: string }> },
      ]
    > = []
    const service = new ClaudeCodeAiService(makeGithubService())
    await service.analyzePullRequest(
      { repo, number: 482 },
      { onProgress: (sections, meta) => progressCalls.push([sections, meta]) },
    )

    // Edge 1 (begin, SIN throttle): fila running genérica — el nombre de la
    // tool llega en el start pero los args todavía no.
    expect(progressCalls[0][1].activity).toEqual([
      { id: 'toolu_1', kind: 'read', label: 'Reading a file…', status: 'running' },
    ])
    // Edge del complete (también SIN throttle; entre medio pueden colarse
    // pings throttled de los input_json_delta): MISMA fila (mismo id,
    // colapso por identidad), ahora done y con la ruta extraída del JSON
    // acumulado, relativa al snapshot.
    const doneCall = progressCalls.find(([, meta]) => meta.activity?.[0]?.status === 'done')
    expect(doneCall?.[1].activity).toEqual([
      { id: 'toolu_1', kind: 'read', label: 'Read src/routes/carts.ts', status: 'done' },
    ])
    // El terminal NO trae actividad (efímera por diseño).
    const [, lastMeta] = progressCalls[progressCalls.length - 1]
    expect(lastMeta.done).toBe(true)
    expect(lastMeta.activity).toBeUndefined()
  })

  it('mini-log (F13): thinking_deltas repetidos son UNA fila "Pensando…" que cierra con el primer texto', async () => {
    fakeQuery([
      thinkingDeltaMessage('primer pensamiento'),
      thinkingDeltaMessage('más pensamiento'),
      thinkingDeltaMessage('y más'),
      textDeltaMessage('@@@SECTION kind=summary\nok\n'),
    ])

    const progressCalls: Array<
      [DraftDidacticSection[], { done: boolean; activity?: Array<{ label: string; status: string }> }]
    > = []
    const service = new ClaudeCodeAiService(makeGithubService())
    await service.analyzePullRequest(
      { repo, number: 482 },
      { onProgress: (sections, meta) => progressCalls.push([sections, meta]) },
    )

    // Solo UN edge por bloque de thinking (deltas repetidos = no-op), y el
    // label es SIEMPRE el genérico — el texto del razonamiento jamás viaja.
    const activityCalls = progressCalls.filter(([, meta]) => !meta.done && meta.activity?.length)
    expect(activityCalls[0][1].activity).toEqual([
      { id: 'think-0', kind: 'thinking', label: 'Thinking…', status: 'running' },
    ])
    // Con el primer delta de texto la fila cierra a "Pensó" y viaja con esa
    // misma emisión (throttled), sin edge extra.
    const writingCall = progressCalls.find(([, meta]) => !meta.done && meta.activity?.[0]?.status === 'done')
    expect(writingCall?.[1].activity?.[0].label).toBe('Thought')
  })

  it('lanza un mensaje accionable de login cuando el assistant reporta authentication_failed', async () => {
    fakeQuery([
      {
        type: 'assistant',
        message: { content: [] },
        parent_tool_use_id: null,
        error: 'authentication_failed',
        uuid: 'u-err',
        session_id: 's1',
      },
    ])

    const service = new ClaudeCodeAiService(makeGithubService())
    await expect(service.analyzePullRequest({ repo, number: 482 })).rejects.toThrow('claude login')
  })

  it('lanza un mensaje claro cuando el result final viene con is_error', async () => {
    fakeQuery([
      textDeltaMessage('@@@SECTION kind=summary\nok\n'),
      {
        type: 'result',
        subtype: 'error_during_execution',
        is_error: true,
        errors: ['algo salió mal en el turno'],
        session_id: 's1',
        uuid: 'u-result-err',
      },
    ])

    const service = new ClaudeCodeAiService(makeGithubService())
    await expect(service.analyzePullRequest({ repo, number: 482 })).rejects.toThrow(
      'algo salió mal en el turno',
    )
  })

  it('lanza si el CLI/binario del Agent SDK no se pudo lanzar', async () => {
    fakeQueryThrows(
      new Error(
        'Claude Code executable not found at claude. Is options.pathToClaudeCodeExecutable set?',
      ),
    )

    const service = new ClaudeCodeAiService(makeGithubService())
    await expect(service.analyzePullRequest({ repo, number: 482 })).rejects.toThrow(
      'could not find an executable binary',
    )
  })

  it('mapea el AbortError propio del SDK a un mensaje de timeout accionable con el total AGÉNTICO (300s, T58)', async () => {
    fakeQueryThrows(new FakeAbortError('Claude Code process aborted by user'))

    const service = new ClaudeCodeAiService(makeGithubService())
    await expect(service.analyzePullRequest({ repo, number: 482 })).rejects.toThrow(
      'Claude Code did not answer in time (total timeout of 300s)',
    )
  })

  it('un mensaje de tool-use (input_json_delta, sin texto) NO se empuja al parser pero SÍ mantiene vivo el análisis (T58)', async () => {
    fakeQuery([
      {
        type: 'stream_event',
        event: { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"path":"src/x.ts"}' } },
        parent_tool_use_id: null,
        uuid: 'u-tool',
        session_id: 's1',
      },
      textDeltaMessage('@@@SECTION kind=summary\nok\n'),
    ])

    const service = new ClaudeCodeAiService(makeGithubService())
    const result = await service.analyzePullRequest({ repo, number: 482 })
    expect(result.sections).toEqual([{ kind: 'summary', markdown: 'ok' }])
  })

  it('lanza si el modelo no emite ningún delta de texto', async () => {
    fakeQuery([systemInitMessage(), resultSuccessMessage()])

    const service = new ClaudeCodeAiService(makeGithubService())
    await expect(service.analyzePullRequest({ repo, number: 482 })).rejects.toThrow(
      'returned no streaming content',
    )
  })

  it('lanza si todas las secciones emitidas son inválidas', async () => {
    fakeQuery([textDeltaMessage('@@@SECTION kind=nope\ncontenido\n')])

    const service = new ClaudeCodeAiService(makeGithubService())
    await expect(service.analyzePullRequest({ repo, number: 482 })).rejects.toThrow('None of the sections')
  })
})

describe('normalizeClaudeEffort', () => {
  it('devuelve el valor tal cual (identidad): T34 ya lo valida contra las choices del modelo activo', () => {
    expect(normalizeClaudeEffort('low', 'claude-haiku-4-5')).toBe('low')
    expect(normalizeClaudeEffort('xhigh', 'claude-sonnet-5')).toBe('xhigh')
    expect(normalizeClaudeEffort('max', 'claude-fable-5')).toBe('max')
  })
})
