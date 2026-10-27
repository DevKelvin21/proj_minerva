/**
 * Pure logic of the home dashboard: per-repo summaries, the viewer filter,
 * cross-repo feature groups (a tag/label shared by PRs in several repos of
 * the same provider + owner/organization) and the custom feature names /
 * hidden groups the user keeps in `localStorage`.
 *
 * Everything here works on the `scm:getDashboard` answer (open PRs with
 * `labels`, `reviewers`, `viewer`, `unread`) plus the stacks from
 * `scm:getStacks`; nothing fetches. Components only render what this returns.
 */
import {
  prKey,
  repoKey,
  type PrStack,
  type RepoRef,
  type ReviewerVote,
  type ScmProviderId,
} from '../../../shared/scm'
import type { PullRequestSummary } from '../../../shared/types'
import { flattenStackNodes } from './stacks'

/** Filter of a repo page: who the PR is for, from the signed-in user's point of view. */
export type ViewerFilter = 'all' | 'required' | 'optional' | 'mine' | 'unassigned'

export const VIEWER_FILTERS: readonly ViewerFilter[] = [
  'all',
  'required',
  'optional',
  'mine',
  'unassigned',
]

export function isViewerFilter(value: unknown): value is ViewerFilter {
  return typeof value === 'string' && (VIEWER_FILTERS as readonly string[]).includes(value)
}

/**
 * Who the signed-in user is on each provider (`ScmAuthStatus.user.login`),
 * to find the user's own vote among a PR's reviewers. A provider missing
 * here = identity unknown there.
 */
export type ViewerIdentity = Partial<Record<ScmProviderId, string>>

/**
 * Viewer filter predicate. PRs whose `viewer` relation is unknown (absent)
 * match only `all`: the dashboard must not claim "not assigned to you" when
 * it does not know.
 */
export function matchesViewerFilter(pr: PullRequestSummary, filter: ViewerFilter): boolean {
  if (filter === 'all') return true
  const viewer = pr.viewer
  if (!viewer) return false
  switch (filter) {
    case 'required':
      return viewer.reviewer === 'required'
    case 'optional':
      return viewer.reviewer === 'optional'
    case 'mine':
      return viewer.isAuthor
    case 'unassigned':
      return !viewer.isAuthor && viewer.reviewer === null
  }
}

export function filterByViewer(
  pullRequests: readonly PullRequestSummary[],
  filter: ViewerFilter,
): PullRequestSummary[] {
  return pullRequests.filter((pr) => matchesViewerFilter(pr, filter))
}

/** The user's own vote on `pr`, or `null` when the identity or the reviewer list is unknown. */
export function myVote(pr: PullRequestSummary, identity: ViewerIdentity): ReviewerVote | null {
  const login = identity[pr.repo.provider]
  if (!login || !pr.reviewers) return null
  const wanted = login.toLowerCase()
  const mine = pr.reviewers.find((reviewer) => reviewer.user.login.toLowerCase() === wanted)
  return mine ? mine.vote : null
}

/**
 * "Needs my review": the user is a required reviewer and has not voted yet.
 * When the user's own vote cannot be found (identity unknown, reviewers not
 * reported), being a required reviewer is enough: better to over-ask than
 * to hide a PR that is waiting for the user.
 */
export function needsMyReview(pr: PullRequestSummary, identity: ViewerIdentity): boolean {
  if (pr.viewer?.reviewer !== 'required') return false
  // Main's identity-matched vote wins; the login match is only a fallback.
  const vote = pr.viewer.vote ?? myVote(pr, identity)
  return vote === null || vote === 'none'
}

/** Treats a missing `unread` as "seen", like the PR list does. */
export function isUnread(pr: PullRequestSummary): boolean {
  return Boolean(pr.unread && (pr.unread.isNew || pr.unread.hasUpdates || pr.unread.hasNewComments))
}

/** Counts shown on a repo card / a repo page header. */
export interface RepoCounts {
  open: number
  /** Required reviewer, no vote yet (see `needsMyReview`). */
  needsMyReview: number
  /** Optional reviewer. */
  optional: number
  /** Authored by the user. */
  mine: number
  unread: number
  /** Stacks with 2+ PRs in this repo. */
  stacks: number
  /** Orphaned PRs in this repo (stack roots that target a completed PR's branch). */
  orphans: number
}

