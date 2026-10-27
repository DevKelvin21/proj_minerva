import { describe, expect, it } from 'vitest'
import {
  prKey,
  type AzureRepoRef,
  type GithubRepoRef,
  type PrStack,
  type RepoRef,
  type StackNode,
} from '../../../shared/scm'
import type { PullRequestSummary } from '../../../shared/types'
import {
  boardStacks,
  buildFeatureGroups,
  cloneFeatureNames,
  countPullRequests,
  featureKey,
  featureScope,
  filterByViewer,
  filterPullRequestsByText,
  isFeatureKey,
  isViewerFilter,
  matchesViewerFilter,
  myVote,
  needsMyReview,
  normalizeFeatureName,
  parseFeatureNames,
  parseHiddenFeatures,
  stackOrder,
  tagKey,
  stackPosition,
  summarizeRepos,
  type ViewerIdentity,
} from './dashboard'

const azure = (name: string): AzureRepoRef => ({
  provider: 'azure',
  organization: 'contoso',
  project: 'Platform',
  name,
  repositoryId: name + '-id',
  fullName: 'contoso/Platform/' + name,
})
const github = (name: string): GithubRepoRef => ({
  provider: 'github',
  owner: 'shopwave',
  name,
  fullName: 'shopwave/' + name,
})

const API = azure('orders-api')
const WEB = azure('storefront-web')
const GH = github('checkout')

const ME: ViewerIdentity = { azure: 'kelvin@contoso.com', github: 'kelvin' }

let nextId = 1
function pr(repo: RepoRef, number: number, extra: Partial<PullRequestSummary> = {}): PullRequestSummary {
  return {
    id: String(nextId++),
    number,
    title: 'PR ' + number,
    author: { login: 'someone' },
    repo,
    state: 'open',
    isDraft: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
    headRef: 'feature/' + number,
    baseRef: 'main',
    headSha: 'abc',
    webUrl: 'https://example.test/' + number,
    commentCount: 0,
    reviewDecision: null,
    ciStatus: null,
    additions: null,
    deletions: null,
    changedFiles: null,
    ...extra,
  }
}

function node(repo: RepoRef, number: number, children: StackNode[] = [], extra: Partial<StackNode> = {}): StackNode {
  return {
    prKey: prKey(repo, number),
    repo,
    number,
    title: 'PR ' + number,
    headRef: 'feature/' + number,
    baseRef: 'main',
    state: 'open',
    isDraft: false,
    children,
    ...extra,
  }
}

function stack(repo: RepoRef, root: StackNode): PrStack {
  const size = (n: StackNode): number => 1 + n.children.reduce((sum, c) => sum + size(c), 0)
  return { repo, root, size: size(root) }
}

describe('viewer filter', () => {
  const required = pr(API, 1, { viewer: { isAuthor: false, reviewer: 'required' } })
  const optional = pr(API, 2, { viewer: { isAuthor: false, reviewer: 'optional' } })
  const mine = pr(API, 3, { viewer: { isAuthor: true, reviewer: null } })
  const mineAndRequired = pr(API, 4, { viewer: { isAuthor: true, reviewer: 'required' } })
  const unassigned = pr(API, 5, { viewer: { isAuthor: false, reviewer: null } })
  const unknown = pr(API, 6)
  const all = [required, optional, mine, mineAndRequired, unassigned, unknown]

  it('every PR matches "all", including ones with an unknown relation', () => {
    expect(filterByViewer(all, 'all')).toEqual(all)
  })

  it('required / optional follow the reviewer role', () => {
    expect(filterByViewer(all, 'required')).toEqual([required, mineAndRequired])
    expect(filterByViewer(all, 'optional')).toEqual([optional])
  })

  it('"mine" is the author flag, whatever the reviewer role', () => {
    expect(filterByViewer(all, 'mine')).toEqual([mine, mineAndRequired])
  })

  it('"unassigned" = not the author AND not a reviewer', () => {
    expect(filterByViewer(all, 'unassigned')).toEqual([unassigned])
  })

  it('an unknown relation matches nothing but "all"', () => {
    for (const filter of ['required', 'optional', 'mine', 'unassigned'] as const) {
      expect(matchesViewerFilter(unknown, filter)).toBe(false)
    }
  })

  it('isViewerFilter accepts only the known ids', () => {
    expect(isViewerFilter('mine')).toBe(true)
    expect(isViewerFilter('MINE')).toBe(false)
    expect(isViewerFilter(null)).toBe(false)
  })
})

