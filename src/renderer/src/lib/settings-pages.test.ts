import { describe, expect, it } from 'vitest'
import type { AiProviderStatus, UpdaterStatus } from '../../../shared/types'
import {
  DEFAULT_SETTINGS_PAGE,
  SETTINGS_PAGE_IDS,
  isSettingsPageId,
  resolveSettingsPage,
  settingsNavSections,
  settingsPageDots,
  settingsPageForScm,
  settingsSplitView,
  updateAvailable,
  visibleSettingsPages,
} from './settings-pages'

const info = { version: '1.2.3', releaseUrl: 'https://example.invalid' }

describe('settings pages', () => {
  it('recognizes page ids and nothing else (a click event is not a page)', () => {
    for (const id of SETTINGS_PAGE_IDS) expect(isSettingsPageId(id)).toBe(true)
    expect(isSettingsPageId('nope')).toBe(false)
    expect(isSettingsPageId({ type: 'click' })).toBe(false)
    expect(isSettingsPageId(undefined)).toBe(false)
  })

  it('lists Updates only while the updater runs', () => {
    expect(visibleSettingsPages({ updates: false })).not.toContain('updates')
    expect(visibleSettingsPages({ updates: true })).toContain('updates')
  })

  it('falls back to the default page when the requested one is not listed', () => {
    const visible = visibleSettingsPages({ updates: false })
    expect(resolveSettingsPage('updates', visible)).toBe(DEFAULT_SETTINGS_PAGE)
    expect(resolveSettingsPage('azure', visible)).toBe('azure')
  })

  it('groups the list by concern, in order', () => {
    expect(settingsNavSections(visibleSettingsPages({ updates: true }))).toEqual([
      { group: null, pages: ['general', 'appearance'] },
      { group: 'sourceControl', pages: ['github', 'azure'] },
      { group: 'ai', pages: ['ai-providers', 'ai-model'] },
      { group: 'app', pages: ['notifications', 'updates'] },
    ])
  })

  it('maps a source-control provider to its page', () => {
    expect(settingsPageForScm('github')).toBe('github')
    expect(settingsPageForScm('azure')).toBe('azure')
  })

  it('splits list and page from the lg tier up', () => {
    expect(settingsSplitView('xl')).toBe(true)
    expect(settingsSplitView('lg')).toBe(true)
    expect(settingsSplitView('md')).toBe(false)
    expect(settingsSplitView('sm')).toBe(false)
  })
})

describe('settingsPageDots', () => {
  const signedIn: AiProviderStatus = { status: 'authenticated' }

  it('has no dots when everything is ready', () => {
    expect(
      settingsPageDots({
        scm: [{ provider: 'github', readiness: 'ready' }],
        activeAiStatus: signedIn,
        updater: { phase: 'idle' },
      }),
    ).toEqual({})
  })

  it('flags source-control providers that need the user, not ones still checking', () => {
    expect(
      settingsPageDots({
        scm: [
          { provider: 'github', readiness: 'signed_out' },
          { provider: 'azure', readiness: 'checking' },
        ],
        activeAiStatus: undefined,
        updater: null,
      }),
    ).toEqual({ github: 'warning' })
    expect(
      settingsPageDots({
        scm: [{ provider: 'azure', readiness: 'not_configured' }],
        activeAiStatus: undefined,
        updater: null,
      }),
    ).toEqual({ azure: 'warning' })
  })

  it('flags AI providers while the active one is not signed in', () => {
    expect(
      settingsPageDots({ scm: null, activeAiStatus: { status: 'installed' }, updater: null }),
    ).toEqual({ 'ai-providers': 'warning' })
  })

  it('marks Updates with the accent when a version is available or downloaded', () => {
    const cases: [UpdaterStatus, boolean][] = [
      [{ phase: 'available', info }, true],
      [{ phase: 'downloaded', info }, true],
      [{ phase: 'downloading', info, percent: 10 }, false],
      [{ phase: 'unsupported', reason: 'mac-unsigned', available: info }, false],
      [{ phase: 'disabled' }, false],
    ]
    for (const [status, expected] of cases) {
      expect(updateAvailable(status)).toBe(expected)
      expect(
        settingsPageDots({ scm: null, activeAiStatus: signedIn, updater: status }).updates,
      ).toBe(expected ? 'accent' : undefined)
    }
  })
})
