/**
 * The Azure DevOps `ScmProvider`, on top of the REST client (`./client.ts`),
 * the `az` credential bridge (`./credentials.ts`) and the pure mappers.
 *
 * Scope: the organizations + projects saved in Settings (`scm.azure`, see
 * `../scm-settings.ts`). Every per-repo call checks that the repo's
 * organization AND project are configured and that `repositoryId` is a GUID,
 * so a forged `RepoRef` can't make main look up (and send) a credential for
 * an organization the user never configured, or reach outside its projects.
 *
 * Big PRs: only the first `maxFiles` (300) changes get a diff, but every
 * change entry is still COUNTED (up to `MAX_CHANGES_COUNTED`), so the detail
 * reports the true `changedFiles` + `filesTruncated`, threads on files past
 * the cap are not mislabeled outdated, and commenting on one gives an
 * accurate error. Iteration changes and built files are single-flight per
 * `prKey@iteration` and cached under a count AND a memory budget.
 *
 * Fan-out: list queries (PR lists, stack candidates) share one limiter of
 * `LIST_CONCURRENCY` requests in flight.
 *
 * `updatedAt`: Azure's PR object has no "last updated" field. It is derived
 * as the max of
 *   1. `creationDate` and `closedDate`;
 *   2. the latest iteration's `createdDate` (= last push), fetched once per
 *      head commit for open PRs and cached in memory;
 *   3. the moment THIS process first saw the PR's fingerprint change (title,
 *      draft flag, status, target branch, head commit, merge status, votes),
 *      which covers votes and edits that carry no timestamp.
 * So a push is dated exactly (even if it happened while the app was closed),
 * and votes/edits are dated when the list first reflects them.
 * `commentCount` is `null` in the list (counting would cost a threads call
 * per PR on every poll). Scope listings (`listScopePullRequests`, every active
 * PR of the configured projects) do NOT look up the last push: that would be
 * one iterations call per PR. Their `updatedAt` uses what the tracker already
 * knows, else the creation date.
 *
 * Summaries carry `labels` (tags), `reviewers` (with `isRequired`) and
 * `viewer`, computed against the org's `connectionData` identity id.
 */
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  MAX_FILE_CONTENT_BYTES,
  prKey,
  shortRef,
  type AzureOrganizationSettings,
  type AzureRepoRef,
  type FileContent,
  type RepoRef,
  type ScmAuthStatus,
} from '../../../shared/scm'
import type {
  CommentThread,
  DiffFile,
  FileContentRequest,
  MergeOptions,
  PostCommentRequest,
  PrComment,
  PrWorkItem,
  PullRequestDetail,
  PullRequestSummary,
  SetThreadStatusRequest,
} from '../../../shared/types'
import { AZURE_GUID_RE, isAzureRepoRef } from '../../../shared/scm-guards'
import { ScmError, toScmError } from '../errors'
import { mt } from '../../i18n'
import type {
  AutoMergeWrite,
  ListPullRequestsQuery,
  MergeWrite,
  MergeWriteResult,
  ScmProvider,
  ScopePullRequest,
  SnapshotRequest,
} from '../provider'
import type { StackInputPr } from '../stacks'
import type {
  AzComment,
  AzConnectionData,
  AzGitRef,
  AzIteration,
  AzIterationChanges,
  AzListResponse,
  AzPolicyEvaluation,
  AzPullRequest,
  AzPullRequestStatusEntry,
  AzThread,
} from './api-types'
import { azureMergeStrategy, mapAutoComplete, mapAzureMergeOptions } from './merge-options'
import {
  AzureApiError,
  AzureTooLargeError,
  gitRepoUrl,
  orgApiUrl,
  type AzureDevOpsClient,
  type CredentialProvider,
} from './client'
import { organizationUrl, type AzureCredentialKind } from './credentials'
import { buildDiffFiles, DEFAULT_DIFF_BUDGET, type DiffBudget } from './diff-files'
import {
  isThreadOutdated,
  latestDate,
  mapChangeEntry,
  mapChecks,
  mapCiStatus,
  mapComment,
  mapMergeStatus,
  mapPullRequestSummary,
  mapRepo,
  mapReviewer,
  mapThread,
  threadAnchor,
  threadOrigin,
  threadStatusToAzure,
  toAzurePath,
  toRepoPath,
  type AzureChange,
} from './mappers'
import { looksBinary } from './patch-builder'
import { extractZipSafely, MAX_ZIP_BYTES, ZipExtractError } from './zip-extract'

export interface AzureProviderConfig {
  enabled: boolean
  organizations: AzureOrganizationSettings[]
}

/** The client surface the provider uses (a fake `fetch` behind the real client in mock mode). */
export type AzureRestClient = Pick<
  AzureDevOpsClient,
  'json' | 'binary' | 'download' | 'listTopSkip' | 'listContinuation'
>

export interface AzureScmProviderOptions {
  client: AzureRestClient
  credentials: CredentialProvider
  getConfig: () => AzureProviderConfig
  now?: () => number
  diffBudget?: Partial<DiffBudget>
  /** Where repo zips are downloaded before extraction. Default: the OS temp dir. */
  tmpRoot?: () => string
  /** Memory budget of the iteration cache. Default `FILES_CACHE_MAX_BYTES`. */
  filesCacheMaxBytes?: number
}

/** Open PRs per role query; the active list of a whole project was ~120 in the real org. */
const LIST_TOP_ACTIVE = 500
const LIST_TOP_COMPLETED = 100
const LIST_TOP_ABANDONED = 50
const STACK_CANDIDATES_MAX = 2000
const CHANGES_PAGE = 2000
/** Change entries counted past the diff cap (true `changedFiles`); a bound, not a budget. */
export const MAX_CHANGES_COUNTED = 20_000
const MAX_CHANGE_PAGES = Math.ceil(MAX_CHANGES_COUNTED / CHANGES_PAGE) + 1
const FILES_CACHE_SIZE = 20
/** Memory budget of the iteration cache (paths + patches, UTF-16 bytes). */
export const FILES_CACHE_MAX_BYTES = 64 * 1024 * 1024
const AUTH_STATUS_TTL_MS = 10_000
const ITERATION_LOOKUP_CONCURRENCY = 4
/** Requests in flight for list queries (PR lists, stack candidates), across orgs. */
const LIST_CONCURRENCY = 6
/** Retry delay of a failed "last push" lookup (403/404 are not retried for that head). */
const ITERATION_RETRY_MS = 5 * 60_000
/** PRs the activity tracker remembers (oldest dropped first). */
const MAX_ACTIVITY_ENTRIES = 5000
const PROJECTS_TTL_MS = 60_000
const PROJECTS_FAILURE_TTL_MS = 10_000
const MAX_PROJECT_LISTS = 20
const MAX_WORK_ITEMS = 50
const MAX_COMMITS_COUNTED = 1000
const POLICY_API_VERSION = '7.1-preview.1'
const COMMIT_SHA_RE = /^[0-9a-f]{40}$/i

