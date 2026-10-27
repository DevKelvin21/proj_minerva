import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `opencode-runtime.ts` (T55) spawnea procesos (`node:child_process`) y toca
 * la red (`node:net`, para el puerto efímero) — se mockean ambos para poder
 * controlar cada escenario (ready-line, timeout, exit temprano) sin depender
 * de tener `opencode` instalado en la máquina que corre los tests. El wire
 * (prefijo de la línea de ready, regex de la URL) fue verificado
 * EMPÍRICAMENTE contra el binario real 1.17.18 — ver el comentario grande en
 * `./opencode-runtime.ts`.
 */
interface FakeChildProcess extends EventEmitter {
  pid: number | undefined
  stdout: EventEmitter
  stderr: EventEmitter
}

function makeFakeChild(pid: number | undefined = 4242): FakeChildProcess {
  const child = new EventEmitter() as FakeChildProcess
  child.pid = pid
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  return child
}

let lastChild: FakeChildProcess | null = null
const spawnMock = vi.fn()
const execFileMock = vi.fn()
vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
  execFile: (...args: unknown[]) => execFileMock(...args),
}))

/** Fake de `net.createServer().listen(0, ...)`: entrega un puerto fijo sin tocar sockets reales. */
interface FakeNetServer extends EventEmitter {
  listen: (port: number, host: string, cb: () => void) => void
  address: () => { port: number; address: string; family: string }
  close: (cb?: () => void) => void
}

let nextEphemeralPort = 45000
function makeFakeNetServer(): FakeNetServer {
  const server = new EventEmitter() as FakeNetServer
  const port = nextEphemeralPort++
  server.listen = (_port, _host, cb) => cb()
  server.address = () => ({ port, address: '127.0.0.1', family: 'IPv4' })
  server.close = (cb) => cb?.()
  return server
}

const createServerMock = vi.fn()
vi.mock('node:net', () => ({
  createServer: (...args: unknown[]) => createServerMock(...args),
}))

const resolveCliPathMock = vi.fn()
vi.mock('./resolve-cli', () => ({
  resolveCliPath: (...args: unknown[]) => resolveCliPathMock(...args),
}))

const buildSanitizedSpawnEnvMock = vi.fn()
vi.mock('./spawn-env', () => ({
  buildSanitizedSpawnEnv: (...args: unknown[]) => buildSanitizedSpawnEnvMock(...args),
}))

const {
  checkOpencodeVersion,
  getOpencodeServer,
  stopOpencodeServer,
  MIN_OPENCODE_VERSION,
  OPENCODE_READONLY_CONFIG,
} = await import('./opencode-runtime')

type ExecFileCallback = (error: Error | null, stdout: string, stderr: string) => void

function mockExecFileResult(error: Error | null, stdout = ''): void {
  execFileMock.mockImplementation(
    (_binary: string, _args: string[], _opts: unknown, cb: ExecFileCallback) => {
      cb(error, stdout, '')
    },
  )
}

function enoent(): Error {
  return Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' })
}

/** Emula la línea de "ready" verificada contra el binario real (ver comentario del módulo bajo test). */
function readyLine(url: string): string {
  return 'opencode server listening on ' + url + '\n'
}

/**
 * `spawnOpencodeServer` resuelve el puerto efímero (`findEphemeralPort`) de
 * forma asíncrona ANTES de llamar a `spawn` — aunque el fake de `net` invoca
 * su callback de forma síncrona, la cadena de promesas todavía necesita un
 * par de vueltas de microtask para que `lastChild` quede seteado. Se usa tras
 * cada `getOpencodeServer()` antes de tocar `lastChild`.
 */
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

