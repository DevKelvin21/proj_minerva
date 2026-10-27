/**
 * Source-control (SCM) contract shared by main and renderer.
 *
 * Minerva reviews pull requests from more than one provider. Everything the
 * renderer sees is provider-neutral; provider specifics live behind
 * `ScmProvider` in `src/main/scm/`. Types only, plus a few pure helpers.
 *
 * Rule: every provider hands the renderer a unified-diff `patch` per file
 * (built in main when the provider has no native patch, e.g. Azure DevOps),
 * so the diff viewer stays provider-agnostic.
 */

export type ScmProviderId = 'github' | 'azure'

export interface GithubRepoRef {
  provider: 'github'
  owner: string
  name: string
  /** Display label, `owner/name`. */
  fullName: string
}

export interface AzureRepoRef {
  provider: 'azure'
  /** Organization name as it appears in `https://dev.azure.com/{organization}`. */
  organization: string
  project: string
  /** Repository name (display + URLs). */
  name: string
  /** Repository GUID (stable; used for REST calls). */
  repositoryId: string
  /** Display label, `organization/project/name`. */
  fullName: string
}

export type RepoRef = GithubRepoRef | AzureRepoRef

/** Stable identity of a repo across providers. Never parse it; build it with this. */
export function repoKey(repo: RepoRef): string {
  return repo.provider === 'github'
    ? `github:${repo.owner}/${repo.name}`.toLowerCase()
    : `azure:${repo.organization}/${repo.project}/${repo.repositoryId}`.toLowerCase()
}

/** Stable identity of a PR. Replaces every ad-hoc `owner/name#n` key. */
export function prKey(repo: RepoRef, number: number): string {
  return `${repoKey(repo)}#${number}`
}

export function sameRepo(a: RepoRef, b: RepoRef): boolean {
  return repoKey(a) === repoKey(b)
}

export function prWebUrl(repo: RepoRef, number: number): string {
  if (repo.provider === 'github') return `https://github.com/${repo.owner}/${repo.name}/pull/${number}`
  const enc = encodeURIComponent
  return `https://dev.azure.com/${enc(repo.organization)}/${enc(repo.project)}/_git/${enc(repo.name)}/pullrequest/${number}`
}

/** Branch names are always short (`feature/x`), never `refs/heads/feature/x`. */
export function shortRef(ref: string): string {
  return ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : ref
}

/**
 * Reviewer vote, normalized.
 * GitHub: APPROVED -> approved, CHANGES_REQUESTED -> changes_requested,
 * COMMENTED/PENDING/requested -> none.
 * Azure DevOps: 10 approved, 5 approved_with_suggestions, 0 none,
 * -5 changes_requested ("waiting for author"), -10 rejected.
 */
export type ReviewerVote =
  | 'approved'
  | 'approved_with_suggestions'
  | 'none'
  | 'changes_requested'
  | 'rejected'

/**
 * Comment-thread status, normalized.
 * GitHub only knows resolved/unresolved: active | resolved.
 * Azure DevOps: active, pending, fixed -> resolved, wontFix -> wont_fix,
 * closed, byDesign -> by_design.
 */
export type ThreadStatus = 'active' | 'pending' | 'resolved' | 'wont_fix' | 'closed' | 'by_design'

/** Statuses a user can set from the UI, per provider. */
export const SETTABLE_THREAD_STATUSES: Record<ScmProviderId, readonly ThreadStatus[]> = {
  github: ['active', 'resolved'],
  azure: ['active', 'pending', 'resolved', 'wont_fix', 'closed', 'by_design'],
}

export function isThreadOpen(status: ThreadStatus): boolean {
  return status === 'active' || status === 'pending'
}

/** Typed error codes carried across IPC (instead of matching message text). */
export type ScmErrorCode =
  | 'UNAUTHENTICATED'
  | 'CLI_UNAVAILABLE'
  | 'RATE_LIMITED'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'CONFLICT'
  | 'NETWORK'
  | 'UNKNOWN'

export interface ScmAuthStatus {
  provider: ScmProviderId
  /**
   * - `disabled`: provider turned off in Settings (or not configured: Azure with no org).
   * - `cli_unavailable`: the CLI (`gh` / `az`) was not found.
   * - `cli_unauthenticated`: CLI found but no usable session/token.
   * - `signed_in`: ready.
   */
  state: 'disabled' | 'cli_unavailable' | 'cli_unauthenticated' | 'signed_in'
  /** Display identity (login / email). Never a token. */
  user?: { login: string; displayName?: string }
  /** Human-readable hint for the non-ready states (what to run, which account failed). */
  detail?: string
  /** Azure: how the credential was obtained. Display only. */
  credentialSource?: 'gh-cli' | 'env-pat' | 'az-devops-pat' | 'az-entra'
}

/** One stacked-PR chain node. */
export interface StackNode {
  /** `prKey(repo, number)` */
  prKey: string
  repo: RepoRef
  number: number
  title: string
  headRef: string
  baseRef: string
  state: 'open' | 'closed' | 'merged'
  isDraft: boolean
  /** Child PRs whose `baseRef` is this PR's `headRef` (same repo). */
  children: StackNode[]
  /** Set when this PR targets a branch whose PR already completed/merged. */
  orphan?: StackOrphanInfo
}

export interface StackOrphanInfo {
  /** The completed parent PR whose source branch this PR still targets. */
  parent: { number: number; title: string; mergedInto: string }
  /** Whether the stale target branch still exists on the remote. */
  targetBranchExists: boolean
  /** Suggested new base: the parent's own target branch. */
  suggestedBase: string
}

/** A stack rooted at a PR whose base is NOT another open PR's head. */
export interface PrStack {
  repo: RepoRef
  root: StackNode
  /** Number of PRs in the stack (root included). */
  size: number
  /**
   * Same-named stacks found in other repos of the same provider/org
   * (e.g. one feature split across services). Optional grouping hint.
   */
  groupKey?: string
}

/** Which side of the PR diff a file read refers to (`scm:getFileContent`). */
export type FileContentSide = 'base' | 'head'

/** Largest file `scm:getFileContent` returns; over it, `tooLarge: true` and no content. */
export const MAX_FILE_CONTENT_BYTES = 1024 * 1024

/**
 * Response of `scm:getFileContent`. `content` is `null` for binaries and for
 * files over `MAX_FILE_CONTENT_BYTES`. A file missing on that side (added on
 * head, deleted on base) is a `NOT_FOUND` error, not an empty result.
 */
export interface FileContent {
  content: string | null
  isBinary: boolean
  tooLarge: boolean
}

/** One Azure DevOps organization and the projects Minerva lists PRs from. */
export interface AzureOrganizationSettings {
  /** Organization NAME (`Contoso`), never a URL. */
  organization: string
  /** Project names. Empty = nothing listed for this org until the user picks one. */
  projects: string[]
}

/** Per-provider source-control settings (persisted in settings.json under `scm`). */
export interface ScmProviderSettings {
  github: { enabled: boolean }
  azure: { enabled: boolean; organizations: AzureOrganizationSettings[] }
}
