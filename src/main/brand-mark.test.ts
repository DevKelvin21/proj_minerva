import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  APP_ICON_INSET,
  appIconStroke,
  appIconSvg,
  BRAND_MARK_SHAPES,
  TRAY_ICON_STROKE,
  trayIconSvg,
} from '../shared/brand-mark'

describe('brand mark', () => {
  it('build/icon.svg matches the mark (rerun scripts/build-app-icons.mjs after changing it)', () => {
    const committed = readFileSync(join(import.meta.dirname, '../../build/icon.svg'), 'utf8')
    expect(committed).toBe(
      appIconSvg({ inset: APP_ICON_INSET.mac, stroke: appIconStroke(1024) }) + '\n',
    )
  })

  it('build/tray.svg matches the menu bar icon (rerun scripts/build-app-icons.mjs --tray)', () => {
    const committed = readFileSync(join(import.meta.dirname, '../../build/tray.svg'), 'utf8')
    expect(committed).toBe(trayIconSvg({ stroke: TRAY_ICON_STROKE }) + '\n')
  })

  it('ships the menu bar template images where the tray loads them', () => {
    for (const name of ['minervaTemplate.png', 'minervaTemplate@2x.png']) {
      const png = readFileSync(join(import.meta.dirname, '../../resources/tray', name))
      // PNG signature, then the IHDR width: 16 px and 32 px (@2x).
      expect(png.subarray(1, 4).toString('latin1')).toBe('PNG')
      expect(png.readUInt32BE(16)).toBe(name.includes('@2x') ? 32 : 16)
    }
  })

  it('draws the menu bar icon in black only (a template image keeps just the alpha)', () => {
    const svg = trayIconSvg({ stroke: TRAY_ICON_STROKE })
    expect(svg).toContain('viewBox="0 0 24 24"')
    const colors = svg.match(/#[0-9a-f]{6}/gi) ?? []
    expect(new Set(colors)).toEqual(new Set(['#000000']))
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