interface Identity {
  id: string
  login: string
  displayName: string
}

interface ActivityEntry {
  fingerprint: string
  /** When this process saw the fingerprint change (ISO); `null` until it does. */
  changedAt: string | null
  /** Latest iteration date for `iterationHead`. */
  iterationDate: string | null
  iterationHead: string | null
  /** Head whose lookup failed, and when to try it again (`Infinity` = not for this head). */
  failedHead: string | null
  retryAt: number
}

interface IterationFiles {
  /** The first `maxFiles` changes: the ones that get a diff. */
  changes: AzureChange[]
  /** Path of EVERY change counted, also past the cap. */
  allPaths: ReadonlySet<string>
  /** Changes counted: the true total unless `countCapped`. */
  total: number
  /** `total > changes.length`: some files have no diff. */
  truncated: boolean
  /** Counting stopped at `MAX_CHANGES_COUNTED`: `allPaths` is incomplete. */
  countCapped: boolean
  files: DiffFile[] | null
  /** Approximate memory (bytes) for the cache budget. */
  bytes: number
}

/** UTF-16 bytes of a string, plus a flat overhead per object. */
const approxBytes = (text: string | undefined): number => 64 + 2 * (text?.length ?? 0)

function filesBytes(files: DiffFile[]): number {
  return files.reduce(
    (sum, file) =>
      sum + approxBytes(file.patch) + approxBytes(file.path) + approxBytes(file.previousPath),
    0,
  )
}

/** At most `limit` calls of the returned runner in flight; the rest wait in order. */
export function createLimiter(limit: number): <T>(fn: () => Promise<T>) => Promise<T> {
  let active = 0
  const queue: (() => void)[] = []
  return async (fn) => {
    while (active >= limit) await new Promise<void>((resolve) => queue.push(resolve))
    active++
    try {
      return await fn()
    } finally {
      active--
      queue.shift()?.()
    }
  }
}

function asAzureRepo(repo: RepoRef): AzureRepoRef {
  if (repo.provider !== 'azure') {
    throw new ScmError('NOT_FOUND', mt('azure.notAzureRepo', { repo: repo.fullName }))
  }
  return repo
}

function parseNumericId(value: string): number {
  if (!/^[1-9][0-9]{0,9}$/.test(value)) {
    throw new ScmError('NOT_FOUND', mt('azure.unknownThread', { value: value.slice(0, 40) }))
  }
  return Number(value)
}

function fingerprint(pr: AzPullRequest): string {
  const votes = (pr.reviewers ?? [])
    .map((reviewer) => reviewer.id + ':' + reviewer.vote)
    .sort()
    .join(',')
  return [
    pr.status,
    pr.title,
    pr.isDraft === true ? 'draft' : '',
    pr.targetRefName,
    pr.lastMergeSourceCommit?.commitId ?? '',
    pr.mergeStatus ?? '',
    votes,
  ].join('|')
}

function latestIteration(iterations: AzIteration[]): AzIteration | null {
  let best: AzIteration | null = null
  for (const iteration of iterations) if (!best || iteration.id > best.id) best = iteration
  return best
}

/** Iteration id -> its source (PR head) commit, for `threadOrigin`. */
function iterationCommits(iterations: AzIteration[]): Map<number, string> {
  const commits = new Map<number, string>()
  for (const iteration of iterations) {
    const commit = iteration.sourceRefCommit?.commitId
    if (commit && COMMIT_SHA_RE.test(commit)) commits.set(iteration.id, commit.toLowerCase())
  }
  return commits
}

function matchesSearch(pr: PullRequestSummary, search: string): boolean {
  const needle = search.toLowerCase()
  const hay = [
    pr.title,
    pr.repo.fullName,
    pr.repo.name,
    pr.headRef,
    pr.baseRef,
    String(pr.number),
    '#' + pr.number,
    pr.author.login,
    pr.author.displayName ?? '',
  ]
  return hay.some((value) => value.toLowerCase().includes(needle))
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++
      out[index] = await fn(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker))
  return out
}

function keyOf(pr: AzPullRequest, organization: string): string {
  return prKey(mapRepo(pr.repository, organization), pr.pullRequestId)
}

function toStackInput(pr: AzPullRequest, organization: string): StackInputPr {
  const summary = mapPullRequestSummary(pr, organization)
  const input: StackInputPr = {
    repo: summary.repo,
    number: summary.number,
    title: summary.title,
    headRef: summary.headRef,
    baseRef: summary.baseRef,
    state: summary.state,
    isDraft: summary.isDraft,
    createdAt: summary.createdAt,
  }
  if (pr.closedDate) input.closedAt = pr.closedDate
  if (summary.state === 'merged') input.mergedInto = summary.baseRef
  return input
}

/** Clears `autoCompleteSetBy` (Azure DevOps' documented way to cancel auto-complete). */
const EMPTY_IDENTITY_ID = '00000000-0000-0000-0000-000000000000'

/**
 * A refused completion: 409 / 412 = the PR moved (head or state) since the
 * re-check, 400 = a policy or conflict refused it (Azure DevOps' own reason
 * is kept, it names the policy). 401/403/404/network keep their codes.
 */
function mapCompletionError(error: unknown): ScmError {
  if (error instanceof AzureApiError && error.status === 400) {
    // Azure DevOps' own message only: drop the "<status> [endpoint]: " prefix
    // (the path could contain any word), collapse whitespace, cap it.
    const full = error.message
    const cut = full.indexOf(']: ')
    const reason =
      (cut >= 0 ? full.slice(cut + 3) : full).replace(/\s+/g, ' ').trim().slice(0, 200) ||
      mt('azure.status.other', { status: 400 })
    const code = /conflict/i.test(reason) ? 'MERGE_CONFLICT' : 'MERGE_BLOCKED'
    return new ScmError(code, mt('azure.completeRefused', { reason }), { cause: error })
  }
  return toScmError(error)
}

export class AzureScmProvider implements ScmProvider {
  readonly id = 'azure' as const

  protected readonly client: AzureRestClient
  private readonly credentials: CredentialProvider
  private readonly getConfig: () => AzureProviderConfig
  private readonly now: () => number
  private readonly diffBudget: Partial<DiffBudget>
  private readonly tmpRoot: () => string
  private readonly filesCacheMaxBytes: number

