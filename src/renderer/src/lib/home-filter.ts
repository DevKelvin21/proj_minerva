/**
 * Pure logic of the Home filter bar: facets (author, tag, repository,
 * reviewer, status) over the dashboard answer that is already loaded, typed
 * `facet:value` tokens, the "without X there would be N" hint of the empty
 * state, and the saved views kept in `localStorage` (untrusted on read).
 *
 * Combining: values inside one facet are OR, different facets are AND, and
 * the free text is AND on top (the repo page's text filter). "You" matches by
 * the identity main resolved (`viewer`), never by a display login.
 */
import { repoKey, type RepoRef, type ScmProviderId } from '../../../shared/scm'
import type { PullRequestSummary, UserRef } from '../../../shared/types'
import {
  filterPullRequestsByText,
  isUnread,
  needsMyReview,
  tagKey,
  type ViewerIdentity,
} from './dashboard'

export type PeopleFacet = 'author' | 'reviewer'
export type ValueFacet = PeopleFacet | 'tag' | 'repo'
export type FacetId = ValueFacet | 'status'

export const FACETS: readonly FacetId[] = ['author', 'tag', 'repo', 'reviewer', 'status']
const VALUE_FACETS: readonly ValueFacet[] = ['author', 'tag', 'repo', 'reviewer']

export type StatusId =
  'waitingOnMe' | 'draft' | 'changesRequested' | 'approved' | 'ciFailing' | 'unread'

export const STATUSES: readonly StatusId[] = [
  'waitingOnMe',
  'draft',
  'changesRequested',
  'approved',
  'ciFailing',
  'unread',
]

export function isStatusId(value: unknown): value is StatusId {
  return typeof value === 'string' && (STATUSES as readonly string[]).includes(value)
}

/** The signed-in user in the Author and Reviewer facets. Never a login (logins have no `@` prefix). */
export const ME_KEY = '@me'

/**
 * One picked value. `label` is kept with the key so a chip (or a saved view)
 * still reads well once nobody with that key has an open PR any more.
 */
export interface FilterValue {
  key: string
  label: string
}

export interface HomeFilter {
  author: FilterValue[]
  tag: FilterValue[]
  repo: FilterValue[]
  reviewer: FilterValue[]
  status: StatusId[]
  /** Free text, AND-ed word by word (title, #number, branch…). */
  text: string
}

export function emptyFilter(): HomeFilter {
  return { author: [], tag: [], repo: [], reviewer: [], status: [], text: '' }
}

/** Picked values (chips), text not included: the "Filters · n" count. */
export function filterValueCount(filter: HomeFilter): number {
  return VALUE_FACETS.reduce((sum, facet) => sum + filter[facet].length, filter.status.length)
}

/** Anything picked or typed: Home shows results instead of the overview. */
export function isFilterActive(filter: HomeFilter): boolean {
  return filterValueCount(filter) > 0 || textWords(filter.text).length > 0
}

/** Stable identity of a person on a provider: `provider:login` (lowercased). */
export function personKey(provider: ScmProviderId, user: Pick<UserRef, 'login'>): string {
  return provider + ':' + user.login.trim().toLowerCase()
}

