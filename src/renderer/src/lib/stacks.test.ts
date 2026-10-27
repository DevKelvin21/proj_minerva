import { describe, expect, it } from 'vitest'
import { prKey, type AzureRepoRef, type PrStack, type StackNode } from '../../../shared/scm'
import {
  countOrphans,
  descendantsOf,
  filterStacks,
  flattenStackNodes,
  groupLabel,
  groupStacks,
  locatePrInStacks,
  orphanExplanation,
  stacksContaining,
} from './stacks'

const repo = (name: string): AzureRepoRef => ({
  provider: 'azure',
  organization: 'contoso',
  project: 'Platform',
  name,
  repositoryId: name + '-id',
  fullName: 'contoso/Platform/' + name,
})

const API = repo('orders-api')
const WEB = repo('storefront-web')

function node(
  r: AzureRepoRef,
  number: number,
  title: string,
  headRef: string,
  baseRef: string,
  children: StackNode[] = [],
  extra: Partial<StackNode> = {},
): StackNode {
  return {
    prKey: prKey(r, number),
    repo: r,
    number,
    title,
    headRef,
    baseRef,
    state: 'open',
    isDraft: false,
    children,
    ...extra,
  }
}

const n103 = node(API, 103, 'Checkout v2: submit endpoint', 'feature/endpoints', 'feature/service')
const n102 = node(API, 102, 'Checkout v2: submit validation', 'feature/service', 'feature/models', [
  n103,
])
const n101 = node(API, 101, 'Checkout v2: order status and currency', 'feature/models', 'main', [
  n102,
])
const n104 = node(WEB, 104, 'Checkout v2: submit button', 'feature/ui', 'feature/models')
const n110 = node(WEB, 110, 'Checkout v2: client models', 'feature/models', 'main', [n104])
const n105 = node(API, 105, 'Refund ledger', 'feature/refund-ledger', 'feature/refund-schema', [], {
  orphan: {
    parent: { number: 100, title: 'Add refunds table', mergedInto: 'main' },
    targetBranchExists: true,
    suggestedBase: 'main',
  },
})

const GROUP = 'azure:contoso:feature/models'
const STACKS: PrStack[] = [
  { repo: API, root: n101, size: 3, groupKey: GROUP },
  { repo: API, root: n105, size: 1 },
  { repo: WEB, root: n110, size: 2, groupKey: GROUP },
]

describe('flattenStackNodes / descendantsOf', () => {
  it('walks depth-first, root first', () => {
    expect(flattenStackNodes(n101).map((n) => n.number)).toEqual([101, 102, 103])
    expect(descendantsOf(n101).map((n) => n.number)).toEqual([102, 103])
    expect(descendantsOf(n103)).toEqual([])
  })
})

describe('locatePrInStacks', () => {
  it('returns the stack and the path from the root to the PR', () => {
    const found = locatePrInStacks(STACKS, prKey(API, 103))
    expect(found?.stack.root.number).toBe(101)
    expect(found?.path.map((n) => n.number)).toEqual([101, 102, 103])
    expect(found?.node.number).toBe(103)
  })

  it('finds a root and a PR in another repo', () => {
    expect(locatePrInStacks(STACKS, prKey(API, 101))?.path.map((n) => n.number)).toEqual([101])
    expect(locatePrInStacks(STACKS, prKey(WEB, 104))?.path.map((n) => n.number)).toEqual([110, 104])
  })

  it('is null for a PR in no stack (same number, other repo included)', () => {
    expect(locatePrInStacks(STACKS, prKey(API, 999))).toBeNull()
    expect(locatePrInStacks(STACKS, prKey(WEB, 101))).toBeNull()
  })
})

describe('groupLabel', () => {
  it('uses the common word prefix of the root titles, without trailing separators', () => {
    expect(groupLabel(['Checkout v2: order status', 'Checkout v2: client models'])).toBe(
      'Checkout v2',
    )
    expect(groupLabel(['Task 23590 - api', 'task 23590 - ui'])).toBe('Task 23590')
  })

  it('falls back to the first title when nothing useful is shared', () => {
    expect(groupLabel(['Add login', 'Fix cart'])).toBe('Add login')
    expect(groupLabel(['A b', 'A c'])).toBe('A b')
    expect(groupLabel(['Only one title'])).toBe('Only one title')
    expect(groupLabel([])).toBe('')
  })
})

describe('groupStacks', () => {
  it('puts same-group stacks together in first-appearance order; others stay alone', () => {
    const groups = groupStacks(STACKS)
    expect(groups.map((g) => [g.label, g.stacks.map((s) => s.root.number)])).toEqual([
      ['Checkout v2', [101, 110]],
      [null, [105]],
    ])
    expect(new Set(groups.map((g) => g.key)).size).toBe(groups.length)
  })
})

describe('filters', () => {
  it('stacksContaining keeps stacks with any PR in the set', () => {
    const mine = new Set([prKey(WEB, 104)])
    expect(stacksContaining(STACKS, mine).map((s) => s.root.number)).toEqual([110])
    expect(stacksContaining(STACKS, new Set())).toEqual([])
  })

  it('filterStacks matches every word against title, number, branches and repo', () => {
    expect(filterStacks(STACKS, '').length).toBe(3)
    expect(filterStacks(STACKS, 'refund').map((s) => s.root.number)).toEqual([105])
    expect(filterStacks(STACKS, '#103').map((s) => s.root.number)).toEqual([101])
    expect(filterStacks(STACKS, 'storefront button').map((s) => s.root.number)).toEqual([110])
    expect(filterStacks(STACKS, 'storefront refund')).toEqual([])
  })
})

describe('orphans', () => {
  it('counts orphaned roots', () => {
    expect(countOrphans(STACKS)).toBe(1)
  })

  it('explains what happened, and says when the stale branch is gone', () => {
    expect(orphanExplanation(n105)).toBe(
      'Parent #100 was completed into main, but this PR still targets feature/refund-schema.',
    )
    const gone = { ...n105, orphan: { ...n105.orphan!, targetBranchExists: false } }
    expect(orphanExplanation(gone)).toMatch(/That branch no longer exists\.$/)
    expect(orphanExplanation(n101)).toBeNull()
  })
})
