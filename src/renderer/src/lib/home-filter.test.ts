import { describe, expect, it } from 'vitest'
import { repoKey, type AzureRepoRef, type GithubRepoRef, type RepoRef } from '../../../shared/scm'
import type { PullRequestSummary } from '../../../shared/types'
import type { ViewerIdentity } from './dashboard'
import {
  addValue,
  applyHomeFilter,
  bestWithoutHint,
  emptyFilter,
  facetOptions,
  filterChips,
  filterValueCount,
  isFilterActive,
  ME_KEY,
  newViewId,
  parseSavedViews,
  parseTypedTokens,
  personKey,
  removeValue,
  sameFilter,
  searchOptions,
  splitWords,
  suggestViewName,
  toggleValue,
  tokenFacet,
  type FacetId,
  type HomeFilter,
  type OptionLabels,
  type OptionsByFacet,
} from './home-filter'

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
const GH = github('api')

const ME: ViewerIdentity = { azure: 'ada@contoso.example' }
const ada = { login: 'ada@contoso.example', displayName: 'Ada Lovelace' }
const linus = { login: 'linus@contoso.example', displayName: 'Linus Pauling' }
const grace = { login: 'grace@contoso.example', displayName: 'Grace Hopper' }
const dkumar = { login: 'dkumar' }

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

const PRS: PullRequestSummary[] = [
  pr(API, 101, {
    title: 'Checkout v2: order status',
    author: ada,
    viewer: { isAuthor: true, reviewer: null },
    labels: [{ name: 'checkout-v2' }, { name: 'api' }],
    reviewers: [{ user: grace, vote: 'approved', isRequired: true }],
    reviewDecision: 'approved',
  }),
  pr(API, 102, {
    title: 'Checkout v2: submit validation',
    author: ada,
    viewer: { isAuthor: true, reviewer: null },
    reviewDecision: 'changes_requested',
    ciStatus: 'failure',
  }),
  pr(WEB, 104, {
    title: 'Checkout v2: submit button',
    author: linus,
    viewer: { isAuthor: false, reviewer: 'required', vote: 'none' },
    labels: [{ name: 'Checkout-V2' }],
    reviewers: [{ user: ada, vote: 'none', isRequired: true }],
    unread: { isNew: true, hasUpdates: false, hasNewComments: false },
  }),
  pr(WEB, 108, {
    title: 'Fix cart rounding',
    author: grace,
    viewer: { isAuthor: false, reviewer: 'required', vote: 'approved' },
    labels: [{ name: 'bug' }],
    reviewers: [{ user: ada, vote: 'approved', isRequired: true }],
    isDraft: true,
  }),
  pr(GH, 482, {
    title: 'Add coupon endpoint',
    author: dkumar,
    headRef: 'feature/coupon-endpoint',
    labels: [{ name: 'checkout-service' }],
  }),
]

const LABELS: OptionLabels = {
  me: 'You',
  status: {
    waitingOnMe: 'Waiting on me',
    draft: 'Draft',
    changesRequested: 'Changes requested',
    approved: 'Approved',
    ciFailing: 'Checks failing',
    unread: 'Unread',
  },
}

const numbers = (prs: readonly PullRequestSummary[]): number[] => prs.map((item) => item.number)
const filterWith = (patch: Partial<HomeFilter>): HomeFilter => ({ ...emptyFilter(), ...patch })
const allOptions = (): OptionsByFacet => {
  const facets: FacetId[] = ['author', 'tag', 'repo', 'reviewer', 'status']
  return Object.fromEntries(
    facets.map((facet) => [facet, facetOptions(PRS, facet, ME, LABELS)]),
  ) as unknown as OptionsByFacet
}

