import { describe, expect, it } from 'vitest'
import {
  isCanonicalThemeColor,
  parseThemeColor,
  themeContrastRatio,
  themeOklchToRgb,
} from './color'
import {
  createVividThemeColors,
  getBuiltInThemes,
  getThemeColorsForMode,
  parseThemeFile,
  serializeThemeFile,
  THEME_COLOR_ROLES,
  ThemeFileError,
  themeIdFromName,
  updateThemeColorFamily,
} from './themes'

function contrast(a: string, b: string): number {
  return themeContrastRatio(
    themeOklchToRgb(parseThemeColor(a)!.color),
    themeOklchToRgb(parseThemeColor(b)!.color),
  )
}

describe('built-in themes', () => {
  const themes = getBuiltInThemes()

  it('ships Minerva first, then T3 Code and its five named themes', () => {
    expect(themes.map((theme) => theme.id)).toEqual([
      'minerva',
      't3-code',
      't3-chat',
      'grove',
      'ocean',
      'ember',
      'iris',
    ])
  })

  it.each(themes.map((theme) => [theme.id, theme] as const))(
    '%s has light and dark variants with every role canonical and readable text',
    (_id, theme) => {
      for (const mode of ['light', 'dark'] as const) {
        const colors = getThemeColorsForMode(theme, mode)
        expect(colors).not.toBeNull()
        for (const role of THEME_COLOR_ROLES)
          expect(isCanonicalThemeColor(colors![role])).toBe(true)
        expect(contrast(colors!.text, colors!.canvas)).toBeGreaterThanOrEqual(4.5)
        expect(contrast(colors!.text, colors!.surface)).toBeGreaterThanOrEqual(4.5)
      }
    },
  )

  it('keeps the original Minerva dark palette', () => {
    const dark = getThemeColorsForMode(themes[0], 'dark')!
    const original = {
      canvas: '#1a1d23',
      surface: '#22262e',
      border: '#353b47',
      codeBackground: '#15181d',
      text: '#e2e5ea',
      textMuted: '#8b93a1',
      accent: '#14b8a6',
      error: '#ef4444',
      warning: '#eab308',
    } as const
    for (const [role, hex] of Object.entries(original)) {
      expect(contrast(dark[role as keyof typeof original], hex)).toBeLessThan(1.01)
    }
  })
})

describe('createVividThemeColors', () => {
  it('derives readable text and accent foreground from two seeds', () => {
    const colors = createVividThemeColors('dark', '#101820', '#f59e0b')
    expect(contrast(colors.text, colors.canvas)).toBeGreaterThanOrEqual(7)
    expect(contrast(colors.accentForeground, colors.accent)).toBeGreaterThanOrEqual(4.5)
  })
})

describe('updateThemeColorFamily', () => {
  it('moves chrome/toolbar with canvas and re-solves the accent foreground', () => {
    const base = getThemeColorsForMode(getBuiltInThemes()[0], 'dark')!
    const canvas = updateThemeColorFamily('dark', base, 'canvas', '#000000')
    expect(canvas.chrome).toBe(canvas.canvas)
    expect(canvas.toolbar).toBe(canvas.canvas)
    const accent = updateThemeColorFamily('dark', base, 'accent', '#fde047')
    expect(contrast(accent.accentForeground, accent.accent)).toBeGreaterThanOrEqual(4.5)
    expect(accent.focus).toBe(accent.accent)
  })

  it('ignores a value that is not a color', () => {
    const base = getThemeColorsForMode(getBuiltInThemes()[0], 'dark')!
    expect(updateThemeColorFamily('dark', base, 'accent', 'red; x: y')).toBe(base)
  })
})

describe('theme files', () => {
  it('round-trips through serialize/parse', () => {
    const theme = { ...getBuiltInThemes()[2], id: 'my-copy', label: 'My copy' }
    const parsed = parseThemeFile(JSON.parse(serializeThemeFile(theme)))
    expect(parsed.id).toBe('my-copy')
    expect(parsed.variants?.dark).toEqual(getThemeColorsForMode(theme, 'dark'))
  })

  it('fills missing roles and canonicalizes colors', () => {
    const parsed = parseThemeFile({
      version: 1,
      name: 'Tiny',
      appearance: 'dark',
      colors: { canvas: '#000', accent: 'rgb(255 0 0)' },
    })
    expect(parsed.id).toBe('tiny')
    expect(Object.keys(parsed.colors)).toHaveLength(THEME_COLOR_ROLES.length)
    expect(isCanonicalThemeColor(parsed.colors.canvas)).toBe(true)
  })

  it.each([
    [{ version: 2, name: 'x', appearance: 'dark', colors: { canvas: '#000' } }, 'version'],
    [{ version: 1, name: '', appearance: 'dark', colors: { canvas: '#000' } }, 'name'],
    [{ version: 1, name: 'x', appearance: 'dim', colors: { canvas: '#000' } }, 'appearance'],
    [{ version: 1, name: 'x', appearance: 'dark', colors: { nope: '#000' } }, 'unknownRole'],
    [
      { version: 1, name: 'x', appearance: 'dark', colors: { canvas: 'red;background:url(x)' } },
      'invalidColor',
    ],
    [{ version: 1, name: 'x', appearance: 'dark', colors: {} }, 'noColors'],
    [
      { version: 1, id: 'minerva', name: 'x', appearance: 'dark', colors: { canvas: '#000' } },
      'reservedId',
    ],
    [{ version: 1, id: 'Bad Id', name: 'x', appearance: 'dark', colors: { canvas: '#000' } }, 'id'],
    [
      {
        version: 1,
        name: 'x',
        appearance: 'dark',
        colors: { canvas: '#000' },
        variants: { dark: { canvas: '#111' } },
      },
      'variantRepeatsBase',
    ],
  ])('rejects %j with %s', (value, code) => {
    expect(() => parseThemeFile(value)).toThrowError(ThemeFileError)
    try {
      parseThemeFile(value)
    } catch (error) {
      expect((error as ThemeFileError).code).toBe(code)
    }
  })

  it('derives ids from names', () => {
    expect(themeIdFromName('  Solarized Dark++ ')).toBe('solarized-dark')
    expect(themeIdFromName('***')).toBe('custom-theme')
  })
})
