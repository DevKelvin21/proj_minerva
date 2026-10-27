import { describe, expect, it } from 'vitest'
import {
  DEFAULT_APPEARANCE_SETTINGS,
  isAppearanceSettings,
  resolveAppearance,
  sanitizeAppearanceSettings,
  themeCssVariables,
  themeVariableName,
  type AppearanceSettings,
} from './appearance'
import { isCanonicalThemeColor } from './color'
import {
  assignHalf,
  halvesUsing,
  importCustomThemes,
  pickTheme,
  removeCustomThemes,
  ThemeLibraryError,
  uniqueThemeId,
  upsertCustomTheme,
} from './library'
import { themesFromOpenVsxPackage } from './open-vsx-import'
import {
  getBuiltInTheme,
  getThemeColorsForMode,
  getThemeModes,
  type ThemeDefinition,
} from './themes'

const darkOnly: ThemeDefinition = {
  id: 'midnight',
  label: 'Midnight',
  appearance: 'dark',
  colors: getThemeColorsForMode(getBuiltInTheme('ocean')!, 'dark')!,
}

function withCustom(...themes: ThemeDefinition[]): AppearanceSettings {
  return { ...DEFAULT_APPEARANCE_SETTINGS, customThemes: themes }
}

describe('appearance settings', () => {
  it('defaults are valid and resolve to Minerva', () => {
    expect(isAppearanceSettings(DEFAULT_APPEARANCE_SETTINGS)).toBe(true)
    expect(resolveAppearance(DEFAULT_APPEARANCE_SETTINGS, true).theme.id).toBe('minerva')
    expect(resolveAppearance(DEFAULT_APPEARANCE_SETTINGS, false).appearance).toBe('light')
  })

  it('mode wins over the system, and each half paints its own theme', () => {
    const settings = { ...DEFAULT_APPEARANCE_SETTINGS, lightTheme: 'grove', darkTheme: 'iris' }
    expect(resolveAppearance({ ...settings, mode: 'light' }, true).theme.id).toBe('grove')
    expect(resolveAppearance({ ...settings, mode: 'dark' }, false).theme.id).toBe('iris')
    expect(resolveAppearance(settings, true).theme.id).toBe('iris')
    expect(resolveAppearance(settings, false).theme.id).toBe('grove')
  })

  it('rejects a half pointing at a theme without that variant', () => {
    expect(isAppearanceSettings({ ...withCustom(darkOnly), lightTheme: 'midnight' })).toBe(false)
    expect(isAppearanceSettings({ ...withCustom(darkOnly), darkTheme: 'midnight' })).toBe(true)
  })

  it.each([
    ['extra key', { ...DEFAULT_APPEARANCE_SETTINGS, css: 'x' }],
    ['contrast out of range', { ...DEFAULT_APPEARANCE_SETTINGS, contrast: 20 }],
    ['fractional contrast', { ...DEFAULT_APPEARANCE_SETTINGS, contrast: 100.5 }],
    ['unknown theme', { ...DEFAULT_APPEARANCE_SETTINGS, darkTheme: 'nope' }],
    [
      'non-canonical color',
      withCustom({ ...darkOnly, colors: { ...darkOnly.colors, canvas: '#000' } }),
    ],
    [
      'injected color',
      withCustom({ ...darkOnly, colors: { ...darkOnly.colors, canvas: 'oklch(0 0 0); x: y' } }),
    ],
    [
      'missing role',
      withCustom({ ...darkOnly, colors: { canvas: darkOnly.colors.canvas } as never }),
    ],
    ['reserved id', withCustom({ ...darkOnly, id: 'ocean' })],
    ['duplicate id', withCustom(darkOnly, darkOnly)],
  ])('rejects %s', (_name, value) => {
    expect(isAppearanceSettings(value)).toBe(false)
  })

  it('sanitize keeps the good parts', () => {
    const repaired = sanitizeAppearanceSettings({
      mode: 'nope',
      lightTheme: 'grove',
      darkTheme: 'gone',
      contrast: 150,
      customThemes: [darkOnly, { id: 'bad' }],
    })
    expect(repaired).toEqual({
      mode: 'system',
      lightTheme: 'grove',
      darkTheme: 'minerva',
      contrast: 150,
      customThemes: [darkOnly],
    })
    expect(sanitizeAppearanceSettings('dark')).toBeNull()
  })

  it('exposes every role plus success/merged/info and contrast as CSS variables', () => {
    const colors = getThemeColorsForMode(getBuiltInTheme('minerva')!, 'light')!
    const vars = themeCssVariables(colors, 'light', 150)
    expect(vars[themeVariableName('codeBackground')]).toBe(colors.codeBackground)
    expect(themeVariableName('surfaceRaised')).toBe('--theme-surface-raised')
    for (const name of ['--theme-success', '--theme-merged', '--theme-info']) {
      expect(isCanonicalThemeColor(vars[name])).toBe(true)
    }
    expect(vars['--appearance-contrast-base']).toBe('100%')
    expect(vars['--appearance-contrast-boost']).toBe('50%')
    expect(vars['--appearance-contrast-border-boost']).toBe('12.5%')
  })
})

