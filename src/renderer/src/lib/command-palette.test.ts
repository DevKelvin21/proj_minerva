import { describe, expect, it } from 'vitest'
import { filterPaletteItems, stepIndex, type PaletteItem } from './command-palette'

const noop = (): void => {}

function item(id: string, group: PaletteItem['group'], label: string, extra: Partial<PaletteItem> = {}): PaletteItem {
  return { id, group, label, run: noop, ...extra }
}

const ITEMS: PaletteItem[] = [
  item('pr-1', 'pullRequests', 'Fix cart rounding', { detail: 'storefront-web · fix/cart', keywords: '#108 108' }),
  item('cmd-home', 'commands', 'Go to Home'),
  item('pr-2', 'pullRequests', 'Checkout v2: submit endpoint', { detail: 'orders-api · feat/submit', keywords: '#103 103' }),
  item('file-1', 'files', 'total.ts', { detail: 'src/cart/total.ts' }),
  item('pr-3', 'pullRequests', 'Refund ledger', { detail: 'orders-api · cart-refunds', keywords: '#105 105' }),
]

describe('filterPaletteItems', () => {
  it('lists every group in a fixed order when the query is empty', () => {
    expect(filterPaletteItems(ITEMS, '').map((i) => i.id)).toEqual([
      'pr-1',
      'pr-2',
      'pr-3',
      'file-1',
      'cmd-home',
    ])
  })

  it('needs every word, in any field, ignoring case', () => {
    expect(filterPaletteItems(ITEMS, 'ORDERS submit').map((i) => i.id)).toEqual(['pr-2'])
  })

  it('finds a PR by #number', () => {
    expect(filterPaletteItems(ITEMS, '#105').map((i) => i.id)).toEqual(['pr-3'])
  })

  it('puts label matches before detail-only matches, keeping input order otherwise', () => {
    // "cart" is in pr-1's label, but only in pr-3's branch and file-1's path.
    expect(filterPaletteItems(ITEMS, 'cart').map((i) => i.id)).toEqual(['pr-1', 'pr-3', 'file-1'])
  })

  it('caps each group', () => {
    const limits = { commands: 8, pullRequests: 2, files: 8 }
    expect(filterPaletteItems(ITEMS, '', limits).filter((i) => i.group === 'pullRequests')).toHaveLength(2)
  })

  it('a lone "#" narrows the list to pull requests', () => {
    expect(filterPaletteItems(ITEMS, '#').map((i) => i.group)).toEqual([
      'pullRequests',
      'pullRequests',
      'pullRequests',
    ])
  })
})

describe('stepIndex', () => {
  it('wraps at both ends', () => {
    expect(stepIndex(2, 1, 3)).toBe(0)
    expect(stepIndex(0, -1, 3)).toBe(2)
    expect(stepIndex(0, 1, 0)).toBe(0)
  })
})