export interface RepoSummary extends RepoCounts {
  key: string
  repo: RepoRef
  /** Open PRs of the repo, in the order the dashboard listed them. */
  pullRequests: PullRequestSummary[]
}

function emptyCounts(): RepoCounts {
  return { open: 0, needsMyReview: 0, optional: 0, mine: 0, unread: 0, stacks: 0, orphans: 0 }
}

/** Counts for an arbitrary set of PRs (a repo, a filtered repo page, a feature group). */
export function countPullRequests(
  pullRequests: readonly PullRequestSummary[],
  identity: ViewerIdentity,
): Omit<RepoCounts, 'stacks' | 'orphans'> {
  const counts = emptyCounts()
  for (const pr of pullRequests) {
    counts.open += 1
    if (needsMyReview(pr, identity)) counts.needsMyReview += 1
    if (pr.viewer?.reviewer === 'optional') counts.optional += 1
    if (pr.viewer?.isAuthor) counts.mine += 1
    if (isUnread(pr)) counts.unread += 1
  }
  const { open, needsMyReview: needs, optional, mine, unread } = counts
  return { open, needsMyReview: needs, optional, mine, unread }
}

/** Stacks of 2+ PRs, per `repoKey`. */
export function stacksByRepo(stacks: readonly PrStack[] | null): Map<string, PrStack[]> {
  const byRepo = new Map<string, PrStack[]>()
  for (const stack of stacks ?? []) {
    const key = repoKey(stack.repo)
    const list = byRepo.get(key)
    if (list) list.push(stack)
    else byRepo.set(key, [stack])
  }
  return byRepo
}

/**
 * One summary per repo with open PRs (or with a stack), ordered by what needs
 * the user first: PRs waiting for their required review, then orphans, then
 * open count, then name. Repos only known through a stack (no PR in the
 * dashboard answer) still get a card so the stack is reachable.
 */
export function summarizeRepos(
  pullRequests: readonly PullRequestSummary[],
  stacks: readonly PrStack[] | null,
  identity: ViewerIdentity,
): RepoSummary[] {
  const byKey = new Map<string, RepoSummary>()
  const ensure = (repo: RepoRef): RepoSummary => {
    const key = repoKey(repo)
    let summary = byKey.get(key)
    if (!summary) {
      summary = { key, repo, pullRequests: [], ...emptyCounts() }
      byKey.set(key, summary)
    }
    return summary
  }
  for (const pr of pullRequests) ensure(pr.repo).pullRequests.push(pr)
  for (const summary of byKey.values()) {
    Object.assign(summary, countPullRequests(summary.pullRequests, identity))
  }
  for (const [key, repoStacks] of stacksByRepo(stacks)) {
    const summary = byKey.get(key) ?? ensure(repoStacks[0].repo)
    summary.stacks = repoStacks.filter((stack) => stack.size > 1).length
    summary.orphans = repoStacks.filter((stack) => stack.root.orphan !== undefined).length
  }
  return [...byKey.values()].sort(
    (a, b) =>
      b.needsMyReview - a.needsMyReview ||
      b.orphans - a.orphans ||
      b.open - a.open ||
      a.repo.fullName.localeCompare(b.repo.fullName),
  )
}

/** Stable key of a tag/label: lowercased, trimmed. `''` for blank names. */
export function tagKey(tag: string): string {
  return tag.trim().toLowerCase()
}

/**
 * Where a tag names ONE feature: a GitHub owner or an Azure DevOps
 * organization. Generic labels (`bug`, `backend`) on another provider or
 * another org are unrelated work and never merge.
 */
export function featureScope(repo: RepoRef): string {
  return repo.provider === 'github'
    ? 'github:' + repo.owner.toLowerCase()
    : 'azure:' + repo.organization.toLowerCase()
}

/** Identity of a feature group: `<scope>:<tagKey>`. `''` for a blank tag. */
export function featureKey(repo: RepoRef, tag: string): string {
  const key = tagKey(tag)
  return key ? featureScope(repo) + ':' + key : ''
}

/**
 * Shape check for a feature key read back from storage (untrusted text):
 * `provider:owner:tag`, lowercased, bounded, never a prototype name.
 */
const FEATURE_KEY_PATTERN = /^(github|azure):[^:\s][^:]*:\S.*$/
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
export const FEATURE_KEY_MAX_LENGTH = 300

export function isFeatureKey(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= FEATURE_KEY_MAX_LENGTH &&
    FEATURE_KEY_PATTERN.test(value) &&
    value === value.toLowerCase() &&
    value === value.trim() &&
    !FORBIDDEN_KEYS.has(value)
  )
}

