/**
 * Effective per-provider SCM settings: what is saved in settings.json
 * (`scm`, see `../settings/store.ts`) or, for what was never saved, the
 * defaults:
 *
 * - GitHub: enabled.
 * - Azure DevOps: from `az devops configure --defaults` (read once per
 *   process with `readAzDevopsDefaults`, never written back): enabled with
 *   that organization (and its default project, if any) when one is found;
 *   disabled with no organizations otherwise.
 *
 * In mock mode (`MINERVA_MOCK=1`) the Azure provider always serves the
 * "contoso" universe whatever organizations are saved; only the enabled flag
 * is honored (default: on), so a dev machine's real `az` config never leaks
 * into the demo or the e2e suite.
 *
 * `load()` must run once before `current()`: the az defaults are async, and
 * the registry needs a synchronous answer for "is this provider enabled".
 */
import type { ScmProviderSettings } from '../../shared/scm'
import type { ScmSettingsInfo, SetProviderSettingsRequest } from '../../shared/types'
import { ScmError } from './errors'
import type { AzDevopsDefaults } from './azure/credentials'
import type { PersistedScmSettings } from '../settings/store'
import { isPersistedScmSettings } from '../settings/store'

export interface EffectiveScmSettings {
  providers: ScmProviderSettings
  azureSettingsSource: ScmSettingsInfo['azureSettingsSource']
}

export interface ScmSettingsStore {
  getScmSettings(): PersistedScmSettings
  setScmSettings(next: PersistedScmSettings): void
}

export interface ScmSettingsDeps {
  store: ScmSettingsStore
  readAzDefaults: () => Promise<AzDevopsDefaults>
  isMock: () => boolean
  mockAzureOrganizations: ScmProviderSettings['azure']['organizations']
}

export interface ScmSettingsService {
  /** Reads the az defaults (once). Safe to call again; later calls are no-ops. */
  load(): Promise<void>
  current(): EffectiveScmSettings
  /** Validates, persists and answers the new effective settings. */
  save(req: SetProviderSettingsRequest): EffectiveScmSettings
}

export function createScmSettings(deps: ScmSettingsDeps): ScmSettingsService {
  let defaults: AzDevopsDefaults | null = null
  let loading: Promise<void> | null = null

  const azureFromDefaults = (): EffectiveScmSettings['providers']['azure'] | null => {
    const organization = defaults?.organization
    if (!organization) return null
    return {
      enabled: true,
      organizations: [{ organization, projects: defaults?.project ? [defaults.project] : [] }],
    }
  }

  const current = (): EffectiveScmSettings => {
    const saved = deps.store.getScmSettings()
    const github = saved.github ?? { enabled: true }
    if (deps.isMock()) {
      return {
        providers: {
          github,
          azure: {
            enabled: saved.azure?.enabled ?? true,
            organizations: deps.mockAzureOrganizations,
          },
        },
        azureSettingsSource: saved.azure ? 'saved' : 'none',
      }
    }
    if (saved.azure) {
      return { providers: { github, azure: saved.azure }, azureSettingsSource: 'saved' }
    }
    const fromCli = azureFromDefaults()
    return fromCli
      ? { providers: { github, azure: fromCli }, azureSettingsSource: 'az-cli-defaults' }
      : {
          providers: { github, azure: { enabled: false, organizations: [] } },
          azureSettingsSource: 'none',
        }
  }

  return {
    load() {
      if (defaults) return Promise.resolve()
      if (!loading) {
        loading = deps
          .readAzDefaults()
          .then((result) => {
            defaults = result
          })
          .catch(() => {
            defaults = { knownOrganizations: [] }
          })
      }
      return loading
    },
    current,
    save(req) {
      const saved = deps.store.getScmSettings()
      const next: PersistedScmSettings = { ...saved }
      if (req.github) next.github = { enabled: req.github.enabled }
      if (req.azure) {
        next.azure = {
          enabled: req.azure.enabled,
          organizations: req.azure.organizations.map((entry) => ({
            organization: entry.organization,
            projects: [...entry.projects],
          })),
        }
      }
      if (!isPersistedScmSettings(next)) {
        throw new ScmError('UNKNOWN', 'Invalid source-control settings.')
      }
      deps.store.setScmSettings(next)
      return current()
    },
  }
}
