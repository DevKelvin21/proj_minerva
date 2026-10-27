import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setMainLocale } from '../../i18n'

/**
 * `gh-cli-auth.ts` spawnea `gh` (`node:child_process`), resuelve su ruta
 * absoluta (`../ai/providers/resolve-cli.ts`) y valida el token contra
 * `GET /user` (`./github-user.ts`) — los tres se mockean para poder ejercitar
 * cada estado sin depender de si la máquina que corre los tests tiene `gh`
 * instalado/logueado.
 */
const execFileMock = vi.fn()
vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => execFileMock(...args),
}))

const resolveCliPathMock = vi.fn()
vi.mock('../../ai/providers/resolve-cli', () => ({
  resolveCliPath: (...args: unknown[]) => resolveCliPathMock(...args),
}))

const fetchGithubUserMock = vi.fn()
vi.mock('./github-user', () => ({
  fetchGithubUser: (...args: unknown[]) => fetchGithubUserMock(...args),
}))

/** F18: el probe lee la cuenta elegida del store de settings (que a su vez necesita Electron). */
const getGithubAccountMock = vi.fn()
vi.mock('../../settings/store', () => ({
  settingsStore: { getGithubAccount: () => getGithubAccountMock() },
}))

const { GhCliAuth } = await import('./gh-cli-auth')

type ExecFileCallback = (error: Error | null, stdout: string, stderr: string) => void

/** Configura el mock de `execFile` para resolver `(error, stdout)` en la próxima llamada. */
function mockExecFileResult(error: Error | null, stdout = ''): void {
  execFileMock.mockImplementation(
    (_path: string, _args: string[], _opts: unknown, cb: ExecFileCallback) => {
      cb(error, stdout, '')
    },
  )
}

/**
 * Igual que `mockExecFileResult` pero despachando por subcomando: `listAccounts()`
 * corre `gh auth status` y, si ese falla, reintenta sin `--json` — hay hasta
 * tres formas de invocación distintas en juego.
 */
function mockExecFileByArgs(
  responder: (args: string[]) => { error?: Error | null; stdout?: string; stderr?: string },
): void {
  execFileMock.mockImplementation(
    (_path: string, args: string[], _opts: unknown, cb: ExecFileCallback) => {
      const { error = null, stdout = '', stderr = '' } = responder(args)
      cb(error, stdout, stderr)
    },
  )
}

const validUser = { login: 'edygg', avatarUrl: 'https://avatars.githubusercontent.com/u/1' }

