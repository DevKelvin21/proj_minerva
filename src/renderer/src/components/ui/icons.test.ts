import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Icon } from './Icon'
import { ICON_PX, ICON_STROKE, icons } from './icons'

const html = (el: Parameters<typeof renderToStaticMarkup>[0]): string => renderToStaticMarkup(el)

describe('icon registry', () => {
  it('maps every meaning to a renderable glyph', () => {
    for (const [name, glyph] of Object.entries(icons)) {
      expect(glyph, name).toBeTruthy()
      expect(html(createElement(Icon, { icon: glyph })), name).toContain('<svg')
    }
  })

  it('has exactly four sizes on the 12/14/16/20 grid', () => {
    expect(ICON_PX).toEqual({ xs: 12, sm: 14, md: 16, lg: 20 })
  })
})

describe('Icon', () => {
  it('defaults to sm, decorative, currentColor, no fill', () => {
    const out = html(createElement(Icon, { icon: icons.retry }))
    expect(out).toContain('width="14"')
    expect(out).toContain('aria-hidden="true"')
    expect(out).toContain('stroke="currentColor"')
    expect(out).toContain('fill="none"')
    expect(out).not.toContain('role=')
  })

  it('keeps the same absolute line weight at every size', () => {
    for (const size of ['xs', 'sm', 'md', 'lg'] as const) {
      const out = html(createElement(Icon, { icon: icons.close, size }))
      const px = ICON_PX[size]
      const expected = (ICON_STROKE * 24) / px
      const match = out.match(/stroke-width="([\d.]+)"/)
      expect(Number(match?.[1]), size).toBeCloseTo(expected, 5)
      expect(out).toContain(`width="${px}"`)
    }
  })

  it('becomes a labelled image when given an aria-label', () => {
    const out = html(createElement(Icon, { icon: icons.success, 'aria-label': 'Passed' }))
    expect(out).toContain('role="img"')
    expect(out).toContain('aria-label="Passed"')
    expect(out).not.toContain('aria-hidden="true"')
  })

  it('fills with currentColor when asked', () => {
    expect(html(createElement(Icon, { icon: icons.stop, filled: true }))).toContain(
      'fill="currentColor"',
    )
  })
})