describe('needsMyReview / myVote', () => {
  it('finds the user vote by login, case-insensitively, per provider', () => {
    const item = pr(API, 1, {
      viewer: { isAuthor: false, reviewer: 'required' },
      reviewers: [
        { user: { login: 'Kelvin@contoso.com' }, vote: 'approved', isRequired: true },
        { user: { login: 'other' }, vote: 'none', isRequired: true },
      ],
    })
    expect(myVote(item, ME)).toBe('approved')
    expect(needsMyReview(item, ME)).toBe(false)
  })

  it('a required reviewer without a vote needs to review', () => {
    const item = pr(API, 1, {
      viewer: { isAuthor: false, reviewer: 'required' },
      reviewers: [{ user: { login: 'kelvin@contoso.com' }, vote: 'none', isRequired: true }],
    })
    expect(needsMyReview(item, ME)).toBe(true)
  })

  it('an optional reviewer or a non-reviewer never "needs" to review', () => {
    expect(
      needsMyReview(pr(API, 1, { viewer: { isAuthor: false, reviewer: 'optional' } }), ME),
    ).toBe(false)
    expect(needsMyReview(pr(API, 2, { viewer: { isAuthor: true, reviewer: null } }), ME)).toBe(false)
    expect(needsMyReview(pr(API, 3), ME)).toBe(false)
  })

  it("main's identity-matched `viewer.vote` wins over the login match", () => {
    const voted = pr(API, 1, {
      viewer: { isAuthor: false, reviewer: 'required', vote: 'approved' },
      reviewers: [{ user: { login: 'kelvin@contoso.com' }, vote: 'none', isRequired: true }],
    })
    expect(needsMyReview(voted, ME)).toBe(false)
    const pending = pr(API, 2, { viewer: { isAuthor: false, reviewer: 'required', vote: 'none' } })
    expect(needsMyReview(pending, {})).toBe(true)
  })

  it('without a known identity or reviewer list, being required is enough', () => {
    const item = pr(API, 1, { viewer: { isAuthor: false, reviewer: 'required' } })
    expect(myVote(item, {})).toBeNull()
    expect(needsMyReview(item, {})).toBe(true)
    expect(needsMyReview(item, ME)).toBe(true)
  })
})

describe('summarizeRepos', () => {
  it('counts per repo and orders by what needs the user first', () => {
    const items = [
      pr(WEB, 10, { viewer: { isAuthor: true, reviewer: null }, unread: { isNew: true, hasUpdates: false, hasNewComments: false } }),
      pr(WEB, 11, { viewer: { isAuthor: false, reviewer: 'optional' } }),
      pr(WEB, 12, { viewer: { isAuthor: false, reviewer: null } }),
      pr(API, 1, { viewer: { isAuthor: false, reviewer: 'required' }, reviewers: [] }),
      pr(API, 2, { viewer: { isAuthor: false, reviewer: 'required' }, reviewers: [
        { user: { login: 'kelvin@contoso.com' }, vote: 'approved', isRequired: true },
      ] }),
    ]
    const stacks = [
      stack(API, node(API, 1, [node(API, 2)])),
      stack(API, node(API, 3, [], { orphan: { parent: { number: 0, title: 'p', mergedInto: 'main' }, targetBranchExists: true, suggestedBase: 'main' } })),
      stack(WEB, node(WEB, 10)),
    ]
    const summaries = summarizeRepos(items, stacks, ME)
    expect(summaries.map((s) => s.repo.name)).toEqual(['orders-api', 'storefront-web'])
    const [api, web] = summaries
    expect(api).toMatchObject({ open: 2, needsMyReview: 1, optional: 0, mine: 0, unread: 0, stacks: 1, orphans: 1 })
    expect(web).toMatchObject({ open: 3, needsMyReview: 0, optional: 1, mine: 1, unread: 1, stacks: 0, orphans: 0 })
    expect(web.pullRequests.map((p) => p.number)).toEqual([10, 11, 12])
  })

  it('a repo only known through a stack still gets a summary', () => {
    const summaries = summarizeRepos([], [stack(GH, node(GH, 7, [node(GH, 8)]))], ME)
    expect(summaries).toHaveLength(1)
    expect(summaries[0]).toMatchObject({ open: 0, stacks: 1, key: 'github:shopwave/checkout' })
  })

  it('ties break by open count, then by full name', () => {
    const summaries = summarizeRepos([pr(WEB, 1), pr(API, 1), pr(API, 2), pr(GH, 1)], null, ME)
    expect(summaries.map((s) => s.repo.name)).toEqual(['orders-api', 'storefront-web', 'checkout'])
  })

  it('countPullRequests counts unread by any unread flag', () => {
    const counts = countPullRequests(
      [
        pr(API, 1, { unread: { isNew: false, hasUpdates: false, hasNewComments: true } }),
        pr(API, 2, { unread: { isNew: false, hasUpdates: false, hasNewComments: false } }),
        pr(API, 3),
      ],
      ME,
    )
    expect(counts.unread).toBe(1)
    expect(counts.open).toBe(3)
  })
})

