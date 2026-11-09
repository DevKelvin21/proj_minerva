import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { APP_ICON_INSET, appIconStroke, appIconSvg, BRAND_MARK_SHAPES } from '../shared/brand-mark'

describe('brand mark', () => {
  it('build/icon.svg matches the mark (rerun scripts/build-app-icons.mjs after changing it)', () => {
    const committed = readFileSync(join(import.meta.dirname, '../../build/icon.svg'), 'utf8')
    expect(committed).toBe(
      appIconSvg({ inset: APP_ICON_INSET.mac, stroke: appIconStroke(1024) }) + '\n',
    )
  })

  it('stays on the 24-unit grid', () => {
    for (const shape of BRAND_MARK_SHAPES) {
      if (shape.kind === 'circle') {
        expect(shape.cx - shape.r).toBeGreaterThanOrEqual(0)
        expect(shape.cx + shape.r).toBeLessThanOrEqual(24)
        expect(shape.cy - shape.r).toBeGreaterThanOrEqual(0)
        expect(shape.cy + shape.r).toBeLessThanOrEqual(24)
      } else {
        for (const n of shape.d.match(/-?\d*\.?\d+/g) ?? []) {
          expect(Math.abs(Number(n))).toBeLessThanOrEqual(24)
        }
      }
    }
  })

  it('draws a heavier line as the icon shrinks', () => {
    const sizes = [16, 32, 64, 128, 1024]
    const strokes = sizes.map(appIconStroke)
    for (let i = 1; i < strokes.length; i++) expect(strokes[i]).toBeLessThanOrEqual(strokes[i - 1])
  })
})