/** Custom feature names: a prototype-less `featureKey -> name` map (safe for any key). */
export type FeatureNames = Readonly<Record<string, string>>

/** A prototype-less copy of `names` (keys like `constructor` stay plain data). */
export function cloneFeatureNames(names: FeatureNames): Record<string, string> {
  const copy: Record<string, string> = Object.create(null)
  for (const key of Object.keys(names)) {
    if (Object.hasOwn(names, key)) copy[key] = names[key]
  }
  return copy
}

export interface FeatureRepo {
  key: string
  repo: RepoRef
  pullRequests: PullRequestSummary[]
}

/** PRs in several repos that share one tag/label: one feature split across services. */
export interface FeatureGroup {
  /** `featureKey(repo, tag)` */
  key: string
  /** `featureScope(repo)` of its repos. */
  scope: string
  /** The tag as first seen (original casing). */
  tag: string
  /** Display name: the user's custom name when set, else the tag. */
  name: string
  /** `true` when `name` is a custom name. */
  renamed: boolean
  /** Hidden from the overview by the user. */
  hidden: boolean
  repos: FeatureRepo[]
  prCount: number
  approved: number
  needsMyReview: number
}

/**
 * Feature groups from the tags/labels shared by open PRs in >= 2 DISTINCT
 * repos of the same provider + owner/organization. Sorted by repo count,
 * then PR count, then name. `customNames` maps `featureKey` -> display
 * name; `hiddenKeys` flags groups the user hid (they are still returned,
 * with `hidden: true`, so the overview can offer to show them again).
 */
export function buildFeatureGroups(
  pullRequests: readonly PullRequestSummary[],
  customNames: FeatureNames,
  identity: ViewerIdentity,
  hiddenKeys: ReadonlySet<string> = new Set(),
): FeatureGroup[] {
  const byKey = new Map<string, { scope: string; tag: string; repos: Map<string, FeatureRepo> }>()
  for (const pr of pullRequests) {
    const seen = new Set<string>()
    for (const label of pr.labels ?? []) {
      const key = featureKey(pr.repo, label.name)
      if (!key || seen.has(key)) continue
      seen.add(key)
      let entry = byKey.get(key)
      if (!entry) {
        entry = { scope: featureScope(pr.repo), tag: label.name.trim(), repos: new Map() }
        byKey.set(key, entry)
      }
      const rKey = repoKey(pr.repo)
      let featureRepo = entry.repos.get(rKey)
      if (!featureRepo) {
        featureRepo = { key: rKey, repo: pr.repo, pullRequests: [] }
        entry.repos.set(rKey, featureRepo)
      }
      featureRepo.pullRequests.push(pr)
    }
  }
  const groups: FeatureGroup[] = []
  for (const [key, entry] of byKey) {
    if (entry.repos.size < 2) continue
    const repos = [...entry.repos.values()].sort((a, b) =>
      a.repo.fullName.localeCompare(b.repo.fullName),
    )
    const all = repos.flatMap((repo) => repo.pullRequests)
    const custom = Object.hasOwn(customNames, key) ? customNames[key] : undefined
    groups.push({
      key,
      scope: entry.scope,
      tag: entry.tag,
      name: typeof custom === 'string' ? custom : entry.tag,
      renamed: typeof custom === 'string',
      hidden: hiddenKeys.has(key),
      repos,
      prCount: all.length,
      approved: all.filter((pr) => pr.reviewDecision === 'approved').length,
      needsMyReview: all.filter((pr) => needsMyReview(pr, identity)).length,
    })
  }
  return groups.sort(
    (a, b) =>
      b.repos.length - a.repos.length ||
      b.prCount - a.prCount ||
      a.name.localeCompare(b.name),
  )
}

/** Longest custom feature name kept (anything longer is cut when saved). */
export const FEATURE_NAME_MAX_LENGTH = 80

/** Normalizes a custom name typed by the user; `null` = nothing to keep (falls back to the tag). */
export function normalizeFeatureName(raw: string): string | null {
  const name = raw.trim().replace(/\s+/g, ' ').slice(0, FEATURE_NAME_MAX_LENGTH)
  return name.length > 0 ? name : null
}

function parseJsonObject(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  return parsed as Record<string, unknown>
}

