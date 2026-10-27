/**
 * Renderer theme files that are not TypeScript: the CSS defaults in
 * `styles.css` (must equal the Minerva theme, or the first frame before the
 * renderer applies the saved theme would drift) and the boot script
 * `public/theme-boot.js` (applies the cached palette before the first paint
 * and must ignore anything that is not a theme variable/color). Lives under
 * main only because these tests read files (node types).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { themeCssVariables } from '../../shared/theme/appearance'
import { getBuiltInTheme, getThemeColorsForMode } from '../../shared/theme/themes'

const RENDERER = join(process.cwd(), 'src/renderer')
const css = readFileSync(join(RENDERER, 'src/styles.css'), 'utf-8')
const bootScript = readFileSync(join(RENDERER, 'public/theme-boot.js'), 'utf-8')

function declarations(block: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const match of block.matchAll(/(--theme-[a-z-]+):\s*([^;]+);/g))
    out[match[1]] = match[2].trim()
  return out
}

describe('styles.css defaults', () => {
  const minerva = getBuiltInTheme('minerva')!
  const darkBlock = css.slice(
    css.indexOf(':root {'),
    css.indexOf('@media (prefers-color-scheme: light)'),
  )
  const lightBlock = css.slice(
    css.indexOf(':root:not([data-appearance])'),
    css.indexOf(":root[data-appearance='light']"),
  )

  it.each([
    ['dark', darkBlock],
    ['light', lightBlock],
  ] as const)('%s defaults equal the Minerva theme', (mode, block) => {
    const expected = themeCssVariables(getThemeColorsForMode(minerva, mode)!, mode, 100)
    const declared = declarations(block)
    expect(Object.keys(declared).length).toBeGreaterThan(10)
    for (const [name, value] of Object.entries(declared)) expect(value).toBe(expected[name])
  })
})

interface BootResult {
  props: Record<string, string>
  appearance: string | null
}

function runBoot(stored: string | null, throws = false): BootResult {
  const props: Record<string, string> = {}
  let appearance: string | null = null
  const documentElement = {
    style: { setProperty: (name: string, value: string) => void (props[name] = value) },
    setAttribute: (name: string, value: string) => {
      if (name === 'data-appearance') appearance = value
    },
  }
  runInNewContext(bootScript, {
    window: {
      localStorage: {
        getItem: () => {
          if (throws) throw new Error('blocked')
          return stored
        },
      },
    },
    document: { documentElement },
  })
  return { props, appearance }
}

describe('theme-boot.js', () => {
  it('applies a cached palette', () => {
    const colors = getThemeColorsForMode(getBuiltInTheme('grove')!, 'light')!
    const vars = themeCssVariables(colors, 'light', 120)
    const result = runBoot(JSON.stringify({ appearance: 'light', vars }))
    expect(result.appearance).toBe('light')
    expect(result.props).toEqual(vars)
  })

  it('ignores names and values that are not theme variables/colors', () => {
    const result = runBoot(
      JSON.stringify({
        appearance: 'dark',
        vars: {
          '--theme-canvas': 'oklch(0.2 0.01 260)',
          '--theme-text': 'red',
          '--theme-accent': 'oklch(0.5 0.1 120); background: url(x)',
          'background-image': 'url(https://evil.example)',
          '--other': 'oklch(0.2 0.01 260)',
          '--appearance-contrast-base': '80%',
          '--appearance-contrast-boost': 'calc(1%)',
        },
      }),
    )
    expect(result.props).toEqual({
      '--theme-canvas': 'oklch(0.2 0.01 260)',
      '--appearance-contrast-base': '80%',
    })
  })

  it.each([
    ['no cache', null],
    ['bad JSON', '{'],
    ['bad appearance', JSON.stringify({ appearance: 'dim', vars: {} })],
    ['oversized', JSON.stringify({ appearance: 'dark', vars: { x: 'y'.repeat(30000) } })],
  ])('does nothing with %s', (_name, stored) => {
    expect(runBoot(stored)).toEqual({ props: {}, appearance: null })
  })

  it('survives blocked storage', () => {
    expect(runBoot(null, true)).toEqual({ props: {}, appearance: null })
  })
})