describe('feature groups', () => {
  const label = (name: string) => ({ name })
  const items = [
    pr(API, 1, { labels: [label('Checkout v2'), label('backend')], reviewDecision: 'approved' }),
    pr(API, 2, { labels: [label('checkout v2')], viewer: { isAuthor: false, reviewer: 'required' } }),
    pr(WEB, 10, { labels: [label(' Checkout V2 ')] }),
    pr(WEB, 11, { labels: [label('backend')] }),
    pr(GH, 20, { labels: [label('Refunds')] }),
    pr(GH, 21, { labels: [label('refunds')] }),
    pr(GH, 22, { labels: [label('Checkout v2')], reviewDecision: 'approved' }),
  ]

  it('groups a tag shared by PRs in 2+ distinct repos of the same org, keyed by scope + lowercased trimmed tag', () => {
    const groups = buildFeatureGroups(items, {}, ME)
    expect(groups.map((g) => g.key)).toEqual(['azure:contoso:checkout v2', 'azure:contoso:backend'])
    const checkout = groups[0]
    expect(checkout.scope).toBe('azure:contoso')
    expect(checkout.tag).toBe('Checkout v2')
    expect(checkout.name).toBe('Checkout v2')
    expect(checkout.renamed).toBe(false)
    expect(checkout.hidden).toBe(false)
    // The GitHub PR with the same tag is another provider: not part of it.
    expect(checkout.repos.map((r) => r.repo.name)).toEqual(['orders-api', 'storefront-web'])
    expect(checkout.prCount).toBe(3)
    expect(checkout.approved).toBe(1)
    expect(checkout.needsMyReview).toBe(1)
  })

  it('never merges across providers or owners/organizations', () => {
    const OTHER_ORG: AzureRepoRef = { ...azure('billing'), organization: 'fabrikam', fullName: 'fabrikam/Platform/billing' }
    const OTHER_OWNER: GithubRepoRef = { ...github('api'), owner: 'acme', fullName: 'acme/api' }
    const groups = buildFeatureGroups(
      [
        pr(API, 1, { labels: [label('bug')] }),
        pr(GH, 2, { labels: [label('bug')] }),
        pr(OTHER_ORG, 3, { labels: [label('bug')] }),
        pr(OTHER_OWNER, 4, { labels: [label('bug')] }),
        pr(github('web'), 5, { labels: [label('bug')] }),
      ],
      {},
      ME,
    )
    // Only shopwave has `bug` in two of ITS repos (checkout + web).
    expect(groups.map((g) => g.key)).toEqual(['github:shopwave:bug'])
    expect(groups[0].repos.map((r) => r.repo.fullName)).toEqual(['shopwave/checkout', 'shopwave/web'])
  })

  it('a tag used in one repo only (even by several PRs) is not a feature', () => {
    const groups = buildFeatureGroups(items, {}, ME)
    expect(groups.find((g) => g.key.endsWith(':refunds'))).toBeUndefined()
  })

  it('a PR carrying the same tag twice counts once', () => {
    const groups = buildFeatureGroups(
      [pr(API, 1, { labels: [label('x'), label('X ')] }), pr(WEB, 2, { labels: [label('x')] })],
      {},
      ME,
    )
    expect(groups[0].prCount).toBe(2)
  })

  it('uses the custom name when set and sorts by repo count, PR count, then name', () => {
    const groups = buildFeatureGroups(items, { 'azure:contoso:backend': 'Platform plumbing' }, ME)
    expect(groups[1]).toMatchObject({ key: 'azure:contoso:backend', name: 'Platform plumbing', renamed: true, tag: 'backend' })
    const tie = buildFeatureGroups(
      [
        pr(API, 1, { labels: [label('b')] }),
        pr(WEB, 2, { labels: [label('b')] }),
        pr(API, 3, { labels: [label('a')] }),
        pr(WEB, 4, { labels: [label('a')] }),
      ],
      {},
      ME,
    )
    expect(tie.map((g) => g.key)).toEqual(['azure:contoso:a', 'azure:contoso:b'])
  })

  it('flags hidden groups without dropping them', () => {
    const groups = buildFeatureGroups(items, {}, ME, new Set(['azure:contoso:backend']))
    expect(groups.map((g) => [g.key, g.hidden])).toEqual([
      ['azure:contoso:checkout v2', false],
      ['azure:contoso:backend', true],
    ])
  })

  it('labels named like Object.prototype members are plain tags (no inherited custom name)', () => {
    for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      const groups = buildFeatureGroups(
        [pr(API, 1, { labels: [label(name)] }), pr(WEB, 2, { labels: [label(name)] })],
        {},
        ME,
      )
      expect(groups).toHaveLength(1)
      expect(groups[0].name).toBe(name)
      expect(groups[0].renamed).toBe(false)
      expect(typeof groups[0].name).toBe('string')
    }
    // Sorting by name must not blow up on such groups either.
    const many = buildFeatureGroups(
      [
        pr(API, 1, { labels: [label('constructor'), label('toString')] }),
        pr(WEB, 2, { labels: [label('constructor'), label('toString')] }),
      ],
      {},
      ME,
    )
    expect(many.map((g) => g.name)).toEqual(['constructor', 'toString'])
  })

  it('ignores blank labels', () => {
    expect(buildFeatureGroups([pr(API, 1, { labels: [label('  ')] }), pr(WEB, 2, { labels: [label('') ] })], {}, ME)).toEqual([])
  })

  it('tagKey / featureKey / featureScope', () => {
    expect(tagKey('  Checkout V2 ')).toBe('checkout v2')
    expect(featureScope(API)).toBe('azure:contoso')
    expect(featureScope(GH)).toBe('github:shopwave')
    expect(featureKey(GH, ' Endpoint ')).toBe('github:shopwave:endpoint')
    expect(featureKey(GH, '   ')).toBe('')
  })
})