/** What a person is called on screen: the display name, else the login. */
export function personLabel(user: UserRef): string {
  const name = user.displayName?.trim()
  return name ? name : user.login
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/** Facet names a typed token may use (English and Spanish), lowercased. */
const TOKEN_FACETS: Readonly<Record<string, FacetId>> = Object.assign(Object.create(null), {
  author: 'author',
  autor: 'author',
  by: 'author',
  tag: 'tag',
  label: 'tag',
  etiqueta: 'tag',
  repo: 'repo',
  repository: 'repo',
  repositorio: 'repo',
  reviewer: 'reviewer',
  revisor: 'reviewer',
  status: 'status',
  estado: 'status',
  is: 'status',
}) as Record<string, FacetId>

/** `author:` & co. (case-insensitive), or `null` when the word is not a facet token. */
export function tokenFacet(word: string): FacetId | null {
  const colon = word.indexOf(':')
  if (colon <= 0) return null
  const name = word.slice(0, colon).toLowerCase()
  return Object.hasOwn(TOKEN_FACETS, name) ? TOKEN_FACETS[name] : null
}

/** Splits text into words, keeping `"quoted values"` (and `facet:"two words"`) together. */
export function splitWords(text: string): string[] {
  const words: string[] = []
  const pattern = /(?:[^\s"]*"[^"]*"?)+[^\s"]*|[^\s"]+/g
  for (const match of text.matchAll(pattern)) words.push(match[0])
  return words
}

/** Words that filter as plain text: `facet:` tokens still waiting for Enter are left out. */
function textWords(text: string): string[] {
  return splitWords(text.trim()).filter((word) => tokenFacet(word) === null)
}

/** The text that filters, as one string (pending `facet:` tokens left out). */
export function plainText(text: string): string {
  return textWords(text).join(' ')
}

function peopleKeys(pr: PullRequestSummary, facet: PeopleFacet): Set<string> {
  const keys = new Set<string>()
  if (facet === 'author') {
    keys.add(personKey(pr.repo.provider, pr.author))
    if (pr.viewer?.isAuthor) keys.add(ME_KEY)
  } else {
    for (const reviewer of pr.reviewers ?? []) keys.add(personKey(pr.repo.provider, reviewer.user))
    if (pr.viewer && pr.viewer.reviewer !== null) keys.add(ME_KEY)
  }
  return keys
}

export function matchesStatus(pr: PullRequestSummary, status: StatusId, identity: ViewerIdentity): boolean {
  switch (status) {
    case 'waitingOnMe':
      return needsMyReview(pr, identity)
    case 'draft':
      return pr.isDraft
    case 'changesRequested':
      return pr.reviewDecision === 'changes_requested' || pr.reviewDecision === 'rejected'
    case 'approved':
      return pr.reviewDecision === 'approved'
    case 'ciFailing':
      return pr.ciStatus === 'failure'
    case 'unread':
      return isUnread(pr)
  }
}

/** The keys `pr` has for a facet (its author, its tags, its repo, its reviewers). */
function valueKeys(pr: PullRequestSummary, facet: ValueFacet): Set<string> {
  switch (facet) {
    case 'author':
    case 'reviewer':
      return peopleKeys(pr, facet)
    case 'tag':
      return new Set((pr.labels ?? []).map((label) => tagKey(label.name)).filter(Boolean))
    case 'repo':
      return new Set([repoKey(pr.repo)])
  }
}

/** Every facet (OR inside, AND across); the text is not checked here. */
function matchesFacets(pr: PullRequestSummary, filter: HomeFilter, identity: ViewerIdentity): boolean {
  for (const facet of VALUE_FACETS) {
    const wanted = filter[facet]
    if (wanted.length === 0) continue
    const keys = valueKeys(pr, facet)
    if (!wanted.some((value) => keys.has(value.key))) return false
  }
  if (filter.status.length > 0 && !filter.status.some((status) => matchesStatus(pr, status, identity))) {
    return false
  }
  return true
}

/** The PRs the filter keeps, in the dashboard's order. */
export function applyHomeFilter(
  pullRequests: readonly PullRequestSummary[],
  filter: HomeFilter,
  identity: ViewerIdentity,
): PullRequestSummary[] {
  const byFacets = pullRequests.filter((pr) => matchesFacets(pr, filter, identity))
  return filterPullRequestsByText(byFacets, textWords(filter.text).join(' ').replace(/"/g, ' '))
}

// ---------------------------------------------------------------------------
// Picker options
// ---------------------------------------------------------------------------

export interface FacetOption {
  key: string
  label: string
  /** Open PRs with this value (over the whole dashboard, not the filtered set). */
  count: number
  /** "You" (sorted first, its own section) vs everyone else. */
  section: 'me' | 'others'
  /** A person: for the avatar and for prefix matching on the login. */
  user?: UserRef
  repo?: RepoRef
  /** Extra lowercased words a typed token may start with (login, owner, `me`). */
  aliases: string[]
}

export interface OptionLabels {
  me: string
  status: Record<StatusId, string>
}

/**
 * Where one login names one person: the GitHub host (Minerva talks to one),
 * or an Azure DevOps organization (the same email in another org is
 * another identity there).
 */
function identityScope(repo: RepoRef): string {
  return repo.provider === 'github' ? 'github' : 'azure:' + repo.organization.toLowerCase()
}

/**
 * The signed-in user's own identities, learned from main's identity match:
 * the author of every PR whose `viewer.isAuthor` is set, per identity scope.
 * Nothing is guessed from a display name; a scope where the user authored
 * no open PR stays unknown.
 */
export interface ViewerSelf {
  /** `identityScope|login` (lowercased). */
  keys: Set<string>
  /** The user's logins and display names, lowercased: what `author:<you>` may type. */
  aliases: string[]
}

export function viewerSelf(pullRequests: readonly PullRequestSummary[]): ViewerSelf {
  const keys = new Set<string>()
  const aliases = new Set<string>()
  for (const pr of pullRequests) {
    if (!pr.viewer?.isAuthor) continue
    keys.add(identityScope(pr.repo) + '|' + pr.author.login.trim().toLowerCase())
    aliases.add(pr.author.login.trim().toLowerCase())
    const name = pr.author.displayName?.trim().toLowerCase()
    if (name) aliases.add(name)
  }
  return { keys, aliases: [...aliases] }
}

/** `user` (on `repo`'s provider) is the signed-in user, as far as `self` knows. */
export function isSelf(self: ViewerSelf, repo: RepoRef, user: Pick<UserRef, 'login'>): boolean {
  return self.keys.has(identityScope(repo) + '|' + user.login.trim().toLowerCase())
}

function byCountThenLabel(a: FacetOption, b: FacetOption): number {
  return b.count - a.count || a.label.localeCompare(b.label)
}

/**
 * The values a picker lists: only what exists among the open PRs, each with
 * how many PRs have it. "You" first for Author and Reviewer, and the
 * user's own identities (`viewerSelf`) are not listed again among the
 * people; statuses in their fixed order. A status nobody has is left out.
 */
export function facetOptions(
  pullRequests: readonly PullRequestSummary[],
  facet: FacetId,
  identity: ViewerIdentity,
  labels: OptionLabels,
): FacetOption[] {
  if (facet === 'status') {
    return STATUSES.map((status) => ({
      key: status,
      label: labels.status[status],
      count: pullRequests.filter((pr) => matchesStatus(pr, status, identity)).length,
      section: 'others' as const,
      aliases: [status.toLowerCase()],
    })).filter((option) => option.count > 0)
  }
  const self = viewerSelf(pullRequests)
  const byKey = new Map<string, FacetOption>()
  const bump = (key: string, make: () => Omit<FacetOption, 'count'>): void => {
    const existing = byKey.get(key)
    if (existing) existing.count += 1
    else byKey.set(key, { ...make(), count: 1 })
  }
  for (const pr of pullRequests) {
    const provider = pr.repo.provider
    if (facet === 'author' || facet === 'reviewer') {
      const users = facet === 'author' ? [pr.author] : (pr.reviewers ?? []).map((r) => r.user)
      const seen = new Set<string>()
      for (const user of users) {
        const key = personKey(provider, user)
        if (seen.has(key) || isSelf(self, pr.repo, user)) continue
        seen.add(key)
        bump(key, () => ({
          key,
          label: personLabel(user),
          section: 'others',
          user,
          aliases: [user.login.toLowerCase()],
        }))
      }
      if (peopleKeys(pr, facet).has(ME_KEY)) {
        bump(ME_KEY, () => ({
          key: ME_KEY,
          label: labels.me,
          section: 'me',
          aliases: ['me', ...self.aliases],
        }))
      }
    } else if (facet === 'tag') {
      const seen = new Set<string>()
      for (const label of pr.labels ?? []) {
        const key = tagKey(label.name)
        if (!key || seen.has(key)) continue
        seen.add(key)
        bump(key, () => ({ key, label: label.name.trim(), section: 'others', aliases: [] }))
      }
    } else {
      const key = repoKey(pr.repo)
      bump(key, () => ({
        key,
        label: pr.repo.name,
        section: 'others',
        repo: pr.repo,
        aliases: [pr.repo.fullName.toLowerCase()],
      }))
    }
  }
  const options = [...byKey.values()]
  const me = options.filter((option) => option.section === 'me')
  const others = options.filter((option) => option.section === 'others').sort(byCountThenLabel)
  return [...me, ...others]
}

/** Options whose label (or a word of it, or an alias) starts with `query`; blank = all. */
export function searchOptions(options: readonly FacetOption[], query: string): FacetOption[] {
  const wanted = query.trim().toLowerCase()
  if (!wanted) return [...options]
  return options.filter((option) => optionStartsWith(option, wanted))
}

function optionStartsWith(option: FacetOption, prefix: string): boolean {
  const label = option.label.toLowerCase()
  if (label.startsWith(prefix)) return true
  const words = (text: string): string[] => text.split(/[\s/_.@-]+/)
  if (words(label).some((word) => word.startsWith(prefix))) return true
  return option.aliases.some(
    (alias) => alias.startsWith(prefix) || words(alias).some((word) => word.startsWith(prefix)),
  )
}

// ---------------------------------------------------------------------------
// Editing a filter
// ---------------------------------------------------------------------------

export function hasValue(filter: HomeFilter, facet: FacetId, key: string): boolean {
  if (facet === 'status') return (filter.status as readonly string[]).includes(key)
  return filter[facet].some((value) => value.key === key)
}

/** Adds a value (no-op when it is already there). */
export function addValue(filter: HomeFilter, facet: FacetId, value: FilterValue): HomeFilter {
  if (hasValue(filter, facet, value.key)) return filter
  if (facet === 'status') {
    return isStatusId(value.key) ? { ...filter, status: [...filter.status, value.key] } : filter
  }
  return { ...filter, [facet]: [...filter[facet], value] }
}

export function removeValue(filter: HomeFilter, facet: FacetId, key: string): HomeFilter {
  if (facet === 'status') return { ...filter, status: filter.status.filter((item) => item !== key) }
  return { ...filter, [facet]: filter[facet].filter((value) => value.key !== key) }
}

export function toggleValue(filter: HomeFilter, facet: FacetId, value: FilterValue): HomeFilter {
  return hasValue(filter, facet, value.key)
    ? removeValue(filter, facet, value.key)
    : addValue(filter, facet, value)
}

/** One chip of the bar, in the order the values were picked per facet. */
export interface FilterChip {
  facet: FacetId
  key: string
  /** For a status: its id (the caller translates it). */
  label: string
}

export function filterChips(filter: HomeFilter): FilterChip[] {
  const chips: FilterChip[] = []
  for (const facet of FACETS) {
    if (facet === 'status') {
      for (const status of filter.status) chips.push({ facet, key: status, label: status })
    } else {
      for (const value of filter[facet]) chips.push({ facet, key: value.key, label: value.label })
    }
  }
  return chips
}

/** Same facets, same values (any order) and the same words. */
export function sameFilter(a: HomeFilter, b: HomeFilter): boolean {
  const sameKeys = (x: readonly string[], y: readonly string[]): boolean =>
    x.length === y.length && x.every((key) => y.includes(key))
  for (const facet of VALUE_FACETS) {
    if (!sameKeys(a[facet].map((v) => v.key), b[facet].map((v) => v.key))) return false
  }
  return (
    sameKeys(a.status, b.status) &&
    splitWords(a.text.trim()).join(' ') === splitWords(b.text.trim()).join(' ')
  )
}

// ---------------------------------------------------------------------------
// Empty state: which filter to drop
// ---------------------------------------------------------------------------

/** What to drop: one chip, or the free text. */
export type DropCandidate = { kind: 'chip'; chip: FilterChip } | { kind: 'text'; text: string }

export interface WithoutHint {
  drop: DropCandidate
  /** PRs the filter would keep without it. */
  count: number
}

/** `filter` minus one chip or minus its text. */
export function withoutCandidate(filter: HomeFilter, drop: DropCandidate): HomeFilter {
  return drop.kind === 'text'
    ? { ...filter, text: '' }
    : removeValue(filter, drop.chip.facet, drop.chip.key)
}

/**
 * "Without Status: Checks failing there would be 3": the one chip (or the
 * text) whose removal brings back the most PRs. `null` when no single
 * removal brings any back (only Clear helps). Ties go to the chip picked
 * last in the bar's order.
 */
export function bestWithoutHint(
  pullRequests: readonly PullRequestSummary[],
  filter: HomeFilter,
  identity: ViewerIdentity,
): WithoutHint | null {
  const candidates: DropCandidate[] = filterChips(filter).map((chip) => ({ kind: 'chip', chip }))
  const words = textWords(filter.text)
  if (words.length > 0) candidates.push({ kind: 'text', text: words.join(' ') })
  let best: WithoutHint | null = null
  for (const drop of candidates) {
    const count = applyHomeFilter(pullRequests, withoutCandidate(filter, drop), identity).length
    if (count > 0 && (best === null || count >= best.count)) best = { drop, count }
  }
  return best
}

// ---------------------------------------------------------------------------
// Typed tokens
// ---------------------------------------------------------------------------

export type OptionsByFacet = Readonly<Record<FacetId, readonly FacetOption[]>>

export interface ParsedTokens {
  /** Tokens that matched an existing value, in the order typed. */
  added: { facet: FacetId; value: FilterValue }[]
  /** Everything else, as typed (plain words and tokens that matched nothing). */
  rest: string
}

function unquote(value: string): string {
  return value.replace(/"/g, '').trim()
}

/**
 * `author:ada tag:checkout` → the chips "Author: Ada Lovelace" and
 * "Tag: checkout-v2": each `facet:prefix` picks the existing value that
 * starts with the prefix and has the most open PRs. A token with an unknown
 * facet or no matching value stays in the text.
 */
export function parseTypedTokens(text: string, options: OptionsByFacet): ParsedTokens {
  const added: ParsedTokens['added'] = []
  const rest: string[] = []
  for (const word of splitWords(text)) {
    const facet = tokenFacet(word)
    const prefix = facet ? unquote(word.slice(word.indexOf(':') + 1)).toLowerCase() : ''
    if (!facet || !prefix) {
      rest.push(word)
      continue
    }
    const match = searchOptions(options[facet], prefix)[0]
    if (!match) {
      rest.push(word)
      continue
    }
    if (!added.some((item) => item.facet === facet && item.value.key === match.key)) {
      added.push({ facet, value: { key: match.key, label: match.label } })
    }
  }
  return { added, rest: rest.join(' ') }
}

// ---------------------------------------------------------------------------
// Saved views (localStorage, untrusted on read)
// ---------------------------------------------------------------------------

export interface SavedView {
  name: string
  filter: HomeFilter
}

/** `id -> view`, prototype-less, in the order the views were saved. */
export type SavedViews = Readonly<Record<string, SavedView>>

export const VIEW_NAME_MAX_LENGTH = 60
export const VIEWS_MAX = 40
const VALUES_PER_FACET_MAX = 50
const VALUE_KEY_MAX_LENGTH = 300
const VALUE_LABEL_MAX_LENGTH = 200
const TEXT_MAX_LENGTH = 200
const VIEW_ID_PATTERN = /^v[a-z0-9]{1,24}$/

export function isViewId(value: unknown): value is string {
  return typeof value === 'string' && VIEW_ID_PATTERN.test(value)
}

/** A typed view name, trimmed and bounded; `null` = nothing to save. */
export function normalizeViewName(raw: string): string | null {
  const name = raw.trim().replace(/\s+/g, ' ').slice(0, VIEW_NAME_MAX_LENGTH)
  return name.length > 0 ? name : null
}

/** A prototype-less copy of `views` (an id like `constructor` stays plain data). */
export function cloneViews(views: SavedViews): Record<string, SavedView> {
  const copy: Record<string, SavedView> = Object.create(null)
  for (const id of Object.keys(views)) {
    if (Object.hasOwn(views, id)) copy[id] = views[id]
  }
  return copy
}

function parseValues(raw: unknown): FilterValue[] {
  if (!Array.isArray(raw)) return []
  const values: FilterValue[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const { key, label } = item as Record<string, unknown>
    if (typeof key !== 'string' || typeof label !== 'string') continue
    const cleanKey = key.trim()
    if (!cleanKey || cleanKey.length > VALUE_KEY_MAX_LENGTH) continue
    if (values.some((value) => value.key === cleanKey)) continue
    values.push({ key: cleanKey, label: label.slice(0, VALUE_LABEL_MAX_LENGTH) || cleanKey })
    if (values.length >= VALUES_PER_FACET_MAX) break
  }
  return values
}

/** A filter read back from storage: every field checked, anything odd dropped. */
export function parseFilter(raw: unknown): HomeFilter {
  const filter = emptyFilter()
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return filter
  const source = raw as Record<string, unknown>
  for (const facet of VALUE_FACETS) filter[facet] = parseValues(source[facet])
  if (Array.isArray(source.status)) {
    filter.status = [...new Set(source.status.filter(isStatusId))]
  }
  if (typeof source.text === 'string') filter.text = source.text.slice(0, TEXT_MAX_LENGTH)
  return filter
}

/** Parses the persisted views (bad JSON, arrays, `__proto__`, odd ids: dropped). */
export function parseSavedViews(raw: string | null): Record<string, SavedView> {
  const views: Record<string, SavedView> = Object.create(null)
  if (!raw) return views
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return views
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return views
  const source = parsed as Record<string, unknown>
  let kept = 0
  for (const id of Object.keys(source)) {
    if (kept >= VIEWS_MAX) break
    if (!Object.hasOwn(source, id) || !isViewId(id)) continue
    const entry = source[id]
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue
    const { name, filter } = entry as Record<string, unknown>
    const cleanName = typeof name === 'string' ? normalizeViewName(name) : null
    if (cleanName === null) continue
    const cleanFilter = parseFilter(filter)
    if (!isFilterActive(cleanFilter)) continue
    views[id] = { name: cleanName, filter: cleanFilter }
    kept += 1
  }
  return views
}

/** A fresh view id (`v` + base36 time + random), never one already taken. */
export function newViewId(taken: SavedViews, now = Date.now(), random = Math.random): string {
  for (;;) {
    const id = 'v' + now.toString(36) + Math.floor(random() * 36 ** 4).toString(36)
    if (!Object.hasOwn(taken, id)) return id
    now += 1
  }
}

/** A name to start from: the picked values (and the text), " · "-joined. */
export function suggestViewName(filter: HomeFilter, statusLabel: (status: StatusId) => string): string {
  const parts = filterChips(filter).map((chip) =>
    chip.facet === 'status' && isStatusId(chip.key) ? statusLabel(chip.key) : chip.label,
  )
  const words = textWords(filter.text)
  if (words.length > 0) parts.push(words.join(' '))
  return normalizeViewName(parts.join(' · ')) ?? ''
}

/** Distinct repositories among `pullRequests`. */
export function repoCount(pullRequests: readonly PullRequestSummary[]): number {
  return new Set(pullRequests.map((pr) => repoKey(pr.repo))).size
}
