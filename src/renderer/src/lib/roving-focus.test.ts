import { describe, expect, it } from 'vitest'
import { placeMenu, rovingTarget } from './roving-focus'

describe('rovingTarget', () => {
  it('moves to the neighbour with wrap-around along the orientation', () => {
    expect(rovingTarget('ArrowRight', 0, 3, 'horizontal')).toBe(1)
    expect(rovingTarget('ArrowRight', 2, 3, 'horizontal')).toBe(0)
    expect(rovingTarget('ArrowLeft', 0, 3, 'horizontal')).toBe(2)
    expect(rovingTarget('ArrowDown', 1, 3, 'vertical')).toBe(2)
    expect(rovingTarget('ArrowUp', 0, 3, 'vertical')).toBe(2)
  })

  it('ignores the cross-axis arrows', () => {
    expect(rovingTarget('ArrowDown', 0, 3, 'horizontal')).toBeNull()
    expect(rovingTarget('ArrowRight', 0, 3, 'vertical')).toBeNull()
  })

  it('jumps to the ends with Home and End', () => {
    expect(rovingTarget('Home', 2, 3, 'vertical')).toBe(0)
    expect(rovingTarget('End', 0, 3, 'horizontal')).toBe(2)
  })

  it('is not a move for other keys or an empty list', () => {
    expect(rovingTarget('Enter', 0, 3, 'horizontal')).toBeNull()
    expect(rovingTarget('ArrowRight', 0, 0, 'horizontal')).toBeNull()
  })
})

describe('placeMenu', () => {
  const viewport = { width: 1000, height: 800 }

  it('opens below a trigger on the left, sized to the room left', () => {
    expect(placeMenu({ top: 100, bottom: 124, left: 40, right: 140 }, viewport)).toEqual({
      top: 128,
      left: 40,
      maxHeight: 800 - 124 - 4 - 8,
      maxWidth: 1000 - 40 - 8,
    })
  })

  it('opens upward near the bottom edge when there is more room above', () => {
    const placement = placeMenu({ top: 700, bottom: 724, left: 40, right: 140 }, viewport)
    expect(placement.bottom).toBe(800 - 700 + 4)
    expect(placement.top).toBeUndefined()
    expect(placement.maxHeight).toBe(700 - 4 - 8)
  })

  it('aligns to the right edge of a trigger in the right half', () => {
    const placement = placeMenu({ top: 100, bottom: 124, left: 800, right: 900 }, viewport)
    expect(placement.right).toBe(100)
    expect(placement.left).toBeUndefined()
    expect(placement.maxWidth).toBe(900 - 8)
  })

  it('never returns a negative size', () => {
    const placement = placeMenu({ top: 2, bottom: 798, left: 0, right: 10 }, { width: 10, height: 800 })
    expect(placement.maxHeight).toBeGreaterThanOrEqual(0)
    expect(placement.maxWidth).toBeGreaterThanOrEqual(0)
  })
})