beforeEach(() => {
  lastChild = null
  spawnMock.mockReset()
  spawnMock.mockImplementation(() => {
    lastChild = makeFakeChild()
    return lastChild
  })
  execFileMock.mockReset()
  createServerMock.mockReset()
  createServerMock.mockImplementation(() => makeFakeNetServer())
  resolveCliPathMock.mockReset()
  resolveCliPathMock.mockReturnValue('/usr/local/bin/opencode')
  buildSanitizedSpawnEnvMock.mockReset()
  buildSanitizedSpawnEnvMock.mockReturnValue({ PATH: '/usr/bin' })
})

afterEach(async () => {
  // Limpia cualquier server "vivo" que haya quedado del test (best-effort:
  // `stopOpencodeServer` es idempotente incluso si no había ninguno).
  await stopOpencodeServer()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('MIN_OPENCODE_VERSION', () => {
  it('es 1.14.19', () => {
    expect(MIN_OPENCODE_VERSION).toBe('1.14.19')
  })
})

describe('OPENCODE_READONLY_CONFIG', () => {
  it('tiene la forma EXACTA de permisos read-only (nunca "ask")', () => {
    expect(OPENCODE_READONLY_CONFIG).toEqual({
      permission: {
        '*': 'deny',
        edit: 'deny',
        bash: 'deny',
        webfetch: 'deny',
        websearch: 'deny',
        question: 'deny',
        external_directory: 'deny',
        read: 'allow',
        grep: 'allow',
        glob: 'allow',
        list: 'allow',
      },
    })
    expect(JSON.stringify(OPENCODE_READONLY_CONFIG)).not.toContain('ask')
  })
})

describe('checkOpencodeVersion', () => {
  it('ok:false sin intentar execFile cuando resolveCliPath no encuentra el binario', async () => {
    resolveCliPathMock.mockReturnValue(null)

    const result = await checkOpencodeVersion()

    expect(result.ok).toBe(false)
    expect(result.version).toBeNull()
    expect(result.error).toContain('https://opencode.ai/docs/')
    expect(execFileMock).not.toHaveBeenCalled()
  })

  it('ok:true cuando la versión instalada es EXACTAMENTE la mínima', async () => {
    mockExecFileResult(null, '1.14.19\n')

    const result = await checkOpencodeVersion()

    expect(result).toEqual({ ok: true, version: '1.14.19', error: undefined })
  })

  it('ok:true cuando la versión instalada es MAYOR a la mínima', async () => {
    mockExecFileResult(null, '1.17.18\n')

    const result = await checkOpencodeVersion()

    expect(result.ok).toBe(true)
    expect(result.version).toBe('1.17.18')
  })

  it('ok:false cuando la versión instalada es MENOR a la mínima', async () => {
    mockExecFileResult(null, '1.14.18\n')

    const result = await checkOpencodeVersion()

    expect(result.ok).toBe(false)
    expect(result.version).toBe('1.14.18')
    expect(result.error).toContain('1.14.19')
  })

  it('ok:false cuando la salida no se puede interpretar como semver', async () => {
    mockExecFileResult(null, 'no-version-here\n')

    const result = await checkOpencodeVersion()

    expect(result.ok).toBe(false)
    expect(result.version).toBe('no-version-here')
    expect(result.error?.toLowerCase()).toContain('could not read the opencode version')
  })

  it('ok:false cuando execFile falla (ENOENT/timeout)', async () => {
    mockExecFileResult(enoent())

    const result = await checkOpencodeVersion()

    expect(result.ok).toBe(false)
    expect(result.version).toBeNull()
    expect(result.error).toBeDefined()
  })

  it('ejecuta --version contra la ruta ABSOLUTA resuelta, con timeout', async () => {
    resolveCliPathMock.mockReturnValue('/opt/custom/opencode')
    mockExecFileResult(null, '1.17.18')

    await checkOpencodeVersion()

    expect(execFileMock).toHaveBeenCalledWith(
      '/opt/custom/opencode',
      ['--version'],
      expect.objectContaining({ timeout: expect.any(Number) }),
      expect.any(Function),
    )
  })
})

describe('getOpencodeServer', () => {
  it('spawnea "opencode serve" con hostname/puerto efímero, detached y la config read-only en el env', async () => {
    const promise = getOpencodeServer()
    await flushMicrotasks()
    lastChild!.stdout.emit('data', Buffer.from(readyLine('http://127.0.0.1:45000')))
    const handle = await promise

    expect(handle.url).toBe('http://127.0.0.1:45000')
    expect(spawnMock).toHaveBeenCalledTimes(1)
    const [binary, args, opts] = spawnMock.mock.calls[0] as [string, string[], Record<string, unknown>]
    expect(binary).toBe('/usr/local/bin/opencode')
    expect(args).toEqual(['serve', '--hostname=127.0.0.1', '--port=45000'])
    expect(opts.detached).toBe(true)
    expect((opts.env as Record<string, string>).PATH).toBe('/usr/bin')
    expect(JSON.parse((opts.env as Record<string, string>).OPENCODE_CONFIG_CONTENT)).toEqual(
      OPENCODE_READONLY_CONFIG,
    )
  })

  it('parsea la ready-line aunque venga precedida de otras líneas (warning de OPENCODE_SERVER_PASSWORD)', async () => {
    const promise = getOpencodeServer()
    await flushMicrotasks()
    lastChild!.stdout.emit(
      'data',
      Buffer.from('Warning: OPENCODE_SERVER_PASSWORD is not set; server is unsecured.\n' + readyLine('http://127.0.0.1:45000')),
    )

    await expect(promise).resolves.toEqual({ url: 'http://127.0.0.1:45000' })
  })

  it('parsea la ready-line aunque llegue partida en dos chunks', async () => {
    const promise = getOpencodeServer()
    await flushMicrotasks()
    const full = readyLine('http://127.0.0.1:45000')
    lastChild!.stdout.emit('data', Buffer.from(full.slice(0, 10)))
    lastChild!.stdout.emit('data', Buffer.from(full.slice(10)))

    await expect(promise).resolves.toEqual({ url: 'http://127.0.0.1:45000' })
  })

  it('NO resuelve con una línea que tiene el prefijo pero no matchea la regex de URL', async () => {
    vi.useFakeTimers()
    const promise = getOpencodeServer()
    await flushMicrotasks()
    lastChild!.stdout.emit('data', Buffer.from('opencode server listening but no url here\n'))

    let settled = false
    promise.then(
      () => (settled = true),
      () => (settled = true),
    )
    await Promise.resolve()
    expect(settled).toBe(false)

    // Sin una ready-line válida, eventualmente escala a timeout (ver test de abajo).
    await vi.advanceTimersByTimeAsync(10_001)
    await expect(promise).rejects.toThrow(/did not start/)
  })

  it('rechaza con detalle de stdout/stderr si el proceso sale ANTES de quedar listo', async () => {
    const promise = getOpencodeServer()
    await flushMicrotasks()
    lastChild!.stderr.emit('data', Buffer.from('algo salió mal\n'))
    lastChild!.emit('exit', 1, null)

    await expect(promise).rejects.toThrow(/exited before it was ready/)
    await expect(promise).rejects.toThrow(/code=1/)
    await expect(promise).rejects.toThrow(/algo salió mal/)
  })

  it('rechaza por timeout si no hay ready-line dentro de 10s, incluyendo stdout acumulado', async () => {
    vi.useFakeTimers()
    const promise = getOpencodeServer()
    // Adjunta un catch no-op ANTES de avanzar los timers: si no, Node marca
    // la promesa como "unhandled rejection" en el tick en que el timeout
    // dispara, aunque más abajo SÍ se termine manejando con `.rejects`.
    promise.catch(() => {})
    await flushMicrotasks()
    lastChild!.stdout.emit('data', Buffer.from('arrancando...\n'))

    await vi.advanceTimersByTimeAsync(10_001)

    await expect(promise).rejects.toThrow(/did not start/)
    await expect(promise).rejects.toThrow(/arrancando/)
  })

  it('rechaza con mensaje accionable (link de instalación) cuando resolveCliPath no encuentra el binario, sin spawnear', async () => {
    resolveCliPathMock.mockReturnValue(null)

    await expect(getOpencodeServer()).rejects.toThrow(/https:\/\/opencode\.ai\/docs\//)
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('singleton: dos llamadas concurrentes comparten UN solo spawn', async () => {
    const first = getOpencodeServer()
    const second = getOpencodeServer()
    await flushMicrotasks()
    lastChild!.stdout.emit('data', Buffer.from(readyLine('http://127.0.0.1:45000')))

    const [a, b] = await Promise.all([first, second])

    expect(a).toEqual(b)
    expect(spawnMock).toHaveBeenCalledTimes(1)
  })

  it('si el arranque falla, la SIGUIENTE llamada reintenta (no queda atascado en el error)', async () => {
    const first = getOpencodeServer()
    await flushMicrotasks()
    lastChild!.emit('exit', 1, null)
    await expect(first).rejects.toThrow()

    const second = getOpencodeServer()
    await flushMicrotasks()
    lastChild!.stdout.emit('data', Buffer.from(readyLine('http://127.0.0.1:45001')))
    await expect(second).resolves.toEqual({ url: 'http://127.0.0.1:45001' })

    expect(spawnMock).toHaveBeenCalledTimes(2)
  })
})

describe('stopOpencodeServer', () => {
  it('es un no-op si nunca se arrancó un server', async () => {
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)

    await expect(stopOpencodeServer()).resolves.toBeUndefined()

    expect(killSpy).not.toHaveBeenCalled()
  })

  it('manda SIGTERM al GRUPO de procesos (pid negativo) y no escala a SIGKILL si el proceso ya murió', async () => {
    vi.useFakeTimers()
    const promise = getOpencodeServer()
    await flushMicrotasks()
    lastChild!.stdout.emit('data', Buffer.from(readyLine('http://127.0.0.1:45000')))
    await promise

    let alive = true
    const killSpy = vi.spyOn(process, 'kill').mockImplementation((_pid, signal) => {
      if (signal === 'SIGTERM') {
        alive = false // el proceso "reacciona" al SIGTERM y muere antes del período de gracia
        return true
      }
      if (signal === 0) {
        // `isProcessAlive` prueba con señal 0: un proceso muerto lanza ESRCH.
        if (!alive) throw new Error('ESRCH')
        return true
      }
      return true
    })

    const stopPromise = stopOpencodeServer()
    await vi.advanceTimersByTimeAsync(1_001)
    await stopPromise

    const signals = killSpy.mock.calls.map((call) => call[1])
    expect(signals).toContain('SIGTERM')
    expect(signals).not.toContain('SIGKILL')
    expect(killSpy.mock.calls[0]?.[0]).toBe(-4242)
  })

  it('escala a SIGKILL si el proceso SIGUE vivo tras el período de gracia', async () => {
    vi.useFakeTimers()
    const promise = getOpencodeServer()
    await flushMicrotasks()
    lastChild!.stdout.emit('data', Buffer.from(readyLine('http://127.0.0.1:45000')))
    await promise

    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true) // "vivo" siempre (nunca lanza)

    const stopPromise = stopOpencodeServer()
    await vi.advanceTimersByTimeAsync(1_001)
    await stopPromise

    const signals = killSpy.mock.calls.map((call) => call[1])
    expect(signals).toContain('SIGTERM')
    expect(signals).toContain('SIGKILL')
  })

  it('mata al server que TODAVÍA está arrancando (no esperó su línea de ready)', async () => {
    // REGRESIÓN: el hijo se registraba al imprimir "ready", así que durante todo
    // el arranque (segundos, en frío) `stopOpencodeServer()` era un no-op y
    // cerrar la app en esa ventana dejaba un `opencode serve` de ~300 MB
    // reparentado a init — `detached: true` lo hace líder de su propio grupo, así
    // que tampoco se lo llevaba la muerte del padre. En la suite e2e (39 launches,
    // cada uno spawnea uno al montar el panel didáctico) eso acumulaba >15 GB.
    vi.useFakeTimers()
    const pending = getOpencodeServer()
    await flushMicrotasks()
    expect(lastChild, 'el hijo ya fue spawneado').not.toBeNull()

    const killSpy = vi.spyOn(process, 'kill').mockImplementation((_pid, signal) => {
      if (signal === 0) throw new Error('ESRCH') // murió con el SIGTERM
      return true
    })

    const stopPromise = stopOpencodeServer()
    await vi.advanceTimersByTimeAsync(1_001)
    await stopPromise

    expect(killSpy).toHaveBeenCalledWith(-4242, 'SIGTERM')

    // Si el arranque termina DESPUÉS del stop, ese server ya está condenado: no
    // se publica como el singleton vivo (quedaría una URL muerta en la cache).
    lastChild!.stdout.emit('data', Buffer.from(readyLine('http://127.0.0.1:45000')))
    await expect(pending).rejects.toThrow(/stopped while starting/)
  })

  it('cancela un arranque que todavía NO llegó al spawn (no deja un proceso naciendo sin dueño)', async () => {
    // REGRESIÓN (segunda mitad del leak de F20): `spawnOpencodeServer` espera
    // `findEphemeralPort()` antes de spawnear. Un stop en esa ventana limpiaba el
    // singleton y devolvía "nada que matar", pero la promesa en vuelo seguía y
    // creaba el proceso DESPUÉS — con la app ya cerrándose, o sea un huérfano
    // garantizado.
    vi.useFakeTimers()
    const pending = getOpencodeServer()

    // SIN `flushMicrotasks()`: el stop llega mientras `findEphemeralPort()` está
    // en vuelo, antes de que exista ningún hijo.
    await stopOpencodeServer()
    await flushMicrotasks()

    await expect(pending).rejects.toThrow(/cancelled before it launched/)
    expect(spawnMock, 'no se spawneó nada tras el stop').not.toHaveBeenCalled()
  })

  it('es idempotente: llamar dos veces seguidas no lanza', async () => {
    vi.useFakeTimers()
    const promise = getOpencodeServer()
    await flushMicrotasks()
    lastChild!.stdout.emit('data', Buffer.from(readyLine('http://127.0.0.1:45000')))
    await promise
    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw new Error('ESRCH')
    })

    const firstStop = stopOpencodeServer()
    await vi.advanceTimersByTimeAsync(1_001)
    await expect(firstStop).resolves.toBeUndefined()
    await expect(stopOpencodeServer()).resolves.toBeUndefined()
  })

  it('resetea el singleton: la próxima getOpencodeServer() spawnea de nuevo', async () => {
    vi.useFakeTimers()
    const first = getOpencodeServer()
    await flushMicrotasks()
    lastChild!.stdout.emit('data', Buffer.from(readyLine('http://127.0.0.1:45000')))
    await first
    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw new Error('ESRCH')
    })
    const stopPromise = stopOpencodeServer()
    await vi.advanceTimersByTimeAsync(1_001)
    await stopPromise

    const second = getOpencodeServer()
    await flushMicrotasks()
    lastChild!.stdout.emit('data', Buffer.from(readyLine('http://127.0.0.1:45001')))
    await expect(second).resolves.toEqual({ url: 'http://127.0.0.1:45001' })

    expect(spawnMock).toHaveBeenCalledTimes(2)

    // Deja el singleton limpio ANTES de que termine el test: el `afterEach`
    // también llama a `stopOpencodeServer()`, y con los timers todavía en
    // modo fake su `delay(1s)` interno nunca resolvería solo (nadie avanza
    // el reloj fuera de un test) — colgaría el hook de limpieza.
    const secondStop = stopOpencodeServer()
    await vi.advanceTimersByTimeAsync(1_001)
    await secondStop
  })
})
