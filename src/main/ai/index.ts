import type { AiService } from './service'
import type { PrContextSource } from './pr-context'
import { isMockScmMode } from '../scm/mock-mode'
import type { AiProviderId } from '../../shared/ai-providers'
import { MockAiService } from './mock-service'
import { ClaudeCodeAiService } from './providers/claude-code-service'
import { CodexAiService } from './providers/codex-service'
import { OpenCodeAiService } from './providers/opencode-service'
import { getCliProviderStatus } from './providers/cli-probe'
import { getEffectiveAiSelection } from './env'
import { mt } from '../i18n'

export type { AiService } from './service'

/**
 * Punto único de selección de implementación de `AiService` (T9-final;
 * generalizado a multi-proveedor en T27, ver `../../shared/ai-providers.ts` y
 * `getEffectiveAiSelection` en `./env.ts`). Hasta T59 existía un cuarto caso,
 * `openrouter` (`OpenRouterAiService`, HTTP directo con `openrouter.ai`),
 * resuelto síncrono según hubiera o no `OPENROUTER_API_KEY` — eliminado por
 * decisión de Edilson: quien quiera esos modelos los usa DENTRO de OpenCode.
 *
 * `createAiService` lee el proveedor ACTIVO (settings > env >
 * default, ver `getEffectiveAiSelection`) y delega en
 * `createAiServiceForProvider` para instanciar la implementación concreta;
 * los TRES proveedores son `cli` (`./providers/registry.ts`) y comparten el
 * mismo criterio:
 * - `claude-code` (T28): `ClaudeCodeAiService` (`./providers/claude-code-service.ts`,
 *   Agent SDK oficial) SOLO si `./providers/cli-probe.ts` reporta
 *   `'authenticated'` (CLI instalado Y con sesión — best-effort, ver ese
 *   archivo). Por esto `createAiServiceForProvider`/`createAiService` son
 *   ASYNC desde T28: el probe de CLI (`getCliProviderStatus`) puede spawnear
 *   un proceso corto (`claude --version`) para confirmar que el binario existe.
 * - `codex` (T29): `CodexAiService` (`./providers/codex-service.ts`, `codex
 *   app-server` oficial vía JSON-RPC) SOLO si `getCliProviderStatus('codex')`
 *   reporta `'authenticated'` — mismo criterio y mismo espíritu que el caso
 *   `claude-code` de arriba (el probe sigue siendo el heurístico best-effort
 *   de `./providers/cli-probe.ts`, sin handshake real; T29 decidió, igual
 *   que T28, no encarecer ese hot path).
 * - `opencode` (T57): `OpenCodeAiService` (`./providers/opencode-service.ts`,
 *   server local hablado por SDK oficial) SOLO si `getCliProviderStatus('opencode')`
 *   reporta `'authenticated'` (binario+versión OK Y al menos un upstream
 *   `connected`, ver el comentario de `./providers/cli-probe.ts`).
 *
 * When the active provider can't be initialized (CLI missing or signed out),
 * the behavior depends on the SCM mode:
 * - With `MINERVA_MOCK=1` (mock SCM data): fall back to `MockAiService` with a
 *   `console.warn`, so the credential-less demo/e2e keeps working.
 * - With real SCM data: THROW with the concrete cause and the remedy. Falling
 *   back to the mock there made every real PR fail with a misleading "not
 *   found" (the mock only knows the shopwave PRs).
 *
 * Independent of `MINERVA_MOCK`: mock SCM data + a real, signed-in AI provider
 * is a valid combo (try the real AI on mock PRs). That's why the factory takes
 * the active `PrContextSource` as a dependency instead of building its own.
 */
/**
 * Active provider not usable: with mock SCM data, degrade to the AI mock
 * (credential-less demo); with real data, throw `reason` as is so the panel
 * shows the cause and the remedy instead of a misleading error.
 */
function mockFallbackOrThrow(reason: string, context: PrContextSource): AiService {
  if (isMockScmMode()) {
    console.warn('[ai] ' + reason + ' SCM is in mock mode: using MockAiService.')
    return new MockAiService(context)
  }
  throw new Error(reason)
}

/** Mensaje para un proveedor `cli` no utilizable, según lo que reportó el probe. */
function cliUnavailableReason(
  label: string,
  binary: string,
  status: 'unavailable' | 'installed',
): string {
  if (status === 'installed') {
    return mt('ai.provider.notLoggedIn', { provider: label, binary })
  }
  return mt('ai.provider.cliNotFound', { provider: label, binary })
}

async function createAiServiceForProvider(
  provider: AiProviderId,
  context: PrContextSource,
): Promise<AiService> {
  switch (provider) {
    case 'claude-code': {
      const status = await getCliProviderStatus('claude-code')
      if (status.status === 'authenticated') {
        return new ClaudeCodeAiService(context)
      }
      return mockFallbackOrThrow(
        cliUnavailableReason('Claude Code', 'claude', status.status),
        context,
      )
    }
    case 'codex': {
      const status = await getCliProviderStatus('codex')
      if (status.status === 'authenticated') {
        return new CodexAiService(context)
      }
      return mockFallbackOrThrow(cliUnavailableReason('Codex', 'codex', status.status), context)
    }
    case 'opencode': {
      // El probe de opencode (T57, `./providers/cli-probe.ts`) ya encapsula
      // el criterio real de "autenticado": server local respondiendo Y ≥1
      // proveedor upstream conectado (`provider.list`). `installed` acá
      // significa "binario OK pero sin upstreams" — el remedio no es un
      // login del CLI en sí, sino conectar un proveedor DENTRO de OpenCode.
      const status = await getCliProviderStatus('opencode')
      if (status.status === 'authenticated') {
        return new OpenCodeAiService(context)
      }
      if (status.status === 'installed') {
        return mockFallbackOrThrow(mt('ai.provider.opencodeNoUpstream'), context)
      }
      return mockFallbackOrThrow(mt('ai.provider.opencodeNotFound'), context)
    }
  }
}

export async function createAiService(context: PrContextSource): Promise<AiService> {
  // Override explícito para e2e/demo determinista (F11): hasta T59 las suites
  // forzaban el mock de IA dejando al proveedor default (openrouter) sin API
  // key; con los tres proveedores actuales siendo CLIs — que en una máquina de
  // desarrollo suelen estar instalados Y autenticados — ya no existía ninguna
  // forma de pedir el mock a propósito. `MINERVA_MOCK_AI=1` lo fuerza sin
  // importar el proveedor seleccionado ni el modo de SCM (documentado en
  // CLAUDE.md § comandos/e2e).
  if (process.env.MINERVA_MOCK_AI === '1') {
    console.warn('[ai] MINERVA_MOCK_AI=1: usando MockAiService (override explícito).')
    return new MockAiService(context)
  }
  const { provider } = getEffectiveAiSelection()
  return createAiServiceForProvider(provider, context)
}