  private readonly identities = new Map<string, Promise<Identity>>()
  private readonly activity = new Map<string, ActivityEntry>()
  /** `prKey@iteration` -> changes (+ built files), LRU. Iterations are immutable. */
  private readonly iterationFiles = new Map<string, IterationFiles>()
  private iterationBytes = 0
  private readonly changesInFlight = new Map<string, Promise<IterationFiles>>()
  private readonly filesInFlight = new Map<string, Promise<DiffFile[]>>()
  private readonly projectLists = new Map<
    string,
    { at: number; failed: boolean; promise: Promise<string[]> }
  >()
  private readonly listLimit = createLimiter(LIST_CONCURRENCY)
  private authStatus: { at: number; promise: Promise<ScmAuthStatus> } | null = null

  constructor(options: AzureScmProviderOptions) {
    this.client = options.client
    this.credentials = options.credentials
    this.getConfig = options.getConfig
    this.now = options.now ?? Date.now
    this.diffBudget = options.diffBudget ?? {}
    this.tmpRoot = options.tmpRoot ?? tmpdir
    this.filesCacheMaxBytes = options.filesCacheMaxBytes ?? FILES_CACHE_MAX_BYTES
  }

  /**
   * Drops identity, auth and activity caches (settings changed). With
   * `credentials` (default) also the credential and project-list caches (the
   * user may have re-run `az devops login`): the next call re-reads the az
   * keyring, so callers rate-limit that part (`../azure-org-access.ts`).
   */
  invalidate(options: { credentials?: boolean } = {}): void {
    this.identities.clear()
    this.activity.clear()
    this.authStatus = null
    if (options.credentials ?? true) {
      this.projectLists.clear()
      this.credentials.invalidate()
    }
  }

  // -------------------------------------------------------------------------
  // Scope and identity
  // -------------------------------------------------------------------------

  private organizations(): AzureOrganizationSettings[] {
    const config = this.getConfig()
    return config.enabled ? config.organizations : []
  }

  /**
   * Throws unless `repo` is well-formed (GUID id, no `.`/`..` segments) and
   * belongs to a configured organization AND one of its configured projects.
   */
  protected scoped(repoRef: RepoRef): AzureRepoRef {
    const repo = asAzureRepo(repoRef)
    if (!isAzureRepoRef(repo) || !AZURE_GUID_RE.test(repo.repositoryId)) {
      throw new ScmError('NOT_FOUND', mt('azure.invalidRepo', { repo: repo.fullName }))
    }
    const org = repo.organization.toLowerCase()
    const entry = this.organizations().find((item) => item.organization.toLowerCase() === org)
    if (!entry) {
      throw new ScmError(
        'FORBIDDEN',
        mt('azure.orgNotConfigured', { organization: repo.organization }),
      )
    }
    const project = repo.project.toLowerCase()
    if (!entry.projects.some((name) => name.toLowerCase() === project)) {
      throw new ScmError(
        'FORBIDDEN',
        mt('azure.projectNotConfigured', {
          project: repo.project,
          organization: repo.organization,
        }),
      )
    }
    return repo
  }

  private identity(org: string): Promise<Identity> {
    const key = org.toLowerCase()
    const cached = this.identities.get(key)
    if (cached) return cached
    const promise = this.client
      .json<AzConnectionData>(org, orgApiUrl(org, '_apis', 'connectionData'), {
        apiVersion: '7.1-preview',
      })
      .then((data) => {
        const user = data.authenticatedUser
        const email = user.properties?.Account?.$value
        return {
          id: user.id,
          login: email || user.providerDisplayName || user.id,
          displayName: user.providerDisplayName || email || user.id,
        }
      })
    promise.catch(() => this.identities.delete(key))
    this.identities.set(key, promise)
    return promise
  }

  async getAuthStatus(): Promise<ScmAuthStatus> {
    const cached = this.authStatus
    if (cached && this.now() - cached.at < AUTH_STATUS_TTL_MS) return cached.promise
    const promise = this.computeAuthStatus()
    this.authStatus = { at: this.now(), promise }
    return promise
  }

  private async computeAuthStatus(): Promise<ScmAuthStatus> {
    const config = this.getConfig()
    if (!config.enabled) {
      return { provider: 'azure', state: 'disabled', detail: mt('azure.turnedOff') }
    }
    const first = config.organizations[0]
    if (!first) {
      return {
        provider: 'azure',
        state: 'disabled',
        detail: mt('azure.noOrganization'),
      }
    }
    const org = first.organization
    const loginCommand = 'az devops login --organization ' + organizationUrl(org)
    let source: AzureCredentialKind
    try {
      source = (await this.credentials.getAuthHeader(org)).source
      const me = await this.identity(org)
      return {
        provider: 'azure',
        state: 'signed_in',
        user: { login: me.login, displayName: me.displayName },
        credentialSource: source,
      }
    } catch (error) {
      const scmError = toScmError(error)
      if (scmError.code === 'CLI_UNAVAILABLE') {
        return { provider: 'azure', state: 'cli_unavailable', detail: scmError.message }
      }
      const detail =
        scmError.code === 'UNAUTHENTICATED' && !scmError.message.includes('az devops login')
          ? mt('azure.unauthenticatedDetail', { message: scmError.message, command: loginCommand })
          : scmError.message
      return { provider: 'azure', state: 'cli_unauthenticated', detail }
    }
  }

  /**
   * Project names of `organization`, for the Settings picker. NOT scoped to
   * the configured orgs on purpose (the user is configuring one): the IPC
   * handler gates the org first (`../azure-org-access.ts`), and the client
   * only ever sends that org's own credential to that org's URLs. Cached per
   * org (`PROJECTS_TTL_MS`, failures `PROJECTS_FAILURE_TTL_MS`).
   */
  listProjects(organization: string): Promise<string[]> {
    const key = organization.toLowerCase()
    const hit = this.projectLists.get(key)
    const at = this.now()
    if (hit && at - hit.at < (hit.failed ? PROJECTS_FAILURE_TTL_MS : PROJECTS_TTL_MS)) {
      return hit.promise
    }
    const promise = this.client
      .listContinuation<{ name: string; state?: string }>(
        organization,
        orgApiUrl(organization, '_apis', 'projects'),
        { query: { $top: 500, stateFilter: 'wellFormed' }, maxItems: 2000 },
      )
      .then((projects) =>
        projects
          .map((project) => project.name)
          .filter((name) => typeof name === 'string' && name.length > 0)
          .sort((a, b) => a.localeCompare(b)),
      )
    const entry = { at, failed: false, promise }
    promise.catch(() => {
      entry.failed = true
    })
    this.projectLists.delete(key)
    this.projectLists.set(key, entry)
    while (this.projectLists.size > MAX_PROJECT_LISTS) {
      const oldest = this.projectLists.keys().next().value
      if (oldest === undefined) break
      this.projectLists.delete(oldest)
    }
    return promise
  }