describe('custom feature names and hidden groups (localStorage)', () => {
  it('normalizes typed names and drops blank ones', () => {
    expect(normalizeFeatureName('  Checkout   v2 ')).toBe('Checkout v2')
    expect(normalizeFeatureName('   ')).toBeNull()
    expect(normalizeFeatureName('x'.repeat(200))).toHaveLength(80)
  })

  it('parses only valid string -> string entries with canonical feature keys', () => {
    expect(parseFeatureNames(null)).toEqual({})
    expect(parseFeatureNames('not json')).toEqual({})
    expect(parseFeatureNames('[1,2]')).toEqual({})
    expect(parseFeatureNames('"str"')).toEqual({})
    const parsed = parseFeatureNames(
      JSON.stringify({
        'azure:contoso:checkout v2': 'Checkout',
        'Azure:contoso:Bad Case': 'ignored',
        'checkout v2': 'no scope',
        nested: { a: 1 },
        num: 3,
        'azure:contoso:blank': '   ',
        '': 'empty key',
        'github:shopwave:constructor': 'Ctor',
      }),
    )
    expect({ ...parsed }).toEqual({
      'azure:contoso:checkout v2': 'Checkout',
      'github:shopwave:constructor': 'Ctor',
    })
    // Prototype-less: a key like `constructor` cannot be inherited.
    expect(Object.getPrototypeOf(parsed)).toBeNull()
  })

  it('rejects prototype keys and a __proto__ entry never changes the prototype', () => {
    const parsed = parseFeatureNames('{"__proto__":{"polluted":"yes"},"constructor":"x","azure:contoso:a":"A"}')
    expect({ ...parsed }).toEqual({ 'azure:contoso:a': 'A' })
    expect((parsed as Record<string, unknown>).polluted).toBeUndefined()
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(isFeatureKey('__proto__')).toBe(false)
    expect(isFeatureKey('constructor')).toBe(false)
    expect(isFeatureKey('azure:contoso:__proto__')).toBe(true)
    expect(isFeatureKey('x'.repeat(400))).toBe(false)
  })

  it('cloneFeatureNames copies own entries into a prototype-less object', () => {
    const copy = cloneFeatureNames({ 'azure:contoso:a': 'A' })
    expect(Object.getPrototypeOf(copy)).toBeNull()
    copy['azure:contoso:__proto__'] = 'B'
    expect(Object.getPrototypeOf(copy)).toBeNull()
    expect(copy['azure:contoso:__proto__']).toBe('B')
  })

  it('parses hidden feature keys: array of valid keys, deduplicated, junk dropped', () => {
    expect(parseHiddenFeatures(null)).toEqual([])
    expect(parseHiddenFeatures('{}')).toEqual([])
    expect(parseHiddenFeatures('nope')).toEqual([])
    expect(
      parseHiddenFeatures(JSON.stringify(['azure:contoso:bug', 'azure:contoso:bug', 3, '__proto__', 'bad', 'github:shopwave:endpoint'])),
    ).toEqual(['azure:contoso:bug', 'github:shopwave:endpoint'])
  })
})

