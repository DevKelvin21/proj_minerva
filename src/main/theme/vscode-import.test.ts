import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  isCanonicalThemeColor,
  parseThemeColor,
  themeContrastRatio,
  themeOklchToRgb,
} from '../../shared/theme/color'
import { parseJsonc } from '../../shared/theme/jsonc'
import { getThemeModes, THEME_COLOR_ROLES, ThemeFileError } from '../../shared/theme/themes'
import {
  isVsCodeThemeFile,
  pairVsCodeThemes,
  parseVsCodeThemeFile,
  sanitizeVsCodeColors,
} from '../../shared/theme/vscode-import'

const fixture = parseJsonc(
  readFileSync(join(process.cwd(), 'e2e/fixtures/vscode-night-owl-lite.jsonc'), 'utf-8'),
)

function contrast(a: string, b: string): number {
  return themeContrastRatio(
    themeOklchToRgb(parseThemeColor(a)!.color),
    themeOklchToRgb(parseThemeColor(b)!.color),
  )
}

describe('parseJsonc', () => {
  it('reads comments and trailing commas but keeps strings intact', () => {
    expect(parseJsonc('{ "a": "http://x // y", /* c */ "b": [1, 2,], // d\n }')).toEqual({
      a: 'http://x // y',
      b: [1, 2],
    })
    expect(parseJsonc('﻿{"s": "a,}"}')).toEqual({ s: 'a,}' })
    expect(() => parseJsonc('{ a: 1 }')).toThrow(SyntaxError)
  })
})

describe('parseVsCodeThemeFile', () => {
  it('recognizes the fixture as a VS Code theme', () => {
    expect(isVsCodeThemeFile(fixture)).toBe(true)
    expect(isVsCodeThemeFile({ version: 1, name: 'x', colors: {} })).toBe(false)
  })

  it('builds a dark palette from the workbench colors', () => {
    const theme = parseVsCodeThemeFile(fixture)
    expect(theme.id).toBe('harbor-night')
    expect(theme.label).toBe('Harbor Night')
    expect(getThemeModes(theme)).toEqual(['dark'])
    for (const role of THEME_COLOR_ROLES)
      expect(isCanonicalThemeColor(theme.colors[role])).toBe(true)
    expect(contrast(theme.colors.canvas, '#0b1622')).toBeLessThan(1.01)
    expect(contrast(theme.colors.accent, '#f78c6c')).toBeLessThan(1.01)
    expect(contrast(theme.colors.text, theme.colors.canvas)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(theme.colors.accentForeground, theme.colors.accent)).toBeGreaterThanOrEqual(4.5)
  })

  it('drops keys it does not read, and every hostile value with them', () => {
    const colors = sanitizeVsCodeColors((fixture as { colors: unknown }).colors)
    expect(colors['statusBar.background']).toBeUndefined()
    expect(colors['editor.lineHighlightBackground']).toBeUndefined()
    const serialized = JSON.stringify(parseVsCodeThemeFile(fixture))
    expect(serialized).not.toContain('url(')
    expect(serialized).not.toContain(';')
  })

  it('ignores an unparsable color instead of passing it through', () => {
    const theme = parseVsCodeThemeFile({
      type: 'light',
      colors: { 'editor.background': '#ffffff', focusBorder: 'expression(alert(1))' },
    })
    expect(JSON.stringify(theme)).not.toContain('expression')
  })

  it('refuses a theme without an editor background', () => {
    expect(() => parseVsCodeThemeFile({ colors: { 'editor.foreground': '#fff' } })).toThrowError(
      ThemeFileError,
    )
  })

  it('pairs "X Light" and "X Dark" into one theme with both halves', () => {
    const light = parseVsCodeThemeFile({
      name: 'Harbor Light',
      type: 'light',
      colors: { 'editor.background': '#fbfbfb', focusBorder: '#0b72b9' },
    })
    const dark = parseVsCodeThemeFile({ ...(fixture as object), name: 'Harbor Dark' })
    const paired = pairVsCodeThemes([light, dark])
    expect(paired).toHaveLength(1)
    expect(paired[0].label).toBe('Harbor')
    expect(getThemeModes(paired[0])).toEqual(['light', 'dark'])
  })
})