  // -------------------------------------------------------------------------
  // Listing
  // -------------------------------------------------------------------------

  async listPullRequests(q: ListPullRequestsQuery): Promise<PullRequestSummary[]> {
    const orgs = this.organizations()
    if (orgs.length === 0) return []
    // Orgs in parallel; their requests share `listLimit`.
    const settled = await Promise.allSettled(orgs.map((org) => this.listForOrg(org, q)))
    const fulfilled = settled.filter(
      (outcome): outcome is PromiseFulfilledResult<PullRequestSummary[]> =>
        outcome.status === 'fulfilled',
    )
    if (fulfilled.length === 0) {
      throw toScmError((settled[0] as PromiseRejectedResult).reason)
    }
    for (const outcome of settled) {
      if (outcome.status === 'rejected') {
        console.warn('[azure] one organization failed to list:', toScmError(outcome.reason).message)
      }
    }
    const items = fulfilled.flatMap((outcome) => outcome.value)
    const search = q.search?.trim()
    const filtered = search ? items.filter((pr) => matchesSearch(pr, search)) : items
    return filtered.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.number - a.number)
  }

  private async listForOrg(
    entry: AzureOrganizationSettings,
    q: ListPullRequestsQuery,
  ): Promise<PullRequestSummary[]> {
    const org = entry.organization
    const me = await this.identity(org)
    const state = q.state ?? 'open'
    const statuses: [string, number][] =
      state === 'open'
        ? [['active', LIST_TOP_ACTIVE]]
        : state === 'closed'
          ? [
              ['completed', LIST_TOP_COMPLETED],
              ['abandoned', LIST_TOP_ABANDONED],
            ]
          : [
              ['active', LIST_TOP_ACTIVE],
              ['completed', LIST_TOP_COMPLETED],
              ['abandoned', LIST_TOP_ABANDONED],
            ]
    const queries: Promise<AzPullRequest[]>[] = []
    for (const project of entry.projects) {
      for (const role of ['creatorId', 'reviewerId']) {
        for (const [status, top] of statuses) {
          queries.push(
            this.listLimit(() =>
              this.client.json<AzListResponse<AzPullRequest>>(
                org,
                orgApiUrl(org, project, '_apis', 'git', 'pullrequests'),
                {
                  query: {
                    'searchCriteria.status': status,
                    ['searchCriteria.' + role]: me.id,
                    $top: top,
                  },
                },
              ),
            ).then((data) => data.value ?? []),
          )
        }
      }
    }
    const byKey = new Map<string, AzPullRequest>()
    for (const list of await Promise.all(queries)) {
      for (const pr of list) {
        byKey.set(keyOf(pr, org), pr)
      }
    }
    const prs = [...byKey.values()]
    await this.observeActivity(org, prs)
    return prs.map((pr) => this.summarize(pr, org, me.id))
  }

  /** Summary with the derived `updatedAt` (see the file header) and the viewer relation. */
  private summarize(pr: AzPullRequest, org: string, viewerId: string | null): PullRequestSummary {
    const entry = this.activity.get(keyOf(pr, org))
    return mapPullRequestSummary(pr, org, [entry?.iterationDate, entry?.changedAt], viewerId)
  }

  /** Updates the activity tracker; fetches the last push date of open PRs whose head is new to us. */
  private async observeActivity(org: string, prs: AzPullRequest[]): Promise<void> {
    const nowIso = new Date(this.now()).toISOString()
    const needIteration: { key: string; pr: AzPullRequest; head: string }[] = []
    for (const pr of prs) {
      const key = keyOf(pr, org)
      const print = fingerprint(pr)
      const head = pr.lastMergeSourceCommit?.commitId ?? ''
      let entry = this.activity.get(key)
      if (!entry) {
        entry = {
          fingerprint: print,
          changedAt: null,
          iterationDate: null,
          iterationHead: null,
          failedHead: null,
          retryAt: 0,
        }
      } else if (entry.fingerprint !== print) {
        entry.fingerprint = print
        entry.changedAt = nowIso
      }
      // Re-insert: Map order is the LRU order the cap below trims.
      this.activity.delete(key)
      this.activity.set(key, entry)
      const failedRecently = entry.failedHead === head && this.now() < entry.retryAt
      if (pr.status === 'active' && head && entry.iterationHead !== head && !failedRecently) {
        needIteration.push({ key, pr, head })
      }
    }
    while (this.activity.size > MAX_ACTIVITY_ENTRIES) {
      const oldest = this.activity.keys().next().value
      if (oldest === undefined) break
      this.activity.delete(oldest)
    }
    await mapWithConcurrency(needIteration, ITERATION_LOOKUP_CONCURRENCY, async (item) => {
      try {
        const repo = mapRepo(item.pr.repository, org)
        const iterations = await this.iterations(repo, item.pr.pullRequestId)
        const entry = this.activity.get(item.key)
        if (entry) {
          entry.iterationHead = item.head
          entry.iterationDate =
            latestDate(iterations.map((iteration) => iteration.createdDate)) || null
          entry.failedHead = null
        }
      } catch (error) {
        // Best-effort: without it, `updatedAt` falls back to the other dates.
        // Negative cache per head commit, so a 403/404 isn't retried every poll.
        const entry = this.activity.get(item.key)
        if (entry) {
          const code = toScmError(error).code
          entry.failedHead = item.head
          entry.retryAt =
            code === 'FORBIDDEN' || code === 'NOT_FOUND'
              ? Number.POSITIVE_INFINITY
              : this.now() + ITERATION_RETRY_MS
        }
      }
    })
  }

  // -------------------------------------------------------------------------
  // Detail, files, threads
  // -------------------------------------------------------------------------

  private repoUrl(repo: AzureRepoRef, ...segments: (string | number)[]): string {
    return gitRepoUrl(repo.organization, repo.project, repo.repositoryId, ...segments)
  }

  private async rawPullRequest(repo: AzureRepoRef, number: number): Promise<AzPullRequest> {
    return this.client.json<AzPullRequest>(
      repo.organization,
      this.repoUrl(repo, 'pullrequests', number),
    )
  }

  private async iterations(repo: AzureRepoRef, number: number): Promise<AzIteration[]> {
    const data = await this.client.json<AzListResponse<AzIteration>>(
      repo.organization,
      this.repoUrl(repo, 'pullRequests', number, 'iterations'),
    )
    return data.value ?? []
  }

  private async requireLatestIteration(repo: AzureRepoRef, number: number): Promise<AzIteration> {
    const latest = latestIteration(await this.iterations(repo, number))
    if (!latest) {
      throw new ScmError('NOT_FOUND', mt('azure.noIterations', { number }))
    }
    return latest
  }

  async getPullRequestDetail(repoRef: RepoRef, number: number): Promise<PullRequestDetail> {
    const repo = this.scoped(repoRef)
    const org = repo.organization
    const pr = await this.rawPullRequest(repo, number)
    const projectId = pr.repository.project.id
    const [{ iterations, changes }, statuses, evaluations, workItems, commits] = await Promise.all([
      // The changes give the true file count (cheap: counted, not diffed; cached).
      this.iterations(repo, number)
        .catch(() => [] as AzIteration[])
        .then(async (list) => {
          const last = latestIteration(list)
          const counted = last
            ? await this.iterationChanges(repo, number, last.id).catch(() => null)
            : null
          return { iterations: list, changes: counted }
        }),
      this.client
        .json<AzListResponse<AzPullRequestStatusEntry>>(
          org,
          this.repoUrl(repo, 'pullRequests', number, 'statuses'),
        )
        .then((data) => data.value ?? [])
        .catch(() => [] as AzPullRequestStatusEntry[]),
      this.policyEvaluations(repo, projectId, number).catch(() => [] as AzPolicyEvaluation[]),
      this.workItems(repo, number).catch(() => [] as PrWorkItem[]),
      this.client
        .listContinuation<unknown>(org, this.repoUrl(repo, 'pullRequests', number, 'commits'), {
          query: { $top: MAX_COMMITS_COUNTED },
          maxItems: MAX_COMMITS_COUNTED,
        })
        .then((list) => list.length)
        .catch(() => 0),
    ])

    const latest = latestIteration(iterations)
    const key = prKey(repo, number)
    const entry = this.activity.get(key)
    const summary = mapPullRequestSummary(pr, org, [
      latest?.createdDate,
      entry?.changedAt,
      entry?.iterationDate,
    ])
    const detail: PullRequestDetail = {
      ...summary,
      ciStatus: mapCiStatus(statuses, evaluations),
      bodyMarkdown: pr.description ?? '',
      labels: (pr.labels ?? [])
        .filter((label) => label.active !== false)
        .map((label) => ({ name: label.name })),
      reviewers: (pr.reviewers ?? []).map(mapReviewer),
      commits,
      workItems,
      checks: mapChecks(statuses, evaluations),
    }
    // Only for open PRs: a completed PR's last merge status is history, not a warning.
    const mergeStatus = summary.state === 'open' ? mapMergeStatus(pr.mergeStatus) : undefined
    if (mergeStatus) detail.mergeStatus = mergeStatus
    const autoComplete = mapAutoComplete(pr)
    if (autoComplete) detail.autoComplete = autoComplete
    if (changes) {
      detail.changedFiles = changes.total
      if (changes.truncated) detail.filesTruncated = true
      // Line totals only when every file was diffed (a partial sum would lie).
      if (changes.files && !changes.truncated) {
        detail.additions = changes.files.reduce((sum, file) => sum + file.additions, 0)
        detail.deletions = changes.files.reduce((sum, file) => sum + file.deletions, 0)
      }
    }
    return detail
  }

  private async policyEvaluations(
    repo: AzureRepoRef,
    projectId: string,
    number: number,
  ): Promise<AzPolicyEvaluation[]> {
    const org = repo.organization
    const data = await this.client.json<AzListResponse<AzPolicyEvaluation>>(
      org,
      orgApiUrl(org, repo.project, '_apis', 'policy', 'evaluations'),
      {
        query: { artifactId: 'vstfs:///CodeReview/CodeReviewId/' + projectId + '/' + number },
        apiVersion: POLICY_API_VERSION,
      },
    )
    return data.value ?? []
  }

  private async workItemRefs(repo: AzureRepoRef, number: number): Promise<{ id: string | number }[]> {
    const refs = await this.client.json<AzListResponse<{ id: string | number }>>(
      repo.organization,
      this.repoUrl(repo, 'pullRequests', number, 'workitems'),
    )
    return refs.value ?? []
  }

  private async workItems(repo: AzureRepoRef, number: number): Promise<PrWorkItem[]> {
    const org = repo.organization
    const ids = (await this.workItemRefs(repo, number))
      .map((ref) => String(ref.id))
      .filter((id) => /^[0-9]{1,10}$/.test(id))
      .slice(0, MAX_WORK_ITEMS)
    if (ids.length === 0) return []
    const items = await this.client.json<
      AzListResponse<{ id: number; fields?: Record<string, unknown> }>
    >(org, orgApiUrl(org, '_apis', 'wit', 'workitems'), {
      query: {
        ids: ids.join(','),
        fields: 'System.Title,System.WorkItemType,System.State,System.TeamProject',
        errorPolicy: 'omit',
      },
    })
    return (items.value ?? [])
      .filter((item) => item && typeof item.id === 'number')
      .map((item) => {
        const fields = item.fields ?? {}
        const text = (name: string): string | undefined =>
          typeof fields[name] === 'string' ? (fields[name] as string) : undefined
        const project = text('System.TeamProject') ?? repo.project
        const workItem: PrWorkItem = {
          id: String(item.id),
          title: text('System.Title') ?? 'Work item ' + item.id,
          url: orgApiUrl(org, project, '_workitems', 'edit', item.id),
        }
        const type = text('System.WorkItemType')
        const state = text('System.State')
        if (type) workItem.type = type
        if (state) workItem.state = state
        return workItem
      })
  }

  private cacheGet(key: string): IterationFiles | undefined {
    const hit = this.iterationFiles.get(key)
    if (hit) {
      this.iterationFiles.delete(key)
      this.iterationFiles.set(key, hit)
    }
    return hit
  }

  /** (Re)inserts `value` as the newest entry, then trims by count and bytes (never the newest). */
  private cachePut(key: string, value: IterationFiles): void {
    const previous = this.iterationFiles.get(key)
    if (previous) {
      this.iterationBytes -= previous.bytes
      this.iterationFiles.delete(key)
    }
    this.iterationFiles.set(key, value)
    this.iterationBytes += value.bytes
    while (
      this.iterationFiles.size > 1 &&
      (this.iterationFiles.size > FILES_CACHE_SIZE || this.iterationBytes > this.filesCacheMaxBytes)
    ) {
      const oldest = this.iterationFiles.keys().next().value
      if (oldest === undefined || oldest === key) break
      this.iterationBytes -= this.iterationFiles.get(oldest)?.bytes ?? 0
      this.iterationFiles.delete(oldest)
    }
  }

  /** Entries and bytes held by the iteration cache (for tests). */
  iterationCacheStats(): { entries: number; bytes: number } {
    return { entries: this.iterationFiles.size, bytes: this.iterationBytes }
  }

  /**
   * Changes of `iteration` vs. the merge base (`$compareTo=0`), folders
   * dropped: the first `maxFiles` kept, the rest only counted. Single-flight.
   */
  private iterationChanges(
    repo: AzureRepoRef,
    number: number,
    iteration: number,
  ): Promise<IterationFiles> {
    const cacheKey = prKey(repo, number) + '@' + iteration
    const cached = this.cacheGet(cacheKey)
    if (cached) return Promise.resolve(cached)
    const pending = this.changesInFlight.get(cacheKey)
    if (pending) return pending
    const promise = this.fetchIterationChanges(repo, number, iteration)
      .then((result) => {
        this.cachePut(cacheKey, result)
        return result
      })
      .finally(() => this.changesInFlight.delete(cacheKey))
    this.changesInFlight.set(cacheKey, promise)
    return promise
  }

  private async fetchIterationChanges(
    repo: AzureRepoRef,
    number: number,
    iteration: number,
  ): Promise<IterationFiles> {
    const maxFiles = this.diffBudget.maxFiles ?? DEFAULT_DIFF_BUDGET.maxFiles
    const changes: AzureChange[] = []
    const allPaths = new Set<string>()
    let total = 0
    let bytes = 0
    let more = false
    let skip = 0
    for (let page = 0; page < MAX_CHANGE_PAGES; page++) {
      const data = await this.client.json<AzIterationChanges>(
        repo.organization,
        this.repoUrl(repo, 'pullRequests', number, 'iterations', iteration, 'changes'),
        { query: { $compareTo: 0, $top: CHANGES_PAGE, $skip: skip } },
      )
      for (const entry of data.changeEntries ?? []) {
        const change = mapChangeEntry(entry)
        if (!change) continue
        if (total >= MAX_CHANGES_COUNTED) {
          more = true
          break
        }
        total++
        allPaths.add(change.path)
        bytes += approxBytes(change.path)
        if (changes.length < maxFiles) changes.push(change)
      }
      more = more || Boolean(data.nextSkip && data.nextSkip > skip)
      if (!data.nextSkip || data.nextSkip <= skip || total >= MAX_CHANGES_COUNTED) break
      skip = data.nextSkip
    }
    const countCapped = more && total >= MAX_CHANGES_COUNTED
    return {
      changes,
      allPaths,
      total,
      truncated: total > changes.length || countCapped,
      countCapped,
      files: null,
      bytes,
    }
  }

  /** Paths to judge "file left the PR" by; `null` when the count was capped (unknown). */
  private static knownPaths(
    iteration: IterationFiles | null | undefined,
  ): ReadonlySet<string> | null {
    return iteration && !iteration.countCapped ? iteration.allPaths : null
  }

  async getPullRequestFiles(repoRef: RepoRef, number: number): Promise<DiffFile[]> {
    const repo = this.scoped(repoRef)
    const latest = await this.requireLatestIteration(repo, number)
    const cacheKey = prKey(repo, number) + '@' + latest.id
    const iteration = await this.iterationChanges(repo, number, latest.id)
    if (iteration.files) return iteration.files
    const pending = this.filesInFlight.get(cacheKey)
    if (pending) return pending
    const promise = buildDiffFiles(
      iteration.changes,
      (objectId, maxBytes) =>
        this.client.binary(repo.organization, this.repoUrl(repo, 'blobs', objectId), {
          query: { $format: 'octetstream' },
          maxBytes,
        }),
      this.diffBudget,
    )
      .then((files) => {
        iteration.files = files
        // Re-put (also if it was evicted meanwhile) so the bytes are counted.
        this.cachePut(cacheKey, { ...iteration, bytes: iteration.bytes + filesBytes(files) })
        return files
      })
      .finally(() => this.filesInFlight.delete(cacheKey))
    this.filesInFlight.set(cacheKey, promise)
    return promise
  }

  private async threadsAt(
    repo: AzureRepoRef,
    number: number,
    iteration: number,
  ): Promise<AzThread[]> {
    const data = await this.client.json<AzListResponse<AzThread>>(
      repo.organization,
      this.repoUrl(repo, 'pullRequests', number, 'threads'),
      { query: { $iteration: iteration, $baseIteration: 0 } },
    )
    return data.value ?? []
  }

  private finishThread(
    thread: AzThread,
    repo: AzureRepoRef,
    number: number,
    iterations: AzIteration[],
    paths: ReadonlySet<string> | null,
    viewerId: string | null = null,
  ): CommentThread | null {
    const mapped = mapThread(thread, repo, number, viewerId)
    if (!mapped) return null
    const latest = latestIteration(iterations)?.id ?? null
    if (isThreadOutdated(mapped, threadAnchor(thread), latest, paths)) mapped.isOutdated = true
    const origin = threadOrigin(thread, mapped, iterationCommits(iterations), latest)
    if (origin) mapped.origin = origin
    return mapped
  }

  async getCommentThreads(repoRef: RepoRef, number: number): Promise<CommentThread[]> {
    const repo = this.scoped(repoRef)
    const iterations = await this.iterations(repo, number)
    const latest = latestIteration(iterations)
    if (!latest) throw new ScmError('NOT_FOUND', mt('azure.noIterations', { number }))
    const [threads, iteration, me] = await Promise.all([
      this.threadsAt(repo, number, latest.id),
      this.iterationChanges(repo, number, latest.id).catch(() => null),
      // Only marks the user's own comments (`isViewer`): never fails the read.
      this.identity(repo.organization).catch(() => null),
    ])
    const paths = AzureScmProvider.knownPaths(iteration)
    return threads
      .map((thread) => this.finishThread(thread, repo, number, iterations, paths, me?.id))
      .filter((thread): thread is CommentThread => thread !== null)
  }

  // -------------------------------------------------------------------------
  // Writes (explicit user actions only)
  // -------------------------------------------------------------------------

  async postComment(req: PostCommentRequest): Promise<PrComment> {
    const repo = this.scoped(req.repo)
    const org = repo.organization
    const comment = { content: req.bodyMarkdown, commentType: 1 as const }

    if (req.threadId) {
      const threadId = parseNumericId(req.threadId)
      const thread = await this.client.json<AzThread>(
        org,
        this.repoUrl(repo, 'pullRequests', req.number, 'threads', threadId),
      )
      const root =
        thread.comments.find((c) => c.parentCommentId === 0 && c.isDeleted !== true) ??
        thread.comments[0]
      const created = await this.client.json<AzComment>(
        org,
        this.repoUrl(repo, 'pullRequests', req.number, 'threads', threadId, 'comments'),
        { method: 'POST', body: { ...comment, parentCommentId: root?.id ?? 0 } },
      )
      return { ...mapComment(created, threadId, repo, req.number), isViewer: true }
    }

    const body: Record<string, unknown> = {
      comments: [{ ...comment, parentCommentId: 0 }],
      status: 1,
    }
    if (req.path && req.line !== undefined) {
      const latest = await this.requireLatestIteration(repo, req.number)
      const iteration = await this.iterationChanges(repo, req.number, latest.id)
      const path = toRepoPath(req.path)
      const change = iteration.changes.find((entry) => entry.path === path)
      if (!change) {
        const pastCap = iteration.allPaths.has(path) || iteration.countCapped
        throw new ScmError(
          'NOT_FOUND',
          pastCap
            ? mt(iteration.countCapped ? 'azure.commentCappedAtLeast' : 'azure.commentCapped', {
                path,
                total: iteration.total,
                loaded: iteration.changes.length,
              })
            : mt('azure.commentNotInIteration', { path }),
        )
      }
      const position = { line: req.line, offset: 1 }
      body.threadContext =
        req.side === 'LEFT'
          ? { filePath: toAzurePath(path), leftFileStart: position, leftFileEnd: position }
          : { filePath: toAzurePath(path), rightFileStart: position, rightFileEnd: position }
      body.pullRequestThreadContext = {
        changeTrackingId: change.changeTrackingId,
        iterationContext: { firstComparingIteration: 1, secondComparingIteration: latest.id },
      }
    }
    const created = await this.client.json<AzThread>(
      org,
      this.repoUrl(repo, 'pullRequests', req.number, 'threads'),
      { method: 'POST', body },
    )
    const first = created.comments[0]
    if (!first) throw new ScmError('UNKNOWN', mt('azure.threadWithoutComments'))
    return { ...mapComment(first, created.id, repo, req.number), isViewer: true }
  }

  async setThreadStatus(req: SetThreadStatusRequest): Promise<CommentThread> {
    const repo = this.scoped(req.repo)
    const threadId = parseNumericId(req.threadId)
    const url = this.repoUrl(repo, 'pullRequests', req.number, 'threads', threadId)
    await this.client.json<AzThread>(repo.organization, url, {
      method: 'PATCH',
      body: { status: threadStatusToAzure(req.status) },
    })
    const iterations = await this.iterations(repo, req.number)
    const latest = latestIteration(iterations)
    const thread = await this.client.json<AzThread>(repo.organization, url, {
      query: latest ? { $iteration: latest.id, $baseIteration: 0 } : undefined,
    })
    const cached = latest
      ? this.iterationFiles.get(prKey(repo, req.number) + '@' + latest.id)
      : undefined
    const paths = AzureScmProvider.knownPaths(cached)
    const mapped = this.finishThread(thread, repo, req.number, iterations, paths)
    if (!mapped) throw new ScmError('NOT_FOUND', mt('scm.threadNotFound', { id: req.threadId }))
    return mapped
  }

  /**
   * `req.commit` (a thread origin) must be the source commit of one of this
   * PR's iterations: the only commits `threadOrigin` reports, so a forged one
   * never reaches the items API. A file missing at that version is a
   * one-sentence `NOT_FOUND` (Azure's own text, TF401174 + URL, stays out).
   */
  async getFileContent(req: FileContentRequest): Promise<FileContent> {
    const repo = this.scoped(req.repo)
    const iterations = await this.iterations(repo, req.number)
    const latest = latestIteration(iterations)
    if (!latest) throw new ScmError('NOT_FOUND', mt('azure.noIterations', { number: req.number }))
    if (req.commit !== undefined) {
      const wanted = req.commit.toLowerCase()
      if (![...iterationCommits(iterations).values()].includes(wanted)) {
        throw new ScmError('NOT_FOUND', mt('scm.commitNotInPr'))
      }
    }
    const commit =
      req.side === 'head'
        ? (req.commit ?? latest.sourceRefCommit?.commitId)
        : (latest.commonRefCommit?.commitId ?? latest.targetRefCommit?.commitId)
    if (!commit || !COMMIT_SHA_RE.test(commit)) {
      throw new ScmError(
        'NOT_FOUND',
        mt(req.side === 'head' ? 'azure.headCommitMissing' : 'azure.baseCommitMissing'),
      )
    }
    let bytes: Uint8Array
    try {
      bytes = await this.client.binary(repo.organization, this.repoUrl(repo, 'items'), {
        query: {
          path: toAzurePath(req.path),
          'versionDescriptor.version': commit,
          'versionDescriptor.versionType': 'commit',
          $format: 'octetstream',
          download: 'true',
        },
        maxBytes: MAX_FILE_CONTENT_BYTES,
      })
    } catch (error) {
      if (error instanceof AzureTooLargeError) {
        return { content: null, isBinary: false, tooLarge: true }
      }
      if (toScmError(error).code === 'NOT_FOUND') {
        throw new ScmError('NOT_FOUND', mt('scm.fileNotAtVersion', { path: req.path }))
      }
      throw error
    }
    if (looksBinary(bytes)) return { content: null, isBinary: true, tooLarge: false }
    return { content: new TextDecoder('utf-8').decode(bytes), isBinary: false, tooLarge: false }
  }

  async branchExists(repoRef: RepoRef, branch: string): Promise<boolean> {
    const repo = this.scoped(repoRef)
    const name = 'refs/heads/' + shortRef(branch)
    // `filter` is a PREFIX match (`heads/feature` also returns `heads/feature-2`).
    const refs = await this.client.listContinuation<AzGitRef>(
      repo.organization,
      this.repoUrl(repo, 'refs'),
      { query: { filter: 'heads/' + shortRef(branch) }, maxItems: 1000 },
    )
    return refs.some((ref) => ref.name === name)
  }

  async updatePullRequestBase(
    repoRef: RepoRef,
    number: number,
    newBase: string,
  ): Promise<PullRequestSummary> {
    const repo = this.scoped(repoRef)
    const updated = await this.client.json<AzPullRequest>(
      repo.organization,
      this.repoUrl(repo, 'pullrequests', number),
      { method: 'PATCH', body: { targetRefName: 'refs/heads/' + shortRef(newBase) } },
    )
    const me = await this.identity(repo.organization).catch(() => null)
    return this.summarize(updated, repo.organization, me?.id ?? null)
  }

  // -------------------------------------------------------------------------
  // Completion / auto-complete (validated and confirmed in `../merge.ts`)
  // -------------------------------------------------------------------------

  async getMergeOptions(repoRef: RepoRef, number: number): Promise<MergeOptions> {
    const repo = this.scoped(repoRef)
    const pr = await this.rawPullRequest(repo, number)
    const [evaluations, workItems] = await Promise.all([
      // Unreadable policies must not look like "nothing blocks it": the
      // server still enforces them, so this read failing fails the options.
      this.policyEvaluations(repo, pr.repository.project.id, number),
      this.workItemRefs(repo, number)
        .then((refs) => refs.length)
        .catch(() => 0),
    ])
    return mapAzureMergeOptions(pr, evaluations, workItems)
  }

  /**
   * `PATCH …/pullrequests/{id}` with `status: completed`. Azure DevOps refuses
   * it when `lastMergeSourceCommit` is no longer the head, so a push between
   * the re-check and this call can't merge unseen commits. Completion may
   * finish asynchronously (`completed: false` while the PR is still active).
   */
  async mergePullRequest(req: MergeWrite): Promise<MergeWriteResult> {
    const repo = this.scoped(req.repo)
    try {
      const updated = await this.client.json<AzPullRequest>(
        repo.organization,
        this.repoUrl(repo, 'pullrequests', req.number),
        {
          method: 'PATCH',
          body: {
            status: 'completed',
            lastMergeSourceCommit: { commitId: req.headSha },
            completionOptions: {
              mergeStrategy: azureMergeStrategy(req.strategy),
              deleteSourceBranch: req.deleteSourceBranch,
              transitionWorkItems: req.transitionWorkItems,
              bypassPolicy: false,
            },
          },
        },
      )
      return { completed: updated.status === 'completed' }
    } catch (error) {
      throw mapCompletionError(error)
    }
  }

  /**
   * Auto-complete on = `autoCompleteSetBy` (the signed-in identity) plus the
   * completion options; off = the empty identity, which clears it.
   */
  async setAutoMerge(req: AutoMergeWrite): Promise<void> {
    const repo = this.scoped(req.repo)
    let body: Record<string, unknown>
    if (req.enable) {
      const me = await this.identity(repo.organization)
      body = {
        autoCompleteSetBy: { id: me.id },
        completionOptions: {
          mergeStrategy: azureMergeStrategy(req.strategy),
          deleteSourceBranch: req.deleteSourceBranch,
          transitionWorkItems: req.transitionWorkItems,
          bypassPolicy: false,
        },
      }
    } else {
      body = { autoCompleteSetBy: { id: EMPTY_IDENTITY_ID } }
    }
    try {
      await this.client.json<AzPullRequest>(
        repo.organization,
        this.repoUrl(repo, 'pullrequests', req.number),
        { method: 'PATCH', body },
      )
    } catch (error) {
      throw mapCompletionError(error)
    }
  }

  // -------------------------------------------------------------------------
  // Stacks
  // -------------------------------------------------------------------------

  /**
   * Every active PR of every configured project (capped per project at
   * `STACK_CANDIDATES_MAX`), as full summaries. Orgs in sequence; a failing
   * org fails the listing (the caller reports it per provider).
   */
  async listScopePullRequests(): Promise<ScopePullRequest[]> {
    const out: ScopePullRequest[] = []
    for (const entry of this.organizations()) {
      // Best-effort: without the identity, summaries just carry no `viewer`.
      const me = await this.identity(entry.organization).catch(() => null)
      const lists = await Promise.all(
        entry.projects.map((project) =>
          this.listLimit(() =>
            this.client.listTopSkip<AzPullRequest>(
              entry.organization,
              orgApiUrl(entry.organization, project, '_apis', 'git', 'pullrequests'),
              {
                query: { 'searchCriteria.status': 'active' },
                pageSize: 500,
                maxItems: STACK_CANDIDATES_MAX,
              },
            ),
          ),
        ),
      )
      for (const pr of lists.flat()) {
        out.push({ summary: this.summarize(pr, entry.organization, me?.id ?? null) })
      }
    }
    return out
  }

  async listMergedBySourceBranch(repoRef: RepoRef, branch: string): Promise<StackInputPr[]> {
    const repo = this.scoped(repoRef)
    const data = await this.client.json<AzListResponse<AzPullRequest>>(
      repo.organization,
      this.repoUrl(repo, 'pullrequests'),
      {
        query: {
          'searchCriteria.status': 'completed',
          'searchCriteria.sourceRefName': 'refs/heads/' + shortRef(branch),
          $top: 20,
        },
      },
    )
    return (data.value ?? [])
      .filter((pr) => pr.status === 'completed')
      .map((pr) => toStackInput(pr, repo.organization))
  }

  // -------------------------------------------------------------------------
  // Snapshot
  // -------------------------------------------------------------------------

  /**
   * Repo zip at `headSha` -> a unique temp file -> `extractZipSafely` into
   * `destDir` (snapshot-store's own temp dir). On any failure this throws and
   * snapshot-store deletes `destDir`, so a partial extraction is never reused.
   */
  async writeSnapshot(req: SnapshotRequest, destDir: string): Promise<void> {
    const repo = this.scoped(req.repo)
    if (!COMMIT_SHA_RE.test(req.headSha)) {
      throw new ScmError('NOT_FOUND', mt('azure.notCommitId', { value: req.headSha.slice(0, 40) }))
    }
    const workDir = await mkdtemp(join(this.tmpRoot(), 'minerva-azure-zip-'))
    try {
      const zipPath = join(workDir, randomUUID() + '.zip')
      await this.client.download(repo.organization, this.repoUrl(repo, 'items'), zipPath, {
        query: {
          path: '/',
          $format: 'zip',
          download: 'true',
          'versionDescriptor.version': req.headSha,
          'versionDescriptor.versionType': 'commit',
        },
        maxBytes: MAX_ZIP_BYTES,
      })
      try {
        await extractZipSafely(zipPath, destDir)
      } catch (error) {
        if (error instanceof ZipExtractError) {
          throw new ScmError('UNKNOWN', error.message + ' ' + mt('scm.noAgenticAnalysis'))
        }
        throw error
      }
    } finally {
      await rm(workDir, { recursive: true, force: true })
    }
  }
}
