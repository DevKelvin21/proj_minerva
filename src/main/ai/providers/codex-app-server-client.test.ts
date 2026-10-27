import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Test del FRAMING/correlación de `CodexAppServerClient` (T29) a bajo nivel:
 * mockea `node:child_process.spawn` con un `ChildProcess` fake (EventEmitter
 * con `stdin.write` espiado y `stdout`/`stderr` como EventEmitters propios) en
 * vez de spawnear un `codex` real. Framing asumido (ver el comentario grande
 * en `./codex-app-server-client.ts`): un objeto JSON por línea, `\n`-
 * delimitado, SIN headers `Content-Length` — sin poder verificarlo contra
 * `packages/effect-codex-app-server` de t3code en este sandbox.
 */
interface FakeChildProcess extends EventEmitter {
  stdin: { write: ReturnType<typeof vi.fn> }
  stdout: EventEmitter
  stderr: EventEmitter
  kill: ReturnType<typeof vi.fn>
}

function makeFakeChild(): FakeChildProcess {
  const child = new EventEmitter() as FakeChildProcess
  child.stdin = { write: vi.fn() }
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = vi.fn()
  return child
}

let lastChild: FakeChildProcess | null = null
const spawnMock = vi.fn()

vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}))

const appOnMock = vi.fn()
vi.mock('electron', () => ({
  app: { on: (...args: unknown[]) => appOnMock(...args) },
}))

/**
 * `resolveCliPath` (T31) se mockea para no depender de qué tenga instalado
 * la máquina que corre los tests; por defecto "encuentra" `codex` en una
 * ruta absoluta fake, así el resto de los tests (que no les importa la
 * resolución en sí) sigue viendo un spawn exitoso.
 */
const resolveCliPathMock = vi.fn()
vi.mock('./resolve-cli', () => ({
  resolveCliPath: (...args: unknown[]) => resolveCliPathMock(...args),
}))

const {
  CodexAppServerClient,
  CodexSpawnError,
  CodexProcessExitError,
  JsonRpcRemoteError,
} = await import('./codex-app-server-client')

/** Emula al "servidor" respondiendo por stdout, línea por línea (posiblemente partida en varios chunks). */
function serverWritesLine(child: FakeChildProcess, obj: unknown): void {
  child.stdout.emit('data', Buffer.from(JSON.stringify(obj) + '\n'))
}