describe('GhCliAuth', () => {
  let auth: InstanceType<typeof GhCliAuth>

  beforeEach(() => {
    execFileMock.mockReset()
    resolveCliPathMock.mockReset()
    fetchGithubUserMock.mockReset()
    getGithubAccountMock.mockReset()
    resolveCliPathMock.mockReturnValue('/usr/local/bin/gh')
    // Default de los tests heredados de F14: sin cuenta elegida a mano.
    getGithubAccountMock.mockReturnValue(null)
    auth = new GhCliAuth()
  })

  describe('detail follows the UI language', () => {
    afterEach(() => setMainLocale('en'))

    it('English by default, Spanish after setMainLocale("es")', async () => {
      mockExecFileResult(new Error('exit status 1'))
      await expect(auth.getStatus()).resolves.toMatchObject({
        detail: "No gh session. Run 'gh auth login' in a terminal.",
      })
      setMainLocale('es')
      auth.invalidate()
      await expect(auth.getStatus()).resolves.toMatchObject({
        detail: "No hay sesión de gh. Ejecuta 'gh auth login' en una terminal.",
      })
    })
  })

  describe('getStatus(): los 4 estados', () => {
    it('cli_unavailable cuando resolveCliPath no encuentra gh en ninguna ubicación conocida', async () => {
      resolveCliPathMock.mockReturnValue(null)

      await expect(auth.getStatus()).resolves.toMatchObject({
        provider: 'github',
        state: 'cli_unavailable',
      })
      expect(execFileMock).not.toHaveBeenCalled()
    })

    it('cli_unauthenticated cuando gh auth token sale con exit code distinto de 0', async () => {
      mockExecFileResult(new Error('exit status 1'))

      await expect(auth.getStatus()).resolves.toMatchObject({
        provider: 'github',
        state: 'cli_unauthenticated',
      })
      expect(fetchGithubUserMock).not.toHaveBeenCalled()
    })

    it('cli_unauthenticated cuando gh auth token hace timeout (mismo duck-type de error)', async () => {
      mockExecFileResult(Object.assign(new Error('killed'), { killed: true, signal: 'SIGTERM' }))

      await expect(auth.getStatus()).resolves.toMatchObject({
        provider: 'github',
        state: 'cli_unauthenticated',
      })
    })

    it('cli_unauthenticated cuando gh auth token devuelve stdout vacío (o solo whitespace)', async () => {
      mockExecFileResult(null, '   \n')

      await expect(auth.getStatus()).resolves.toMatchObject({
        provider: 'github',
        state: 'cli_unauthenticated',
      })
      expect(fetchGithubUserMock).not.toHaveBeenCalled()
    })

    it('cli_unauthenticated cuando el token no valida contra GET /user (token descartado, no se cachea)', async () => {
      mockExecFileResult(null, 'ghp_bad_token')
      fetchGithubUserMock.mockRejectedValue(new Error('GET /user respondió 401'))

      await expect(auth.getStatus()).resolves.toMatchObject({
        provider: 'github',
        state: 'cli_unauthenticated',
      })
      expect(auth.getTokenSync()).toBeNull()
    })

    it('signed_in con el user cuando el token valida contra GET /user', async () => {
      mockExecFileResult(null, 'ghp_good_token')
      fetchGithubUserMock.mockResolvedValue(validUser)

      await expect(auth.getStatus()).resolves.toMatchObject({
        provider: 'github',
        state: 'signed_in',
        user: { login: 'edygg' },
      })
      expect(auth.getTokenSync()).toBe('ghp_good_token')
    })
  })

  it('recorta (trim) el stdout de gh auth token antes de validarlo', async () => {
    mockExecFileResult(null, '  ghp_with_whitespace  \n')
    fetchGithubUserMock.mockResolvedValue(validUser)

    await auth.getStatus()

    expect(fetchGithubUserMock).toHaveBeenCalledWith('ghp_with_whitespace')
  })

  it('el AuthStatus devuelto nunca incluye el token', async () => {
    mockExecFileResult(null, 'ghp_super_secret')
    fetchGithubUserMock.mockResolvedValue(validUser)

    const status = await auth.getStatus()

    expect(JSON.stringify(status)).not.toContain('ghp_super_secret')
  })

  it('ejecuta gh con los args EXACTOS, timeout+windowsHide, y sin la opción shell', async () => {
    mockExecFileResult(null, 'ghp_good_token')
    fetchGithubUserMock.mockResolvedValue(validUser)

    await auth.getStatus()

    expect(execFileMock).toHaveBeenCalledWith(
      '/usr/local/bin/gh',
      ['auth', 'token', '--hostname', 'github.com'],
      expect.objectContaining({ timeout: expect.any(Number), windowsHide: true }),
      expect.any(Function),
    )
    const [, , opts] = execFileMock.mock.calls[0] as [unknown, unknown, Record<string, unknown>]
    expect(opts).not.toHaveProperty('shell')
  })

  it('TTL: llamadas repetidas seguidas no vuelven a spawnear ni a revalidar contra /user', async () => {
    mockExecFileResult(null, 'ghp_good_token')
    fetchGithubUserMock.mockResolvedValue(validUser)

    await auth.getStatus()
    await auth.getStatus()
    await auth.getStatus()

    expect(execFileMock).toHaveBeenCalledTimes(1)
    expect(fetchGithubUserMock).toHaveBeenCalledTimes(1)
  })

  it('single-flight: dos getStatus() concurrentes disparan un solo spawn', async () => {
    mockExecFileResult(null, 'ghp_good_token')
    fetchGithubUserMock.mockResolvedValue(validUser)

    const [a, b] = await Promise.all([auth.getStatus(), auth.getStatus()])

    expect(a).toEqual(b)
    expect(execFileMock).toHaveBeenCalledTimes(1)
  })

  describe('refetchTokenAfter401()', () => {
    it('re-ejecuta gh auth token y actualiza getTokenSync() con el token nuevo', async () => {
      mockExecFileResult(null, 'ghp_old')
      fetchGithubUserMock.mockResolvedValue(validUser)
      await auth.getStatus()
      expect(auth.getTokenSync()).toBe('ghp_old')

      mockExecFileResult(null, 'ghp_new')
      const refreshed = await auth.refetchTokenAfter401()

      expect(refreshed).toBe('ghp_new')
      expect(auth.getTokenSync()).toBe('ghp_new')
    })

    it('devuelve null y limpia getTokenSync() si gh auth token vuelve a fallar', async () => {
      mockExecFileResult(null, 'ghp_old')
      fetchGithubUserMock.mockResolvedValue(validUser)
      await auth.getStatus()

      mockExecFileResult(new Error('exit status 1'))
      const refreshed = await auth.refetchTokenAfter401()

      expect(refreshed).toBeNull()
      expect(auth.getTokenSync()).toBeNull()
    })

    it('NO valida el token nuevo contra GET /user (esa validación queda al reintento del llamador)', async () => {
      mockExecFileResult(null, 'ghp_new')

      await auth.refetchTokenAfter401()

      expect(fetchGithubUserMock).not.toHaveBeenCalled()
    })

    it('invalida el cache de getStatus(): la siguiente llamada vuelve a spawnear', async () => {
      mockExecFileResult(null, 'ghp_old')
      fetchGithubUserMock.mockResolvedValue(validUser)
      await auth.getStatus()
      expect(execFileMock).toHaveBeenCalledTimes(1)

      mockExecFileResult(null, 'ghp_new')
      await auth.refetchTokenAfter401()
      expect(execFileMock).toHaveBeenCalledTimes(2)

      fetchGithubUserMock.mockResolvedValue(validUser)
      await auth.getStatus()
      expect(execFileMock).toHaveBeenCalledTimes(3)
    })

    it('devuelve null sin spawnear si gh ya no se resuelve en ninguna ubicación', async () => {
      resolveCliPathMock.mockReturnValue(null)

      const refreshed = await auth.refetchTokenAfter401()

      expect(refreshed).toBeNull()
      expect(execFileMock).not.toHaveBeenCalled()
    })
  })

  describe('reset()', () => {
    it('limpia cache y token snapshot: la siguiente llamada vuelve a spawnear', async () => {
      mockExecFileResult(null, 'ghp_good_token')
      fetchGithubUserMock.mockResolvedValue(validUser)
      await auth.getStatus()
      expect(auth.getTokenSync()).toBe('ghp_good_token')

      auth.reset()

      expect(auth.getTokenSync()).toBeNull()
      await auth.getStatus()
      expect(execFileMock).toHaveBeenCalledTimes(2)
    })
  })

  describe('cuenta elegida (F18)', () => {
    it('pasa --user cuando hay una cuenta elegida', async () => {
      getGithubAccountMock.mockReturnValue('am-i-edygg')
      mockExecFileResult(null, 'ghp_good_token')
      fetchGithubUserMock.mockResolvedValue(validUser)

      await auth.getStatus()

      expect(execFileMock).toHaveBeenCalledWith(
        '/usr/local/bin/gh',
        ['auth', 'token', '--hostname', 'github.com', '--user', 'am-i-edygg'],
        expect.anything(),
        expect.any(Function),
      )
    })

    it('NO pasa --user cuando no hay cuenta elegida (gh resuelve su activa)', async () => {
      mockExecFileResult(null, 'ghp_good_token')
      fetchGithubUserMock.mockResolvedValue(validUser)

      await auth.getStatus()

      const [, args] = execFileMock.mock.calls[0] as [unknown, string[]]
      expect(args).not.toContain('--user')
    })

    it('refetchTokenAfter401() también respeta la cuenta elegida', async () => {
      getGithubAccountMock.mockReturnValue('am-i-edygg')
      mockExecFileResult(null, 'ghp_new')

      await auth.refetchTokenAfter401()

      const [, args] = execFileMock.mock.calls[0] as [unknown, string[]]
      expect(args).toContain('--user')
      expect(args).toContain('am-i-edygg')
    })

    it('signed_in con cuenta elegida a mano', async () => {
      getGithubAccountMock.mockReturnValue('am-i-edygg')
      mockExecFileResult(null, 'ghp_good_token')
      fetchGithubUserMock.mockResolvedValue(validUser)

      await expect(auth.getStatus()).resolves.toMatchObject({
        provider: 'github',
        state: 'signed_in',
        user: { login: 'edygg' },
      })
    })

    it('cli_unauthenticated names the chosen account in detail: the UI can say WHICH account failed', async () => {
      getGithubAccountMock.mockReturnValue('edyggclevr')
      // `gh auth token --user X` sale con exit≠0 si X ya no está logueada.
      mockExecFileResult(new Error('exit status 1'))

      await expect(auth.getStatus()).resolves.toMatchObject({
        provider: 'github',
        state: 'cli_unauthenticated',
        detail: expect.stringContaining('"edyggclevr"'),
      })
    })

    it('sin cuenta elegida, el status NO inventa una cuenta', async () => {
      mockExecFileResult(new Error('exit status 1'))

      const status = await auth.getStatus()

      expect(status.detail).not.toMatch(/selected gh account/)
    })

    it('cambiar de cuenta invalida el cache TTL aunque no haya pasado el tiempo', async () => {
      mockExecFileResult(null, 'ghp_token_a')
      fetchGithubUserMock.mockResolvedValue(validUser)
      await auth.getStatus()
      expect(execFileMock).toHaveBeenCalledTimes(1)

      // Misma cuenta: sirve el cache.
      await auth.getStatus()
      expect(execFileMock).toHaveBeenCalledTimes(1)

      // Otra cuenta: el probe cacheado habla de otra identidad, hay que rehacerlo.
      getGithubAccountMock.mockReturnValue('otra')
      await auth.getStatus()
      expect(execFileMock).toHaveBeenCalledTimes(2)
    })

    it('invalidate() fuerza un probe nuevo sin borrar el token vigente', async () => {
      mockExecFileResult(null, 'ghp_good_token')
      fetchGithubUserMock.mockResolvedValue(validUser)
      await auth.getStatus()

      auth.invalidate()

      // El token sigue disponible para la ruta de datos mientras se re-probea.
      expect(auth.getTokenSync()).toBe('ghp_good_token')
      await auth.getStatus()
      expect(execFileMock).toHaveBeenCalledTimes(2)
    })
  })

  describe('listAccounts() (F18)', () => {
    const jsonPayload = JSON.stringify({
      hosts: {
        'github.com': [
          { state: 'success', active: true, login: 'am-i-edygg' },
          { state: 'error', active: false, login: 'edyggclevr' },
        ],
      },
    })

    it('lee el camino --json y marca activa/válida por cuenta', async () => {
      mockExecFileByArgs(() => ({ stdout: jsonPayload }))

      await expect(auth.listAccounts()).resolves.toEqual([
        { login: 'am-i-edygg', active: true, valid: true },
        { login: 'edyggclevr', active: false, valid: false },
      ])
    })

    it('cae al parseo de texto si gh no soporta --json (flag desconocido)', async () => {
      const textReport = [
        'github.com',
        '  ✓ Logged in to github.com account am-i-edygg (/home/u/.config/gh/hosts.yml)',
        '  - Active account: true',
        '  X Failed to log in to github.com account edyggclevr (default)',
        '  - Active account: false',
      ].join('\n')

      mockExecFileByArgs((args) =>
        args.includes('--json')
          ? { error: new Error('unknown flag: --json'), stderr: 'unknown flag: --json' }
          : // El reporte de texto va a STDERR y gh sale con 1 cuando alguna
            // cuenta tiene el token vencido: ambas cosas deben ignorarse.
            { error: new Error('exit status 1'), stderr: textReport },
      )

      await expect(auth.listAccounts()).resolves.toEqual([
        { login: 'am-i-edygg', active: true, valid: true },
        { login: 'edyggclevr', active: false, valid: false },
      ])
    })

    it('devuelve [] si gh no está instalado, sin spawnear', async () => {
      resolveCliPathMock.mockReturnValue(null)

      await expect(auth.listAccounts()).resolves.toEqual([])
      expect(execFileMock).not.toHaveBeenCalled()
    })

    it('devuelve [] si ninguno de los dos formatos se entiende', async () => {
      mockExecFileByArgs(() => ({ error: new Error('boom'), stdout: 'ruido' }))

      await expect(auth.listAccounts()).resolves.toEqual([])
    })

    it('nunca pide --show-token: la lista no debe traer secretos', async () => {
      mockExecFileByArgs(() => ({ stdout: jsonPayload }))

      await auth.listAccounts()

      for (const call of execFileMock.mock.calls) {
        expect(call[1]).not.toContain('--show-token')
        expect(call[1]).not.toContain('-t')
      }
    })

    it('cachea: dos llamadas seguidas spawnean una sola vez', async () => {
      mockExecFileByArgs(() => ({ stdout: jsonPayload }))

      await auth.listAccounts()
      await auth.listAccounts()

      expect(execFileMock).toHaveBeenCalledTimes(1)
    })

    it('invalidate() tira también el cache de cuentas', async () => {
      mockExecFileByArgs(() => ({ stdout: jsonPayload }))
      await auth.listAccounts()

      auth.invalidate()
      await auth.listAccounts()

      expect(execFileMock).toHaveBeenCalledTimes(2)
    })
  })
})
