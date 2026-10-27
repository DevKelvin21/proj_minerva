import { describe, expect, it } from 'vitest'
import {
  isCanonicalThemeColor,
  parseThemeColor,
  readableThemeColorOn,
  themeColorToHex,
  themeContrastRatio,
  themeOklchToRgb,
  toCanonicalThemeColor,
} from './color'

describe('toCanonicalThemeColor', () => {
  it.each([
    ['#fff', '#ffffff'],
    ['#14b8a6', '#14b8a6'],
    ['#14B8A6', '#14b8a6'],
    ['rgb(20, 184, 166)', '#14b8a6'],
    ['rgb(20 184 166)', '#14b8a6'],
    ['rgba(20,184,166,1)', '#14b8a6'],
    ['hsl(0 100% 50%)', '#ff0000'],
    ['hsl(120, 100%, 50%)', '#00ff00'],
    ['color(srgb 1 0 0)', '#ff0000'],
    ['oklch(0.62 0.2 280)', null],
    ['oklab(0.5 0 0)', null],
  ])('parses %s', (input, expectedHex) => {
    const canonical = toCanonicalThemeColor(input)
    expect(canonical).not.toBeNull()
    expect(isCanonicalThemeColor(canonical)).toBe(true)
    if (expectedHex) expect(themeColorToHex(canonical as string)).toBe(expectedHex)
  })

  it('keeps translucency', () => {
    const canonical = toCanonicalThemeColor('#ff000080')
    expect(canonical).toMatch(/ \/ 0\.502\)$/)
    expect(themeColorToHex(canonical as string)).toBe('#ff000080')
  })

  it('round-trips its own output', () => {
    const once = toCanonicalThemeColor('#3b82f6') as string
    expect(toCanonicalThemeColor(once)).toBe(once)
  })

  it.each([
    'red',
    'url(x)',
    '#12',
    '#gggggg',
    'rgb(1 2)',
    'rgb(1, 2 3)',
    'rgb(1 2 3; background: url(x))',
    'oklch(0.5 0.1 120) ; color: red',
    'var(--x)',
    'calc(1px)',
    'expression(alert(1))',
    'oklch(NaN 0 0)',
    'rgb(1e999 0 0)',
    '',
    'x'.repeat(200),
  ])('rejects %j', (input) => {
    expect(parseThemeColor(input)).toBeNull()
    expect(toCanonicalThemeColor(input)).toBeNull()
  })

  it('rejects non-strings', () => {
    expect(toCanonicalThemeColor(42)).toBeNull()
    expect(toCanonicalThemeColor({ toString: () => '#fff' })).toBeNull()
    expect(toCanonicalThemeColor(null)).toBeNull()
  })
})

describe('isCanonicalThemeColor', () => {
  it('accepts only the printed form', () => {
    expect(isCanonicalThemeColor('oklch(0.5 0.1 120)')).toBe(true)
    expect(isCanonicalThemeColor('oklch(0.5 0.1 120 / 0.5)')).toBe(true)
    expect(isCanonicalThemeColor('oklch(1 0 0)')).toBe(true)
    expect(isCanonicalThemeColor('#ffffff')).toBe(false)
    expect(isCanonicalThemeColor('oklch(0.5 0.1 120);x')).toBe(false)
    expect(isCanonicalThemeColor('oklch( 0.5 0.1 120)')).toBe(false)
    expect(isCanonicalThemeColor('oklch(2 0.1 120)')).toBe(false)
  })
})

describe('readableThemeColorOn', () => {
  it('leaves a readable color alone and fixes a dim one', () => {
    expect(readableThemeColorOn('#ffffff', '#000000', 4.5)).toBe('#ffffff')
    const fixed = readableThemeColorOn('#333333', '#222222', 4.5)
    const fixedRgb = themeOklchToRgb(parseThemeColor(fixed)!.color)
    const surface = themeOklchToRgb(parseThemeColor('#222222')!.color)
    expect(themeContrastRatio(fixedRgb, surface)).toBeGreaterThanOrEqual(4.5)
  })
})

describe('canonical form bounds', () => {
  it('prints out-of-gamut chroma inside what the validator accepts', () => {
    const canonical = toCanonicalThemeColor('oklch(0.5 150 0)')
    expect(isCanonicalThemeColor(canonical)).toBe(true)
  })
})
