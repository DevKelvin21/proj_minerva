import { describe, expect, it } from 'vitest'
import { BLOCKED_ELEMENTS, DIAGRAM_CSP, buildDiagramDocument, isAllowedAttribute } from './diagram-document'
import { themeCssVariables } from '../../../shared/theme/appearance'
import { getBuiltInThemes, getThemeColorsForMode } from '../../../shared/theme/themes'

describe('isAllowedAttribute', () => {
  it('drops every event handler', () => {
    expect(isAllowedAttribute('onclick', 'x()')).toBe(false)
    expect(isAllowedAttribute('ONLOAD', 'x()')).toBe(false)
    expect(isAllowedAttribute('onmouseover', '')).toBe(false)
  })

  it('keeps only in-document fragment links', () => {
    expect(isAllowedAttribute('href', '#arrow')).toBe(true)
    expect(isAllowedAttribute('xlink:href', '#node-1')).toBe(true)
    expect(isAllowedAttribute('href', 'https://evil.example/?leak=1')).toBe(false)
    expect(isAllowedAttribute('href', 'javascript:alert(1)')).toBe(false)
    expect(isAllowedAttribute('href', '#x" onclick="y')).toBe(false)
  })

  it('keeps src only for inline raster images', () => {
    expect(isAllowedAttribute('src', 'data:image/png;base64,iVBORw0KGgo=')).toBe(true)
    expect(isAllowedAttribute('src', 'data:image/svg+xml;base64,PHN2Zz4=')).toBe(false)
    expect(isAllowedAttribute('src', 'https://tracker.example/p.png')).toBe(false)
    expect(isAllowedAttribute('srcset', 'a.png 1x')).toBe(false)
    expect(isAllowedAttribute('action', '/x')).toBe(false)
    expect(isAllowedAttribute('http-equiv', 'refresh')).toBe(false)
  })

  it('keeps presentation attributes', () => {
    expect(isAllowedAttribute('class', 'node new')).toBe(true)
    expect(isAllowedAttribute('style', 'gap: 4px')).toBe(true)
    expect(isAllowedAttribute('viewBox', '0 0 10 10')).toBe(true)
    expect(isAllowedAttribute('marker-end', 'url(#arrow)')).toBe(true)
  })
})

describe('BLOCKED_ELEMENTS', () => {
  it('covers scripts, frames, document-level tags and SVG animation', () => {
    for (const name of ['script', 'iframe', 'object', 'embed', 'meta', 'base', 'link', 'form', 'set', 'animate']) {
      expect(BLOCKED_ELEMENTS.has(name), name).toBe(true)
    }
    expect(BLOCKED_ELEMENTS.has('use')).toBe(true)
    expect(BLOCKED_ELEMENTS.has('filter')).toBe(true)
    expect(BLOCKED_ELEMENTS.has('svg')).toBe(false)
    expect(BLOCKED_ELEMENTS.has('style')).toBe(false)
  })
})

describe('buildDiagramDocument', () => {
  it('puts the CSP, theme properties and kit before the body', () => {
    const doc = buildDiagramDocument('<div class="node">x</div>', { '--theme-canvas': 'oklch(0.2 0 0)' }, 'dark')
    expect(doc).toContain('<meta http-equiv="Content-Security-Policy" content="' + DIAGRAM_CSP + '">')
    expect(doc).toContain('data-appearance="dark"')
    expect(doc).toContain('--theme-canvas: oklch(0.2 0 0);')
    expect(doc).toContain('.node {')
    expect(doc.indexOf('<body>')).toBeGreaterThan(doc.indexOf('</style>'))
    expect(doc.endsWith('<div class="node">x</div></body></html>')).toBe(true)
  })

  it('never lets a theme value break out of the style rule', () => {
    const doc = buildDiagramDocument('', { '--theme-canvas': 'red;}</style><script>x</script>', 'bad name': 'red' }, 'light')
    expect(doc).not.toContain('<script>')
    expect(doc).not.toContain('bad name')
    expect(doc).toContain('data-appearance="light"')
  })

  it('keeps every real theme value (no color is dropped by the strict value check)', () => {
    for (const theme of getBuiltInThemes()) {
      for (const mode of ['light', 'dark'] as const) {
        const colors = getThemeColorsForMode(theme, mode)
        if (!colors) continue
        const vars = themeCssVariables(colors, mode, 150)
        const doc = buildDiagramDocument('', vars, mode)
        for (const [name, value] of Object.entries(vars)) expect(doc, name).toContain(name + ': ' + value + ';')
      }
    }
  })

  it('has a CSP without any network source', () => {
    expect(DIAGRAM_CSP).toContain("default-src 'none'")
    expect(DIAGRAM_CSP).not.toMatch(/https?:|'self'|\*/)
  })
})