beforeEach(() => {
  lastChild = null
  spawnMock.mockReset()
  spawnMock.mockImplementation(() => {
    lastChild = makeFakeChild()
    return lastChild
  })
  resolveCliPathMock.mockReset()
  resolveCliPathMock.mockReturnValue('/usr/local/bin/codex')
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('CodexAppServerClient', () => {
  it('resuelve "codex" con resolveCliPath y spawnea la ruta absoluta, saneando tokens de GitHub del entorno del hijo', () => {
    process.env.GITHUB_TOKEN = 'gh-secret'
    try {
      new CodexAppServerClient()
      expect(resolveCliPathMock).toHaveBeenCalledWith('codex')
      expect(spawnMock).toHaveBeenCalledExactlyOnceWith(
        '/usr/local/bin/codex',
        ['app-server'],
        expect.objectContaining({ stdio: ['pipe', 'pipe', 'pipe'] }),
      )
      const [, , spawnOptions] = spawnMock.mock.calls[0] as [string, string[], { env: NodeJS.ProcessEnv }]
      expect(spawnOptions.env.GITHUB_TOKEN).toBeUndefined()
    } finally {
      delete process.env.GITHUB_TOKEN
    }
  })

  it('lanza CodexSpawnError sin intentar spawnear si resolveCliPath no encuentra el binario', () => {
    resolveCliPathMock.mockReturnValue(null)

    expect(() => new CodexAppServerClient()).toThrow(CodexSpawnError)
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('respeta un options.binary explícito sin pasar por resolveCliPath', () => {
    new CodexAppServerClient({ binary: '/custom/path/codex' })

    expect(resolveCliPathMock).not.toHaveBeenCalled()
    expect(spawnMock).toHaveBeenCalledExactlyOnceWith(
      '/custom/path/codex',
      ['app-server'],
      expect.objectContaining({ stdio: ['pipe', 'pipe', 'pipe'] }),
    )
  })

  it('correlaciona request/response por id, incluso si la respuesta llega partida en dos chunks', async () => {
    const client = new CodexAppServerClient()
    const promise = client.request('initialize', { foo: 'bar' })

    const sentRaw = lastChild!.stdin.write.mock.calls[0][0] as string
    const sent = JSON.parse(sentRaw.trim())
    expect(sent).toEqual({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { foo: 'bar' } })

    const responseText = JSON.stringify({ jsonrpc: '2.0', id: 1, result: { ok: true } }) + '\n'
    lastChild!.stdout.emit('data', Buffer.from(responseText.slice(0, 5)))
    lastChild!.stdout.emit('data', Buffer.from(responseText.slice(5)))

    await expect(promise).resolves.toEqual({ ok: true })
  })

  it('despacha notificaciones (mensajes sin id) a los handlers suscritos', () => {
    const client = new CodexAppServerClient()
    const received: Array<{ method: string; params?: unknown }> = []
    client.onNotification((n) => received.push(n))

    serverWritesLine(lastChild!, { jsonrpc: '2.0', method: 'item/agent_message_delta', params: { delta: 'hola' } })
    serverWritesLine(lastChild!, { jsonrpc: '2.0', method: 'item/agent_message_delta', params: { delta: ' mundo' } })

    expect(received).toEqual([
      { method: 'item/agent_message_delta', params: { delta: 'hola' } },
      { method: 'item/agent_message_delta', params: { delta: ' mundo' } },
    ])
  })

  it('rechaza con JsonRpcRemoteError cuando la respuesta trae un objeto "error"', async () => {
    const client = new CodexAppServerClient()
    const promise = client.request('account/read', {})

    serverWritesLine(lastChild!, {
      jsonrpc: '2.0',
      id: 1,
      error: { code: -32001, message: 'no autenticado' },
    })

    await expect(promise).rejects.toThrow('no autenticado')
    await expect(promise).rejects.toBeInstanceOf(JsonRpcRemoteError)
  })

  it('responde con un error JSON-RPC a una request entrante del servidor en vez de colgarse', () => {
    const client = new CodexAppServerClient()
    void client
    lastChild!.stdin.write.mockClear()

    serverWritesLine(lastChild!, { jsonrpc: '2.0', id: 7, method: 'approval/request', params: {} })

    expect(lastChild!.stdin.write).toHaveBeenCalledTimes(1)
    const written = JSON.parse((lastChild!.stdin.write.mock.calls[0][0] as string).trim())
    expect(written).toEqual({
      jsonrpc: '2.0',
      id: 7,
      error: expect.objectContaining({ code: -32601 }),
    })
  })

  it('ignora líneas que no son JSON válido sin romper el framing de las siguientes', async () => {
    const client = new CodexAppServerClient()
    const promise = client.request('initialize', {})

    lastChild!.stdout.emit('data', Buffer.from('esto no es json\n'))
    serverWritesLine(lastChild!, { jsonrpc: '2.0', id: 1, result: {} })

    await expect(promise).resolves.toEqual({})
  })

  it('rechaza la request pendiente con CodexSpawnError cuando el binario no existe (ENOENT)', async () => {
    const client = new CodexAppServerClient()
    const promise = client.request('initialize', {})

    const enoent = Object.assign(new Error('spawn codex ENOENT'), { code: 'ENOENT' })
    lastChild!.emit('error', enoent)

    await expect(promise).rejects.toBeInstanceOf(CodexSpawnError)
    await expect(promise).rejects.toThrow('binary was not found')
  })

  it('rechaza requests pendientes con CodexProcessExitError si el proceso termina inesperadamente', async () => {
    const client = new CodexAppServerClient()
    const promise = client.request('initialize', {})

    lastChild!.emit('exit', 1, null)

    await expect(promise).rejects.toBeInstanceOf(CodexProcessExitError)
  })

  it('kill() mata el proceso y rechaza cualquier request en vuelo', async () => {
    const client = new CodexAppServerClient()
    const promise = client.request('initialize', {})

    client.kill()

    await expect(promise).rejects.toThrow()
    expect(lastChild!.kill).toHaveBeenCalledWith('SIGTERM')
  })

  it('registra el hook de app.on("before-quit") una sola vez aunque se creen varios clientes', () => {
    appOnMock.mockClear()
    new CodexAppServerClient()
    new CodexAppServerClient()
    const beforeQuitCalls = appOnMock.mock.calls.filter(([event]) => event === 'before-quit')
    expect(beforeQuitCalls.length).toBeLessThanOrEqual(1)
  })
})