describe('theme library', () => {
  it('picks a two-variant theme for both halves, a one-variant theme for its half', () => {
    expect(pickTheme(DEFAULT_APPEARANCE_SETTINGS, 'ember')).toMatchObject({
      lightTheme: 'ember',
      darkTheme: 'ember',
    })
    expect(pickTheme(withCustom(darkOnly), 'midnight')).toMatchObject({
      lightTheme: 'minerva',
      darkTheme: 'midnight',
    })
    expect(() => assignHalf(withCustom(darkOnly), 'light', 'midnight')).toThrow(ThemeLibraryError)
  })

  it('removing a theme in use resets its half', () => {
    const settings = assignHalf(withCustom(darkOnly), 'dark', 'midnight')
    expect(halvesUsing(settings, 'midnight')).toEqual(['dark'])
    const next = removeCustomThemes(settings, ['midnight'])
    expect(next.customThemes).toEqual([])
    expect(next.darkTheme).toBe('minerva')
  })

  it('never overwrites a built-in', () => {
    expect(() =>
      upsertCustomTheme(DEFAULT_APPEARANCE_SETTINGS, { ...darkOnly, id: 'grove' }),
    ).toThrow(ThemeLibraryError)
  })

  it('renames imports that clash', () => {
    const { settings, imported } = importCustomThemes(withCustom(darkOnly), [darkOnly])
    expect(imported[0].id).toBe('midnight-2')
    expect(imported[0].label).toBe('Midnight 2')
    expect(isAppearanceSettings(settings)).toBe(true)
    expect(uniqueThemeId(settings, 'Ocean')).toBe('ocean-2')
  })
})

describe('themesFromOpenVsxPackage', () => {
  const pkg = {
    extension: {
      id: 'acme.harbor',
      namespace: 'acme',
      name: 'harbor',
      displayName: 'Harbor Themes',
      description: '',
      version: '1.0.0',
      license: 'MIT',
      downloadCount: 1,
      iconUrl: null,
    },
    themes: [
      {
        label: 'Harbor Light',
        type: 'light' as const,
        path: 'extension/themes/light.json',
        colors: { 'editor.background': '#fbfbfb', focusBorder: '#0b72b9' },
      },
      {
        label: 'Harbor Dark',
        type: 'dark' as const,
        path: 'extension/themes/dark.json',
        colors: { 'editor.background': '#0b1622', focusBorder: '#f78c6c' },
      },
    ],
  }

  it('pairs light/dark into one theme tagged with the extension', () => {
    const themes = themesFromOpenVsxPackage(pkg)
    expect(themes).toHaveLength(1)
    expect(themes[0].label).toBe('Harbor')
    expect(themes[0].id).toMatch(/^ovx-[0-9a-f]{12}$/)
    expect(getThemeModes(themes[0])).toEqual(['light', 'dark'])
    expect(themes[0].collection).toEqual({ id: 'open-vsx:acme.harbor', label: 'Harbor Themes' })
  })

  it('reinstalling replaces the collection instead of duplicating it', () => {
    const first = importCustomThemes(DEFAULT_APPEARANCE_SETTINGS, themesFromOpenVsxPackage(pkg))
    const picked = pickTheme(first.settings, first.imported[0].id)
    const again = importCustomThemes(picked, themesFromOpenVsxPackage(pkg))
    expect(again.settings.customThemes).toHaveLength(1)
    expect(again.settings.darkTheme).toBe(first.imported[0].id)
    expect(isAppearanceSettings(again.settings)).toBe(true)
  })
})
