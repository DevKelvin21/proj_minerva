import { describe, expect, it } from 'vitest'
import { shouldRestoreFocus, topmostLayer, trapStep, TABBABLE_SELECTOR } from './modal-focus'

describe('trapStep', () => {
  it('wraps forward from the last tabbable to the first', () => {
    expect(trapStep(2, 3, false)).toBe(0)
  })

  it('wraps backward from the first tabbable to the last', () => {
    expect(trapStep(0, 3, true)).toBe(2)
  })

  it('lets the browser move between inner tabbables', () => {
    expect(trapStep(0, 3, false)).toBeNull()
    expect(trapStep(1, 3, false)).toBeNull()
    expect(trapStep(2, 3, true)).toBeNull()
  })

  it('enters at the matching end when focus is on the layer itself', () => {
    expect(trapStep(-1, 3, false)).toBe(0)
    expect(trapStep(-1, 3, true)).toBe(2)
  })

  it('keeps focus on the layer when nothing inside is tabbable', () => {
    expect(trapStep(-1, 0, false)).toBe('container')
    expect(trapStep(-1, 0, true)).toBe('container')
  })

  it('wraps a single tabbable onto itself both ways', () => {
    expect(trapStep(0, 1, false)).toBe(0)
    expect(trapStep(0, 1, true)).toBe(0)
  })
})

describe('topmostLayer', () => {
  it('is the last opened visible layer', () => {
    expect(topmostLayer(['settings', 'import'], () => true)).toBe('import')
  })

  it('skips layers hidden with the review', () => {
    const hidden = new Set(['files-drawer'])
    expect(topmostLayer(['sidebar', 'files-drawer'], (layer) => !hidden.has(layer))).toBe('sidebar')
  })

  it('is null when nothing is on screen', () => {
    expect(topmostLayer([], () => true)).toBeNull()
    expect(topmostLayer(['a'], () => false)).toBeNull()
  })
})

describe('shouldRestoreFocus', () => {
  const closed = { layerRemoved: true, focusLost: true, openerConnected: true }

  it('restores when the layer closed and took focus with it', () => {
    expect(shouldRestoreFocus(closed)).toBe(true)
  })

  it('leaves focus that something else claimed (a command, another dialog)', () => {
    expect(shouldRestoreFocus({ ...closed, focusLost: false })).toBe(false)
  })

  it('leaves focus where it is when the layer docks instead of closing', () => {
    expect(shouldRestoreFocus({ ...closed, layerRemoved: false })).toBe(false)
  })

  it('does nothing when the opener is gone', () => {
    expect(shouldRestoreFocus({ ...closed, openerConnected: false })).toBe(false)
  })
})

describe('TABBABLE_SELECTOR', () => {
  it('excludes negative tabindex from every part', () => {
    for (const part of TABBABLE_SELECTOR.split(',')) {
      expect(part.endsWith(':not([tabindex="-1"])')).toBe(true)
    }
  })
})
