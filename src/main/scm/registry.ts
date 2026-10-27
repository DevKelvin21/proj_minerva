/**
 * Registry of SCM providers. IPC handlers resolve a provider per repo
 * (`forRepo`) and fan list calls out over every enabled provider
 * (`listAcrossProviders`), so one failing provider never blanks the others.
 *
 * "Enabled" is evaluated on every call (`isEnabled`), so toggling a provider
 * in Settings takes effect without restarting.
 */
import type { RepoRef, ScmAuthStatus, ScmProviderId } from '../../shared/scm'
import type { ListPullRequestsResult, ScmListError } from '../../shared/types'
import { ScmError, toScmError } from './errors'
import type { ListPullRequestsQuery, ScmProvider } from './provider'

export const ALL_SCM_PROVIDER_IDS: readonly ScmProviderId[] = ['github', 'azure']

export interface ScmRegistry {
  /** The ENABLED provider with that id, or `null` (not registered or turned off). */
  get(id: ScmProviderId): ScmProvider | null
  /** Provider that owns `repo`. Throws `ScmError('NOT_FOUND')` if it isn't registered or is off. */
  forRepo(repo: RepoRef): ScmProvider
  /** Every enabled provider, in registration order. */
  enabled(): ScmProvider[]
}

export function createScmRegistry(
  providers: readonly ScmProvider[],
  isEnabled: (id: ScmProviderId) => boolean = () => true,
): ScmRegistry {
  const byId = new Map<ScmProviderId, ScmProvider>()
  for (const provider of providers) {
    if (byId.has(provider.id)) throw new Error('SCM provider registered twice: ' + provider.id)
    byId.set(provider.id, provider)
  }
  const get = (id: ScmProviderId): ScmProvider | null => {
    const provider = byId.get(id)
    return provider && isEnabled(id) ? provider : null
  }
  return {
    get,
    forRepo(repo) {
      const provider = get(repo.provider)
      if (!provider) {
        throw new ScmError('NOT_FOUND', 'Source-control provider not enabled: ' + repo.provider)
      }
      return provider
    },
    enabled: () => [...byId.values()].filter((provider) => isEnabled(provider.id)),
  }
}

export interface FanOutListResult extends ListPullRequestsResult {
  /** Providers that answered successfully (possibly with zero items). */
  okProviders: ScmProviderId[]
}

/**
 * Lists PRs on every enabled provider in parallel (`Promise.allSettled`).
 * Items keep each provider's own order, concatenated in registration order;
 * failures become typed `errors` entries instead of rejecting the whole call.
 */
export async function listAcrossProviders(
  registry: ScmRegistry,
  q: ListPullRequestsQuery,
): Promise<FanOutListResult> {
  const providers = registry.enabled()
  const settled = await Promise.allSettled(providers.map((p) => p.listPullRequests(q)))

  const items: FanOutListResult['items'] = []
  const errors: ScmListError[] = []
  const okProviders: ScmProviderId[] = []
  settled.forEach((outcome, index) => {
    const provider = providers[index].id
    if (outcome.status === 'fulfilled') {
      okProviders.push(provider)
      items.push(...outcome.value)
    } else {
      const error = toScmError(outcome.reason)
      errors.push({ provider, code: error.code, message: error.message })
    }
  })
  return { items, errors, okProviders }
}

/** Auth status of every known provider id; unregistered ones report `disabled`. */
export async function getAuthStatusMap(
  registry: ScmRegistry,
): Promise<Record<ScmProviderId, ScmAuthStatus>> {
  const entries = await Promise.all(
    ALL_SCM_PROVIDER_IDS.map(async (id): Promise<[ScmProviderId, ScmAuthStatus]> => {
      const provider = registry.get(id)
      if (!provider) return [id, { provider: id, state: 'disabled' }]
      try {
        return [id, await provider.getAuthStatus()]
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return [id, { provider: id, state: 'cli_unauthenticated', detail: message }]
      }
    }),
  )
  return Object.fromEntries(entries) as Record<ScmProviderId, ScmAuthStatus>
}
