import { describe, expect, it } from 'vitest'
import type { ScmAuthStatus, ScmProviderId } from '../../../shared/scm'
import type { ScmSettingsInfo } from '../../../shared/types'
import {
  azDevopsLoginCommand,
  enabledProviders,
  identityLabel,
  providerAuthViews,
  providerReadiness,
  scmConnection,
} from './scm-connection'

function settings(github: boolean, azure: boolean): ScmSettingsInfo {
  return {
    mockScm: true,
    githubAccount: null,
    providers: {
      github: { enabled: github },
      azure: { enabled: azure, organizations: [{ organization: 'contoso', projects: ['P'] }] },
    },
    azureSettingsSource: 'none',
  }
}

const signedIn = (provider: ScmProviderId): ScmAuthStatus => ({
  provider,
  state: 'signed_in',
  user: { login: provider + '-user' },
})

function statuses(
  github: ScmAuthStatus['state'],
  azure: ScmAuthStatus['state'],
): Record<ScmProviderId, ScmAuthStatus> {
  return {
    github: github === 'signed_in' ? signedIn('github') : { provider: 'github', state: github },
    azure: azure === 'signed_in' ? signedIn('azure') : { provider: 'azure', state: azure },
  }
}

describe('enabledProviders', () => {
  it('follows the settings flags once they load', () => {
    expect(enabledProviders(settings(true, true), null)).toEqual(['github', 'azure'])
    expect(enabledProviders(settings(false, true), statuses('signed_in', 'signed_in'))).toEqual([
      'azure',
    ])
    expect(enabledProviders(settings(false, false), null)).toEqual([])
  })

  it('falls back to non-disabled statuses, then to unknown', () => {
    expect(enabledProviders(null, statuses('disabled', 'signed_in'))).toEqual(['azure'])
    expect(enabledProviders(null, null)).toBeNull()
  })
})

describe('providerReadiness', () => {
  it('maps every auth state', () => {
    expect(providerReadiness(undefined)).toBe('checking')
    expect(providerReadiness(signedIn('github'))).toBe('ready')
    expect(providerReadiness({ provider: 'github', state: 'cli_unavailable' })).toBe(
      'cli_unavailable',
    )
    expect(providerReadiness({ provider: 'azure', state: 'cli_unauthenticated' })).toBe(
      'signed_out',
    )
    // Enabled in Settings but `disabled` from main = Azure without an organization.
    expect(providerReadiness({ provider: 'azure', state: 'disabled' })).toBe('not_configured')
  })
})

describe('scmConnection', () => {
  const views = (
    enabled: ScmProviderId[],
    map: Record<ScmProviderId, ScmAuthStatus> | null,
  ): ReturnType<typeof providerAuthViews> => providerAuthViews(enabled, map)

  it('reports the IPC failure first', () => {
    expect(scmConnection('error', views(['github'], statuses('signed_in', 'disabled')))).toBe(
      'error',
    )
  })

  it('waits for the ping, the settings and every enabled provider', () => {
    expect(scmConnection('checking', [])).toBe('checking')
    expect(scmConnection('connected', null)).toBe('checking')
    expect(scmConnection('connected', views(['github', 'azure'], null))).toBe('checking')
  })

  it('is connected only when every enabled provider is signed in', () => {
    expect(
      scmConnection('connected', views(['github', 'azure'], statuses('signed_in', 'signed_in'))),
    ).toBe('connected')
    expect(
      scmConnection('connected', views(['azure'], statuses('cli_unavailable', 'signed_in'))),
    ).toBe('connected')
  })

  it('shows a partial failure (Azure signed in, gh missing)', () => {
    expect(
      scmConnection(
        'connected',
        views(['github', 'azure'], statuses('cli_unavailable', 'signed_in')),
      ),
    ).toBe('partial')
  })

  it('is signed out when no enabled provider is ready, and says when none is on', () => {
    expect(
      scmConnection('connected', views(['azure'], statuses('signed_in', 'cli_unauthenticated'))),
    ).toBe('signed_out')
    expect(scmConnection('connected', [])).toBe('no_providers')
  })
})

describe('labels and commands', () => {
  it('prefers the display name', () => {
    expect(
      identityLabel({
        provider: 'azure',
        state: 'signed_in',
        user: { login: 'ada@contoso.example', displayName: 'Ada Lovelace' },
      }),
    ).toBe('Ada Lovelace')
    expect(identityLabel(signedIn('github'))).toBe('github-user')
    expect(identityLabel(undefined)).toBe('')
  })

  it('builds the org-specific az devops login command', () => {
    expect(azDevopsLoginCommand('contoso')).toBe(
      'az devops login --organization https://dev.azure.com/contoso',
    )
    expect(azDevopsLoginCommand('My Org')).toBe(
      'az devops login --organization https://dev.azure.com/My%20Org',
    )
    expect(azDevopsLoginCommand(undefined)).toBe('az devops login')
  })
})
