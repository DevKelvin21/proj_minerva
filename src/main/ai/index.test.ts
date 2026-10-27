import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrContextSource } from './pr-context'

/**
 * `createAiService` (T27, factory multi-proveedor; ASYNC desde T28 — ver el
 * comentario de `./index.ts`) delega en `getEffectiveAiSelection` (`./env.ts`)
 * para elegir proveedor+modelo, y en `getCliProviderStatus`
 * (`./providers/cli-probe.ts`) para saber si el proveedor activo (los TRES
 * son `cli` desde T59: Claude Code/Codex/OpenCode) tiene sesión. Se mockean
 * esas funciones más las clases `ClaudeCodeAiService`/`CodexAiService`/
 * `OpenCodeAiService`/`MockAiService` (constructores espiados, sin lógica
 * real) para verificar SOLO la lógica de selección del factory, sin pagar
 * ninguna llamada real ni depender del entorno (sesión de `claude`/`codex`/
 * `opencode`) de quien corre los tests. `MINERVA_MOCK` se controla por test:
 * sin él el factory LANZA cuando el proveedor activo no puede inicializarse;
 * con `MINERVA_MOCK=1` cae al mock de IA (modo demo) — ver el comentario de
 * `createAiServiceForProvider`.
 */
const getEffectiveAiSelectionMock = vi.fn()
vi.mock('./env', () => ({
  getEffectiveAiSelection: (...args: unknown[]) => getEffectiveAiSelectionMock(...args),
}))

const getCliProviderStatusMock = vi.fn()
vi.mock('./providers/cli-probe', () => ({
  getCliProviderStatus: (...args: unknown[]) => getCliProviderStatusMock(...args),
}))

const claudeCodeCtor = vi.fn()
vi.mock('./providers/claude-code-service', () => ({
  ClaudeCodeAiService: class {
    constructor(...args: unknown[]) {
      claudeCodeCtor(...args)
    }
  },
}))

const codexCtor = vi.fn()
vi.mock('./providers/codex-service', () => ({
  CodexAiService: class {
    constructor(...args: unknown[]) {
      codexCtor(...args)
    }
  },
}))

const opencodeCtor = vi.fn()
vi.mock('./providers/opencode-service', () => ({
  OpenCodeAiService: class {
    constructor(...args: unknown[]) {
      opencodeCtor(...args)
    }
  },
}))

const mockServiceCtor = vi.fn()
vi.mock('./mock-service', () => ({
  MockAiService: class {
    constructor(...args: unknown[]) {
      mockServiceCtor(...args)
    }
  },
}))

const { createAiService } = await import('./index')

function makeGithub(): PrContextSource {
  return {} as PrContextSource
}

