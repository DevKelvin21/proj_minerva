import { describe, expect, it, vi } from 'vitest'
import type { ScmProviderSettings } from '../../shared/scm'
import type { SetProviderSettingsRequest } from '../../shared/types'
import { createAzureOrgAccess, type SettingsSaveDeps } from './azure-org-access'
import type { ConfirmFn } from './confirm'

function setup(initial: { enabled?: boolean; orgs?: string[]; known?: string[] } = {}) {
  let settings: ScmProviderSettings = {
    github: { enabled: true },
    azure: {
      enabled: initial.enabled ?? true,
      organizations: (initial.orgs ?? ['Contoso']).map((organization) => ({
        organization,
        projects: [],
      })),
    },
  }
  let clock = 1_000_000
  const access = createAzureOrgAccess({
    current: () => settings,
    knownOrganizations: () => initial.known ?? ['FromAz'],
    now: () => clock,
  })
  const saveDeps = {
    save: vi.fn<SettingsSaveDeps['save']>((req: SetProviderSettingsRequest) => {
      if (req.azure) settings = { ...settings, azure: req.azure }
    }),
    invalidateAzure: vi.fn<SettingsSaveDeps['invalidateAzure']>(),
    invalidateStacks: vi.fn<SettingsSaveDeps['invalidateStacks']>(),
  }
  return {
    access,
    saveDeps,
    advance: (ms: number) => {
      clock += ms
    },
  }
}

const yes: ConfirmFn = async () => true
const no: ConfirmFn = async () => false
const azureReq = (orgs: string[], enabled = true): SetProviderSettingsRequest => ({
  azure: { enabled, organizations: orgs.map((organization) => ({ organization, projects: [] })) },
})

describe('ensureProjectsLookupAllowed', () => {
  it('trusts configured and az-known orgs (case-insensitive) without asking', async () => {
    const { access } = setup()
    const confirm = vi.fn(no)
    await access.ensureProjectsLookupAllowed('contoso', confirm)
    await access.ensureProjectsLookupAllowed('FROMAZ', confirm)
    expect(confirm).not.toHaveBeenCalled()
  })

  it('asks for an unknown org; an approval lasts for the session', async () => {
    const { access } = setup()
    const confirm = vi.fn(yes)
    await access.ensureProjectsLookupAllowed('Typed', confirm)
    await access.ensureProjectsLookupAllowed('typed', confirm)
    expect(confirm).toHaveBeenCalledOnce()
    expect(confirm.mock.calls[0][0].message).toBe(
      'Load the projects of Azure DevOps organization Typed?',
    )
    expect(confirm.mock.calls[0][0].detail).toContain('https://dev.azure.com/Typed')
  })

  it('a decline is FORBIDDEN, and the same org is refused without a dialog for a while', async () => {
    const { access, advance } = setup()
    const confirm = vi.fn(no)
    await expect(access.ensureProjectsLookupAllowed('Evil', confirm)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    await expect(access.ensureProjectsLookupAllowed('evil', confirm)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    expect(confirm).toHaveBeenCalledOnce()
    advance(31_000)
    await expect(access.ensureProjectsLookupAllowed('evil', confirm)).rejects.toThrow()
    expect(confirm).toHaveBeenCalledTimes(2)
  })

  it('only one dialog at a time: a second request while one is open is RATE_LIMITED', async () => {
    const { access } = setup()
    let release: (ok: boolean) => void = () => {}
    const pending: ConfirmFn = () => new Promise((resolve) => (release = resolve))
    const first = access.ensureProjectsLookupAllowed('One', pending)
    await expect(access.ensureProjectsLookupAllowed('Two', yes)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    })
    release(true)
    await expect(first).resolves.toBeUndefined()
  })

  it('respects the enabled flag: with Azure off even configured orgs need a confirmation', async () => {
    const { access } = setup({ enabled: false })
    const confirm = vi.fn(yes)
    await access.ensureProjectsLookupAllowed('Contoso', confirm)
    expect(confirm).toHaveBeenCalledOnce()
    expect(confirm.mock.calls[0][0].detail).toContain('turned off')
  })
})

describe('saveSettings', () => {
  it('saves configured / known orgs without asking', async () => {
    const { access, saveDeps } = setup()
    const confirm = vi.fn(no)
    await expect(
      access.saveSettings(azureReq(['contoso', 'FromAz']), confirm, saveDeps),
    ).resolves.toBe(true)
    expect(confirm).not.toHaveBeenCalled()
    expect(saveDeps.save).toHaveBeenCalledOnce()
  })

  it('confirms a new org; declining saves nothing', async () => {
    const { access, saveDeps } = setup()
    const confirm = vi.fn(no)
    await expect(
      access.saveSettings(azureReq(['Contoso', 'NewOrg']), confirm, saveDeps),
    ).resolves.toBe(false)
    expect(confirm.mock.calls[0][0].message).toBe('Add Azure DevOps organization NewOrg?')
    expect(saveDeps.save).not.toHaveBeenCalled()
    expect(saveDeps.invalidateAzure).not.toHaveBeenCalled()
  })

  it('an org approved while loading its projects is not asked again on save', async () => {
    const { access, saveDeps } = setup()
    await access.ensureProjectsLookupAllowed('Typed', yes)
    const confirm = vi.fn(no)
    await expect(access.saveSettings(azureReq(['Typed']), confirm, saveDeps)).resolves.toBe(true)
    expect(confirm).not.toHaveBeenCalled()
  })

  it('drops the credential cache only when the org set changed, at most once per interval', async () => {
    const { access, saveDeps, advance } = setup()
    // Same set (case aside), only the flag changes: cheap caches only.
    await access.saveSettings(azureReq(['CONTOSO'], false), yes, saveDeps)
    expect(saveDeps.invalidateAzure).toHaveBeenLastCalledWith({ credentials: false })
    // A GitHub-only save doesn't touch the org set either.
    await access.saveSettings({ github: { enabled: false } }, yes, saveDeps)
    expect(saveDeps.invalidateAzure).toHaveBeenLastCalledWith({ credentials: false })

    await access.saveSettings(azureReq(['Contoso', 'FromAz']), yes, saveDeps)
    expect(saveDeps.invalidateAzure).toHaveBeenLastCalledWith({ credentials: true })
    // A loop flipping the set: rate-limited.
    await access.saveSettings(azureReq(['Contoso']), yes, saveDeps)
    expect(saveDeps.invalidateAzure).toHaveBeenLastCalledWith({ credentials: false })
    advance(10_000)
    await access.saveSettings(azureReq(['Contoso', 'FromAz']), yes, saveDeps)
    expect(saveDeps.invalidateAzure).toHaveBeenLastCalledWith({ credentials: true })
    expect(saveDeps.invalidateStacks).toHaveBeenCalledTimes(5)
  })
})
