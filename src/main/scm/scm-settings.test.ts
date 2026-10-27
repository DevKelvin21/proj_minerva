import { describe, expect, it } from 'vitest'
import type { PersistedScmSettings } from '../settings/store'
import { createScmSettings, type ScmSettingsDeps } from './scm-settings'

const MOCK_ORGS = [{ organization: 'contoso', projects: ['Platform'] }]

function deps(
  saved: PersistedScmSettings = {},
  azDefaults: { organization?: string; project?: string } = {},
  mock = false,
): ScmSettingsDeps & { saved: () => PersistedScmSettings } {
  let current = saved
  return {
    store: {
      getScmSettings: () => current,
      setScmSettings: (next) => {
        current = next
      },
    },
    readAzDefaults: async () => ({ ...azDefaults, knownOrganizations: [] }),
    isMock: () => mock,
    mockAzureOrganizations: MOCK_ORGS,
    saved: () => current,
  }
}

describe('scm settings', () => {
  it('defaults: GitHub on; Azure from az devops defaults when nothing is saved', async () => {
    const settings = createScmSettings(deps({}, { organization: 'Skyllful', project: 'VCB' }))
    await settings.load()
    expect(settings.current()).toEqual({
      providers: {
        github: { enabled: true },
        azure: { enabled: true, organizations: [{ organization: 'Skyllful', projects: ['VCB'] }] },
      },
      azureSettingsSource: 'az-cli-defaults',
    })
  })

  it('Azure is off with no organizations when neither saved nor configured in az', async () => {
    const settings = createScmSettings(deps())
    await settings.load()
    expect(settings.current().providers.azure).toEqual({ enabled: false, organizations: [] })
    expect(settings.current().azureSettingsSource).toBe('none')
  })

  it('a failing az defaults read is the same as none', async () => {
    const d = deps()
    d.readAzDefaults = async () => {
      throw new Error('EACCES')
    }
    const settings = createScmSettings(d)
    await settings.load()
    expect(settings.current().azureSettingsSource).toBe('none')
  })

  it('saved settings win over the az defaults, and save() merges per provider', async () => {
    const d = deps({ github: { enabled: false } }, { organization: 'Skyllful' })
    const settings = createScmSettings(d)
    await settings.load()
    const next = settings.save({
      azure: { enabled: true, organizations: [{ organization: 'Other', projects: ['A', 'B'] }] },
    })
    expect(next.providers).toEqual({
      github: { enabled: false },
      azure: { enabled: true, organizations: [{ organization: 'Other', projects: ['A', 'B'] }] },
    })
    expect(next.azureSettingsSource).toBe('saved')
    expect(d.saved().github).toEqual({ enabled: false })
  })

  it('rejects an invalid save without persisting', async () => {
    const d = deps()
    const settings = createScmSettings(d)
    expect(() =>
      settings.save({
        azure: { enabled: true, organizations: [{ organization: 'bad org!', projects: [] }] },
      }),
    ).toThrow()
    expect(d.saved()).toEqual({})
  })

  it('mock mode always serves the mock org, honoring only the enabled flag', async () => {
    const settings = createScmSettings(
      deps(
        { azure: { enabled: false, organizations: [{ organization: 'Real', projects: [] }] } },
        { organization: 'Skyllful' },
        true,
      ),
    )
    await settings.load()
    expect(settings.current().providers.azure).toEqual({ enabled: false, organizations: MOCK_ORGS })
    const fresh = createScmSettings(deps({}, { organization: 'Skyllful' }, true))
    await fresh.load()
    expect(fresh.current().providers.azure).toEqual({ enabled: true, organizations: MOCK_ORGS })
  })
})