describe('createAiService (T27, factory multi-proveedor; async desde T28)', () => {
  const originalMinervaMock = process.env.MINERVA_MOCK

  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    // GitHub REAL por defecto: el fallback al mock de IA solo aplica en modo
    // demo (`MINERVA_MOCK=1`), los tests que lo cubren lo setean explícito.
    delete process.env.MINERVA_MOCK
  })

  afterEach(() => {
    vi.restoreAllMocks()
    if (originalMinervaMock === undefined) delete process.env.MINERVA_MOCK
    else process.env.MINERVA_MOCK = originalMinervaMock
  })

  it('MINERVA_MOCK_AI=1 fuerza MockAiService sin consultar proveedor ni probe (F11)', async () => {
    process.env.MINERVA_MOCK_AI = '1'
    try {
      await createAiService(makeGithub())
      expect(mockServiceCtor).toHaveBeenCalledOnce()
      expect(getEffectiveAiSelectionMock).not.toHaveBeenCalled()
      expect(getCliProviderStatusMock).not.toHaveBeenCalled()
    } finally {
      delete process.env.MINERVA_MOCK_AI
    }
  })

  it('claude-code activo + CLI autenticado: instancia ClaudeCodeAiService (T28)', async () => {
    getEffectiveAiSelectionMock.mockReturnValue({ provider: 'claude-code', model: 'claude-sonnet-5' })
    getCliProviderStatusMock.mockResolvedValue({ status: 'authenticated', account: { plan: 'max' } })
    const github = makeGithub()

    await createAiService(github)

    expect(claudeCodeCtor).toHaveBeenCalledExactlyOnceWith(github)
    expect(mockServiceCtor).not.toHaveBeenCalled()
    expect(getCliProviderStatusMock).toHaveBeenCalledExactlyOnceWith('claude-code')
  })

  it('claude-code activo + CLI instalado sin sesión + GitHub real: LANZA sugiriendo «claude login»', async () => {
    getEffectiveAiSelectionMock.mockReturnValue({ provider: 'claude-code', model: 'claude-sonnet-5' })
    getCliProviderStatusMock.mockResolvedValue({ status: 'installed' })

    await expect(createAiService(makeGithub())).rejects.toThrow(/not logged in.*claude login/s)
    expect(mockServiceCtor).not.toHaveBeenCalled()
    expect(claudeCodeCtor).not.toHaveBeenCalled()
  })

  it('claude-code activo + CLI no disponible + GitHub real: LANZA diciendo que no se encontró el CLI', async () => {
    getEffectiveAiSelectionMock.mockReturnValue({ provider: 'claude-code', model: 'claude-sonnet-5' })
    getCliProviderStatusMock.mockResolvedValue({ status: 'unavailable' })

    await expect(createAiService(makeGithub())).rejects.toThrow(/The "claude" CLI/)
    expect(mockServiceCtor).not.toHaveBeenCalled()
    expect(claudeCodeCtor).not.toHaveBeenCalled()
  })

  it('claude-code activo + CLI no disponible + MINERVA_MOCK=1: cae a MockAiService (demo)', async () => {
    process.env.MINERVA_MOCK = '1'
    getEffectiveAiSelectionMock.mockReturnValue({ provider: 'claude-code', model: 'claude-sonnet-5' })
    getCliProviderStatusMock.mockResolvedValue({ status: 'unavailable' })

    await createAiService(makeGithub())

    expect(mockServiceCtor).toHaveBeenCalledTimes(1)
    expect(claudeCodeCtor).not.toHaveBeenCalled()
  })

  it('codex activo + CLI autenticado: instancia CodexAiService (T29)', async () => {
    getEffectiveAiSelectionMock.mockReturnValue({ provider: 'codex', model: 'gpt-5.5' })
    getCliProviderStatusMock.mockResolvedValue({ status: 'authenticated' })
    const github = makeGithub()

    await createAiService(github)

    expect(codexCtor).toHaveBeenCalledExactlyOnceWith(github)
    expect(mockServiceCtor).not.toHaveBeenCalled()
    expect(getCliProviderStatusMock).toHaveBeenCalledExactlyOnceWith('codex')
  })

  it('codex activo + CLI no disponible + GitHub real: LANZA diciendo que no se encontró el CLI', async () => {
    getEffectiveAiSelectionMock.mockReturnValue({ provider: 'codex', model: 'gpt-5.5' })
    getCliProviderStatusMock.mockResolvedValue({ status: 'unavailable' })

    await expect(createAiService(makeGithub())).rejects.toThrow(/The "codex" CLI/)
    expect(mockServiceCtor).not.toHaveBeenCalled()
    expect(codexCtor).not.toHaveBeenCalled()
  })

  it('opencode activo + server con upstream conectado: instancia OpenCodeAiService (T57)', async () => {
    getEffectiveAiSelectionMock.mockReturnValue({ provider: 'opencode', model: 'opencode/big-pickle' })
    getCliProviderStatusMock.mockResolvedValue({ status: 'authenticated' })
    const github = makeGithub()

    await createAiService(github)

    expect(opencodeCtor).toHaveBeenCalledExactlyOnceWith(github)
    expect(mockServiceCtor).not.toHaveBeenCalled()
    expect(getCliProviderStatusMock).toHaveBeenCalledExactlyOnceWith('opencode')
  })

  it('opencode activo + binario instalado sin upstream conectado + GitHub real: LANZA sugiriendo «opencode auth login»', async () => {
    getEffectiveAiSelectionMock.mockReturnValue({ provider: 'opencode', model: 'opencode/big-pickle' })
    getCliProviderStatusMock.mockResolvedValue({ status: 'installed' })

    await expect(createAiService(makeGithub())).rejects.toThrow(/opencode auth login/)
    expect(mockServiceCtor).not.toHaveBeenCalled()
    expect(opencodeCtor).not.toHaveBeenCalled()
  })

  it('opencode activo + binario no disponible + GitHub real: LANZA diciendo que no se encontró el CLI', async () => {
    getEffectiveAiSelectionMock.mockReturnValue({ provider: 'opencode', model: 'opencode/big-pickle' })
    getCliProviderStatusMock.mockResolvedValue({ status: 'unavailable' })

    await expect(createAiService(makeGithub())).rejects.toThrow(/The "opencode" CLI/)
    expect(mockServiceCtor).not.toHaveBeenCalled()
    expect(opencodeCtor).not.toHaveBeenCalled()
  })

  it('opencode activo + binario no disponible + MINERVA_MOCK=1: cae a MockAiService (demo)', async () => {
    process.env.MINERVA_MOCK = '1'
    getEffectiveAiSelectionMock.mockReturnValue({ provider: 'opencode', model: 'opencode/big-pickle' })
    getCliProviderStatusMock.mockResolvedValue({ status: 'unavailable' })

    await createAiService(makeGithub())

    expect(mockServiceCtor).toHaveBeenCalledTimes(1)
    expect(opencodeCtor).not.toHaveBeenCalled()
  })
})