describe('facetOptions', () => {
  it('lists authors with counts, "You" first, then by count and name', () => {
    const options = facetOptions(PRS, 'author', ME, LABELS)
    expect(options.map((o) => [o.key, o.label, o.count])).toEqual([
      [ME_KEY, 'You', 2],
      ['azure:ada@contoso.example', 'Ada Lovelace', 2],
      ['github:dkumar', 'dkumar', 1],
      ['azure:grace@contoso.example', 'Grace Hopper', 1],
      ['azure:linus@contoso.example', 'Linus Pauling', 1],
    ])
    expect(options[0].section).toBe('me')
  })

  it('merges tags case-insensitively and keeps the first spelling', () => {
    const options = facetOptions(PRS, 'tag', ME, LABELS)
    expect(options.map((o) => [o.key, o.label, o.count])).toEqual([
      ['checkout-v2', 'checkout-v2', 2],
      ['api', 'api', 1],
      ['bug', 'bug', 1],
      ['checkout-service', 'checkout-service', 1],
    ])
  })

  it('lists reviewers, "You" when main says you are one', () => {
    const options = facetOptions(PRS, 'reviewer', ME, LABELS)
    expect(options.map((o) => [o.key, o.count])).toEqual([
      [ME_KEY, 2],
      ['azure:ada@contoso.example', 2],
      ['azure:grace@contoso.example', 1],
    ])
  })

  it('lists repositories and only the statuses somebody has, in their fixed order', () => {
    expect(facetOptions(PRS, 'repo', ME, LABELS).map((o) => [o.label, o.count])).toEqual([
      ['orders-api', 2],
      ['storefront-web', 2],
      ['api', 1],
    ])
    expect(facetOptions(PRS, 'status', ME, LABELS).map((o) => [o.key, o.count])).toEqual([
      ['waitingOnMe', 1],
      ['draft', 1],
      ['changesRequested', 1],
      ['approved', 1],
      ['ciFailing', 1],
      ['unread', 1],
    ])
  })

  it('searches by label prefix, by a word of the label, or by an alias', () => {
    const authors = facetOptions(PRS, 'author', ME, LABELS)
    expect(searchOptions(authors, 'lov').map((o) => o.label)).toEqual(['Ada Lovelace'])
    expect(searchOptions(authors, 'linus@').map((o) => o.label)).toEqual(['Linus Pauling'])
    expect(searchOptions(authors, 'me').map((o) => o.key)).toEqual([ME_KEY])
    expect(searchOptions(authors, '  ')).toHaveLength(authors.length)
  })
})

describe('applyHomeFilter', () => {
  it('ORs values inside a facet and ANDs facets together', () => {
    const adaKey = personKey('azure', ada)
    const linusKey = personKey('azure', linus)
    const twoAuthors = filterWith({
      author: [
        { key: adaKey, label: 'Ada' },
        { key: linusKey, label: 'Linus' },
      ],
    })
    expect(numbers(applyHomeFilter(PRS, twoAuthors, ME))).toEqual([101, 102, 104])
    const andTag = { ...twoAuthors, tag: [{ key: 'checkout-v2', label: 'checkout-v2' }] }
    expect(numbers(applyHomeFilter(PRS, andTag, ME))).toEqual([101, 104])
  })

  it('ANDs the free text (title, #number, branch) and ignores pending tokens', () => {
    expect(numbers(applyHomeFilter(PRS, filterWith({ text: 'checkout submit' }), ME))).toEqual([
      102, 104,
    ])
    expect(numbers(applyHomeFilter(PRS, filterWith({ text: '#482' }), ME))).toEqual([482])
    expect(numbers(applyHomeFilter(PRS, filterWith({ text: 'coupon-endpoint' }), ME))).toEqual([482])
    // `author:` not resolved yet: it does not empty the results while typing.
    expect(numbers(applyHomeFilter(PRS, filterWith({ text: 'submit author:li' }), ME))).toEqual([
      102, 104,
    ])
  })

  it('matches "You" by the identity main resolved, never by a login', () => {
    const mine = filterWith({ author: [{ key: ME_KEY, label: 'You' }] })
    expect(numbers(applyHomeFilter(PRS, mine, ME))).toEqual([101, 102])
    const reviewing = filterWith({ reviewer: [{ key: ME_KEY, label: 'You' }] })
    expect(numbers(applyHomeFilter(PRS, reviewing, ME))).toEqual([104, 108])
  })

  it('matches statuses: waiting on me is a required review with no vote yet', () => {
    const run = (status: HomeFilter['status']): number[] =>
      numbers(applyHomeFilter(PRS, filterWith({ status }), ME))
    expect(run(['waitingOnMe'])).toEqual([104])
    expect(run(['draft'])).toEqual([108])
    expect(run(['changesRequested'])).toEqual([102])
    expect(run(['approved'])).toEqual([101])
    expect(run(['ciFailing'])).toEqual([102])
    expect(run(['unread'])).toEqual([104])
    expect(run(['draft', 'unread'])).toEqual([104, 108])
  })

  it('a stale value (nobody has it any more) matches nothing without throwing', () => {
    const stale = filterWith({ author: [{ key: 'azure:gone@contoso.example', label: 'Gone' }] })
    expect(applyHomeFilter(PRS, stale, ME)).toEqual([])
  })
})

