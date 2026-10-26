/**
 * Agregado de estado de login por proveedor (T27) que consume el handler del
 * canal IPC `ai:getProviderStatus` (`../../ipc/handlers.ts`): un `Record` con
 * TODOS los proveedores del catálogo (`AI_PROVIDER_IDS`), cada uno resuelto
 * vía `./cli-probe.ts` (con su propio timeout+cache — nunca bloqueante).
 *
 * Hasta T59 este agregado también distinguía un proveedor `api-key`
 * (OpenRouter, resuelto síncrono contra `getAiEnv().openRouterApiKey`) de los
 * proveedores `cli` — eliminado por decisión de Edilson: hoy los tres
 * proveedores (`./registry.ts`) son `cli`, así que el agregado delega
 * directo en el probe para todos.
 *
 * Mismo patrón que `ghCliAuth.getStatus()` (`../../scm/github/gh-cli-auth.ts`):
 * estado expuesto sin secretos, calculado on-demand (no hay estado propio que
 * mantener acá, todo vive en `getCliProviderStatus`).
 */
import { AI_PROVIDER_IDS, type AiProviderId } from '../../../shared/ai-providers'
import type { AiProviderStatus } from '../../../shared/types'
import { getCliProviderStatus } from './cli-probe'

export async function getAiProviderStatusMap(): Promise<Record<AiProviderId, AiProviderStatus>> {
  const entries = await Promise.all(
    AI_PROVIDER_IDS.map(async (provider): Promise<[AiProviderId, AiProviderStatus]> => [
      provider,
      await getCliProviderStatus(provider),
    ]),
  )
  return Object.fromEntries(entries) as Record<AiProviderId, AiProviderStatus>
}
