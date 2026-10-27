/**
 * Composition root of the SCM layer: settings, both providers (mock or real,
 * by `MINERVA_MOCK`), the registry honoring each provider's enabled flag, and
 * the stacks + dashboard services, which share ONE scope cache (a cold scope
 * fetch is paid once for both). `ipc/handlers.ts` builds it once at startup.
 */
import { settingsStore } from '../settings/store'
import { createGithubProvider } from './github'
import {
  createMockAzureProvider,
  createRealAzureProvider,
  MOCK_AZURE_ORGANIZATIONS,
  type AzureScmProvider,
} from './azure'
import { readAzDevopsDefaults } from './azure/credentials'
import { isMockScmMode } from './mock-mode'
import { createScmRegistry, type ScmRegistry } from './registry'
import { createDashboardService, type DashboardService } from './dashboard-service'
import { createScopeCache } from './scope-cache'
import { createScmSettings, type ScmSettingsService } from './scm-settings'
import { createStacksService, type StacksService } from './stacks-service'

export interface DefaultScm {
  settings: ScmSettingsService
  registry: ScmRegistry
  azure: AzureScmProvider
  stacks: StacksService
  dashboard: DashboardService
  /**
   * Drops every cached PR listing (scope, stacks, dashboard). Call it after a
   * write that changes PRs (retarget) or a change of settings / account.
   */
  invalidateListCaches(): void
}

export async function createDefaultScm(): Promise<DefaultScm> {
  const settings = createScmSettings({
    store: settingsStore,
    readAzDefaults: () => readAzDevopsDefaults(),
    isMock: isMockScmMode,
    mockAzureOrganizations: MOCK_AZURE_ORGANIZATIONS,
  })
  await settings.load()

  const azureConfig = (): ReturnType<ScmSettingsService['current']>['providers']['azure'] =>
    settings.current().providers.azure
  const azure = isMockScmMode()
    ? createMockAzureProvider(azureConfig)
    : createRealAzureProvider(azureConfig)
  const registry = createScmRegistry(
    [createGithubProvider(), azure],
    (id) => settings.current().providers[id].enabled,
  )
  const scope = createScopeCache()
  const stacks = createStacksService(registry, { scope })
  const dashboard = createDashboardService(registry, { scope })
  return {
    settings,
    registry,
    azure,
    stacks,
    dashboard,
    invalidateListCaches() {
      scope.invalidate()
      stacks.invalidate()
      dashboard.invalidate()
    },
  }
}