describe('editing', () => {
  it('adds, toggles and removes values; counts chips but not text', () => {
    let filter = addValue(emptyFilter(), 'tag', { key: 'bug', label: 'bug' })
    filter = addValue(filter, 'tag', { key: 'bug', label: 'bug' })
    filter = toggleValue(filter, 'status', { key: 'draft', label: 'draft' })
    expect(filterValueCount(filter)).toBe(2)
    expect(filterChips(filter).map((chip) => chip.facet + ':' + chip.key)).toEqual([
      'tag:bug',
      'status:draft',
    ])
    filter = toggleValue(filter, 'status', { key: 'draft', label: 'draft' })
    filter = removeValue(filter, 'tag', 'bug')
    expect(isFilterActive(filter)).toBe(false)
    expect(isFilterActive({ ...filter, text: 'author:x' })).toBe(false)
    expect(isFilterActive({ ...filter, text: 'cart' })).toBe(true)
    // An unknown status id is never added.
    expect(addValue(emptyFilter(), 'status', { key: 'bogus', label: 'x' }).status).toEqual([])
  })

  it('compares filters regardless of order', () => {
    const a = filterWith({ status: ['draft', 'unread'], text: ' cart  fix ' })
    const b = filterWith({ status: ['unread', 'draft'], text: 'cart fix' })
    expect(sameFilter(a, b)).toBe(true)
    expect(sameFilter(a, { ...b, status: ['draft'] })).toBe(false)
  })
})

describe('bestWithoutHint', () => {
  it('names the one filter whose removal brings back the most PRs', () => {
    const filter = filterWith({
      author: [{ key: personKey('azure', linus), label: 'Linus Pauling' }],
      status: ['draft'],
    })
    expect(applyHomeFilter(PRS, filter, ME)).toEqual([])
    expect(bestWithoutHint(PRS, filter, ME)).toEqual({
      drop: { kind: 'chip', chip: { facet: 'status', key: 'draft', label: 'draft' } },
      count: 1,
    })
  })

  it('can name the text, and is null when no single removal helps', () => {
    const textOnly = filterWith({ tag: [{ key: 'bug', label: 'bug' }], text: 'coupon' })
    const hint = bestWithoutHint(PRS, textOnly, ME)
    expect(hint?.count).toBe(1)
    // A tie (1 either way) goes to the one later in the bar: the text.
    expect(hint?.drop.kind).toBe('text')
    const bothNeeded = filterWith({
      tag: [{ key: 'bug', label: 'bug' }],
      status: ['ciFailing'],
      text: 'zzz',
    })
    expect(bestWithoutHint(PRS, bothNeeded, ME)).toBeNull()
    const onlyText = filterWith({ author: [{ key: personKey('github', dkumar), label: 'dkumar' }], text: 'nothing' })
    expect(bestWithoutHint(PRS, onlyText, ME)).toEqual({
      drop: { kind: 'text', text: 'nothing' },
      count: 1,
    })
  })
})