describe('text filter', () => {
  it('matches every word against title, number, branches, author and labels', () => {
    const items = [
      pr(API, 1, { title: 'Fix cart rounding', author: { login: 'ana' } }),
      pr(API, 2, { title: 'Refund ledger', headRef: 'feature/refund-ledger', labels: [{ name: 'money' }] }),
    ]
    expect(filterPullRequestsByText(items, '')).toHaveLength(2)
    expect(filterPullRequestsByText(items, 'cart ana').map((p) => p.number)).toEqual([1])
    expect(filterPullRequestsByText(items, '#2').map((p) => p.number)).toEqual([2])
    expect(filterPullRequestsByText(items, 'money').map((p) => p.number)).toEqual([2])
    expect(filterPullRequestsByText(items, 'ledger cart')).toEqual([])
  })
})

describe('stacks on the board', () => {
  const chain = stack(API, node(API, 1, [node(API, 2, [node(API, 3)]), node(API, 4)]))
  const lone = stack(API, node(API, 9))
  const orphan = stack(API, node(API, 5, [], { orphan: { parent: { number: 0, title: 'p', mergedInto: 'main' }, targetBranchExists: false, suggestedBase: 'main' } }))

  it('keeps multi-PR stacks and lone orphans, and lists their PR keys', () => {
    const { stacks, stackedKeys } = boardStacks([chain, lone, orphan])
    expect(stacks).toEqual([chain, orphan])
    expect([...stackedKeys]).toEqual([1, 2, 3, 4, 5].map((n) => prKey(API, n)))
  })

  it('stackOrder is root-first depth-first', () => {
    expect(stackOrder(chain)).toEqual([1, 2, 3, 4].map((n) => prKey(API, n)))
  })

  it('stackPosition gives the 1-based index and neighbours', () => {
    expect(stackPosition(chain, prKey(API, 1))).toEqual({ index: 1, total: 4, previous: null, next: prKey(API, 2) })
    expect(stackPosition(chain, prKey(API, 3))).toEqual({ index: 3, total: 4, previous: prKey(API, 2), next: prKey(API, 4) })
    expect(stackPosition(chain, prKey(API, 4))).toEqual({ index: 4, total: 4, previous: prKey(API, 3), next: null })
    expect(stackPosition(chain, prKey(WEB, 1))).toBeNull()
  })
})