/**
 * Parses the persisted custom names (untrusted `localStorage` text) into a
 * prototype-less map: keeps only own string -> non-empty string entries
 * whose key is a valid `featureKey`. Anything else (bad JSON, arrays,
 * nested objects, `__proto__`) is dropped.
 */
export function parseFeatureNames(raw: string | null): Record<string, string> {
  const names: Record<string, string> = Object.create(null)
  const parsed = parseJsonObject(raw)
  if (!parsed) return names
  for (const key of Object.keys(parsed)) {
    if (!Object.hasOwn(parsed, key) || !isFeatureKey(key)) continue
    const value = parsed[key]
    if (typeof value !== 'string') continue
    const name = normalizeFeatureName(value)
    if (name !== null) names[key] = name
  }
  return names
}

/** Most hidden groups remembered (older entries beyond the cap are dropped). */
export const HIDDEN_FEATURES_MAX = 500

/** Parses the persisted hidden feature keys (untrusted): a JSON array of valid `featureKey`s, deduplicated. */
export function parseHiddenFeatures(raw: string | null): string[] {
  if (!raw) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const keys: string[] = []
  const seen = new Set<string>()
  for (const value of parsed) {
    if (!isFeatureKey(value) || seen.has(value)) continue
    seen.add(value)
    keys.push(value)
    if (keys.length >= HIDDEN_FEATURES_MAX) break
  }
  return keys
}

/** Plain-text filter for a repo page: every word must appear in title, #number, branches or author. */
export function filterPullRequestsByText(
  pullRequests: readonly PullRequestSummary[],
  query: string,
): PullRequestSummary[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return [...pullRequests]
  return pullRequests.filter((pr) => {
    const haystack = [
      pr.title,
      '#' + pr.number,
      pr.headRef,
      pr.baseRef,
      pr.author.login,
      pr.author.displayName ?? '',
      ...(pr.labels ?? []).map((label) => label.name),
    ]
      .join(' ')
      .toLowerCase()
    return words.every((word) => haystack.includes(word))
  })
}

/**
 * Splits a repo's stacks into the ones drawn on the board (2+ PRs, or an
 * orphan that needs attention) and the keys of every PR they contain, so the
 * plain list below the board can leave those out.
 */
export function boardStacks(repoStacks: readonly PrStack[]): {
  stacks: PrStack[]
  stackedKeys: Set<string>
} {
  const stacks = repoStacks.filter((stack) => stack.size > 1 || stack.root.orphan !== undefined)
  const stackedKeys = new Set<string>()
  for (const stack of stacks) {
    for (const node of flattenStackNodes(stack.root)) stackedKeys.add(node.prKey)
  }
  return { stacks, stackedKeys }
}

/** Root-first, depth-first order of a stack's PR keys: the "review stack" reading order. */
export function stackOrder(stack: PrStack): string[] {
  return flattenStackNodes(stack.root).map((node) => node.prKey)
}

/** Position of a PR inside a stack (1-based) with its neighbours, or `null` when it is not in it. */
export function stackPosition(
  stack: PrStack,
  key: string,
): { index: number; total: number; previous: string | null; next: string | null } | null {
  const order = stackOrder(stack)
  const index = order.indexOf(key)
  if (index === -1) return null
  return {
    index: index + 1,
    total: order.length,
    previous: index > 0 ? order[index - 1] : null,
    next: index < order.length - 1 ? order[index + 1] : null,
  }
}

/** Looks up the dashboard's summary of a PR by key. */
export function findPullRequest(
  pullRequests: readonly PullRequestSummary[],
  key: string,
): PullRequestSummary | undefined {
  return pullRequests.find((pr) => prKey(pr.repo, pr.number) === key)
}

/** "org / project" (Azure DevOps) or "owner" (GitHub): where a repo lives, for subtitles. */
export function repoOwnerLabel(repo: RepoRef): string {
  return repo.provider === 'github' ? repo.owner : repo.organization + ' / ' + repo.project
}

/** Stacks that contain at least one PR matching `filter` (PRs not listed match only "all"). */
export function visibleStacks(
  stacks: readonly PrStack[],
  pullRequests: readonly PullRequestSummary[],
  filter: ViewerFilter,
): PrStack[] {
  if (filter === 'all') return [...stacks]
  return stacks.filter((stack) =>
    flattenStackNodes(stack.root).some((node) => {
      const summary = findPullRequest(pullRequests, node.prKey)
      return summary !== undefined && matchesViewerFilter(summary, filter)
    }),
  )
}