describe('parseTypedTokens', () => {
  it('turns facet:prefix into the existing value with the most PRs', () => {
    const parsed = parseTypedTokens('author:ada tag:checkout submit', allOptions())
    expect(parsed.added).toEqual([
      { facet: 'author', value: { key: 'azure:ada@contoso.example', label: 'Ada Lovelace' } },
      { facet: 'tag', value: { key: 'checkout-v2', label: 'checkout-v2' } },
    ])
    expect(parsed.rest).toBe('submit')
  })

  it('accepts quoted values, other facet names and Spanish aliases', () => {
    const parsed = parseTypedTokens(
      'autor:"linus pau" repo:storefront status:fail reviewer:me',
      allOptions(),
    )
    expect(parsed.added.map((item) => item.facet + '=' + item.value.key)).toEqual([
      'author=azure:linus@contoso.example',
      'repo=' + repoKey(WEB),
      'status=ciFailing',
      'reviewer=' + ME_KEY,
    ])
    expect(parsed.rest).toBe('')
  })

  it('leaves unknown facets and values that match nothing as text', () => {
    const parsed = parseTypedTokens('foo:bar author:zed tag: cart', allOptions())
    expect(parsed.added).toEqual([])
    expect(parsed.rest).toBe('foo:bar author:zed tag: cart')
  })

  it('splits words keeping quotes together and recognizes facet names', () => {
    expect(splitWords('a  author:"x y" b')).toEqual(['a', 'author:"x y"', 'b'])
    expect(tokenFacet('Author:x')).toBe('author')
    expect(tokenFacet('constructor:x')).toBeNull()
    expect(tokenFacet(':x')).toBeNull()
  })
})

describe('saved views', () => {
  it('parses stored views into a prototype-less map and drops anything odd', () => {
    const raw = JSON.stringify({
      vabc1: {
        name: '  Checkout   v2 · Ada ',
        filter: {
          author: [{ key: 'azure:ada@contoso.example', label: 'Ada Lovelace' }, { key: 5 }],
          tag: [{ key: 'checkout-v2', label: 'checkout-v2' }],
          status: ['draft', 'bogus', 'draft'],
          text: 'submit',
        },
      },
      __proto__: { name: 'x', filter: { text: 'a' } },
      'not an id': { name: 'x', filter: { text: 'a' } },
      vempty: { name: 'Nothing', filter: {} },
      vnoname: { name: '   ', filter: { text: 'a' } },
      varray: [1, 2],
    })
    const views = parseSavedViews(raw)
    expect(Object.getPrototypeOf(views)).toBeNull()
    expect(Object.keys(views)).toEqual(['vabc1'])
    expect(views.vabc1.name).toBe('Checkout v2 · Ada')
    expect(views.vabc1.filter.author).toEqual([{ key: 'azure:ada@contoso.example', label: 'Ada Lovelace' }])
    expect(views.vabc1.filter.status).toEqual(['draft'])
    expect(views.vabc1.filter.text).toBe('submit')
  })

  it('survives bad JSON and non-objects', () => {
    expect(Object.keys(parseSavedViews('{nope'))).toEqual([])
    expect(Object.keys(parseSavedViews('[]'))).toEqual([])
    expect(Object.keys(parseSavedViews(null))).toEqual([])
  })

  it('makes fresh ids and suggests a name from the chips', () => {
    const id = newViewId(Object.create(null), 1000, () => 0)
    expect(id).toMatch(/^v[a-z0-9]+$/)
    const taken = { [id]: { name: 'x', filter: emptyFilter() } }
    expect(newViewId(taken, 1000, () => 0)).not.toBe(id)
    const filter = filterWith({
      tag: [{ key: 'checkout-v2', label: 'checkout-v2' }],
      author: [{ key: 'a', label: 'Ada Lovelace' }],
      status: ['ciFailing'],
      text: 'submit',
    })
    expect(suggestViewName(filter, (status) => LABELS.status[status])).toBe(
      'Ada Lovelace · checkout-v2 · Checks failing · submit',
    )
  })
})
