/**
 * The Azure DevOps `ScmProvider`, on top of the REST client (`./client.ts`),
 * the `az` credential bridge (`./credentials.ts`) and the pure mappers.
 *
 * Scope: the organizations + projects saved in Settings (`scm.azure`, see
 * `../scm-settings.ts`). Every per-repo call checks that the repo's
 * organization is one of them, so a forged `RepoRef` can't make main look up
 * (and send) a credential for an organization the user never configured.
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
 * per PR on every poll).
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
  PostCommentRequest,
  PrComment,
  PrWorkItem,
  PullRequestDetail,
  PullRequestSummary,
  SetThreadStatusRequest,
} from '../../../shared/types'
import { ScmError, toScmError } from '../errors'
import type { ListPullRequestsQuery, ScmProvider, SnapshotRequest } from '../provider'
import type { StackInputPr } from '../stacks'
import type {
  AzChangeEntry,
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
import {
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
  mapCiStatus,
  mapComment,
  mapPullRequestSummary,
  mapRepo,
  mapReviewer,
  mapThread,
  threadAnchor,
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
}

/** Open PRs per role query; the active list of a whole project was ~120 in the real org. */
const LIST_TOP_ACTIVE = 500
const LIST_TOP_COMPLETED = 100
const LIST_TOP_ABANDONED = 50
const STACK_CANDIDATES_MAX = 2000
const CHANGES_PAGE = 2000
const FILES_CACHE_SIZE = 20
const AUTH_STATUS_TTL_MS = 10_000
const ITERATION_LOOKUP_CONCURRENCY = 4
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
}

interface IterationFiles {
  changes: AzureChange[]
  files: DiffFile[] | null
}

function asAzureRepo(repo: RepoRef): AzureRepoRef {
  if (repo.provider !== 'azure') {
    throw new ScmError('NOT_FOUND', 'Not an Azure DevOps repository: ' + repo.fullName)
  }
  return repo
}

function parseNumericId(value: string, label: string): number {
  if (!/^[1-9][0-9]{0,9}$/.test(value)) {
    throw new ScmError('NOT_FOUND', 'Unknown ' + label + ': ' + value.slice(0, 40))
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

export class AzureScmProvider implements ScmProvider {
  readonly id = 'azure' as const

  protected readonly client: AzureRestClient
  private readonly credentials: CredentialProvider
  private readonly getConfig: () => AzureProviderConfig
  private readonly now: () => number
  private readonly diffBudget: Partial<DiffBudget>
  private readonly tmpRoot: () => string

  private readonly identities = new Map<string, Promise<Identity>>()
  private readonly activity = new Map<string, ActivityEntry>()
  /** `prKey@iteration` -> changes (+ built files). Iterations are immutable. */
  private readonly iterationFiles = new Map<string, IterationFiles>()
  private authStatus: { at: number; promise: Promise<ScmAuthStatus> } | null = null

  constructor(options: AzureScmProviderOptions) {
    this.client = options.client
    this.credentials = options.credentials
    this.getConfig = options.getConfig
    this.now = options.now ?? Date.now
    this.diffBudget = options.diffBudget ?? {}
    this.tmpRoot = options.tmpRoot ?? tmpdir
  }

  /** Drops identity and auth caches (settings changed, or the user re-ran `az devops login`). */
  invalidate(): void {
    this.identities.clear()
    this.authStatus = null
    this.credentials.invalidate()
  }

  // -------------------------------------------------------------------------
  // Scope and identity
  // -------------------------------------------------------------------------

  private organizations(): AzureOrganizationSettings[] {
    const config = this.getConfig()
    return config.enabled ? config.organizations : []
  }

  /** Throws unless `repo` belongs to a configured organization. */
  private scoped(repoRef: RepoRef): AzureRepoRef {
    const repo = asAzureRepo(repoRef)
    const org = repo.organization.toLowerCase()
    if (!this.organizations().some((entry) => entry.organization.toLowerCase() === org)) {
      throw new ScmError(
        'FORBIDDEN',
        'Azure DevOps organization ' + repo.organization + ' is not configured in Settings.',
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
      return { provider: 'azure', state: 'disabled', detail: 'Turned off in Settings.' }
    }
    const first = config.organizations[0]
    if (!first) {
      return {
        provider: 'azure',
        state: 'disabled',
        detail: 'No Azure DevOps organization configured. Add one in Settings.',
      }
    }
    const org = first.organization
    const loginHint = 'Run: az devops login --organization ' + organizationUrl(org)
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
          ? scmError.message + '. ' + loginHint + ' with a PAT that has Code (Read & Write) scope.'
          : scmError.message
      return { provider: 'azure', state: 'cli_unauthenticated', detail }
    }
  }

  /**
   * Project names of `organization`, for the Settings picker. NOT scoped to
   * the configured orgs on purpose (the user is configuring one); the name
   * is validated by the IPC layer and the client only ever sends that org's
   * own credential to that org's URLs.
   */
  async listProjects(organization: string): Promise<string[]> {
    const projects = await this.client.listContinuation<{ name: string; state?: string }>(
      organization,
      orgApiUrl(organization, '_apis', 'projects'),
      { query: { $top: 500, stateFilter: 'wellFormed' }, maxItems: 2000 },
    )
    return projects
      .map((project) => project.name)
      .filter((name) => typeof name === 'string' && name.length > 0)
      .sort((a, b) => a.localeCompare(b))
  }

  // -------------------------------------------------------------------------
  // Listing
  // -------------------------------------------------------------------------

  async listPullRequests(q: ListPullRequestsQuery): Promise<PullRequestSummary[]> {
    const orgs = this.organizations()
    if (orgs.length === 0) return []
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
            this.client
              .json<AzListResponse<AzPullRequest>>(
                org,
                orgApiUrl(org, project, '_apis', 'git', 'pullrequests'),
                {
                  query: {
                    'searchCriteria.status': status,
                    ['searchCriteria.' + role]: me.id,
                    $top: top,
                  },
                },
              )
              .then((data) => data.value ?? []),
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
    return prs.map((pr) => this.summarize(pr, org))
  }

  /** Summary with the derived `updatedAt` (see the file header). */
  private summarize(pr: AzPullRequest, org: string): PullRequestSummary {
    const entry = this.activity.get(keyOf(pr, org))
    return mapPullRequestSummary(pr, org, [entry?.iterationDate, entry?.changedAt])
  }

  /** Updates the activity tracker; fetches the last push date of open PRs whose head is new to us. */
  private async observeActivity(org: string, prs: AzPullRequest[]): Promise<void> {
    const nowIso = new Date(this.now()).toISOString()
    const needIteration: { key: string; pr: AzPullRequest; head: string }[] = []
    for (const pr of prs) {
      const key = keyOf(pr, org)
      const print = fingerprint(pr)
      const head = pr.lastMergeSourceCommit?.commitId ?? ''
      const entry = this.activity.get(key)
      if (!entry) {
        this.activity.set(key, {
          fingerprint: print,
          changedAt: null,
          iterationDate: null,
          iterationHead: null,
        })
      } else if (entry.fingerprint !== print) {
        entry.fingerprint = print
        entry.changedAt = nowIso
      }
      const current = this.activity.get(key) as ActivityEntry
      if (pr.status === 'active' && head && current.iterationHead !== head) {
        needIteration.push({ key, pr, head })
      }
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
        }
      } catch {
        // Best-effort: without it, `updatedAt` falls back to the other dates.
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
      throw new ScmError('NOT_FOUND', 'Pull request ' + number + ' has no iterations yet.')
    }
    return latest
  }

  async getPullRequestDetail(repoRef: RepoRef, number: number): Promise<PullRequestDetail> {
    const repo = this.scoped(repoRef)
    const org = repo.organization
    const pr = await this.rawPullRequest(repo, number)
    const projectId = pr.repository.project.id
    const [iterations, statuses, evaluations, workItems, commits] = await Promise.all([
      this.iterations(repo, number).catch(() => [] as AzIteration[]),
      this.client
        .json<AzListResponse<AzPullRequestStatusEntry>>(
          org,
          this.repoUrl(repo, 'pullRequests', number, 'statuses'),
        )
        .then((data) => data.value ?? [])
        .catch(() => [] as AzPullRequestStatusEntry[]),
      this.client
        .json<AzListResponse<AzPolicyEvaluation>>(
          org,
          orgApiUrl(org, repo.project, '_apis', 'policy', 'evaluations'),
          {
            query: { artifactId: 'vstfs:///CodeReview/CodeReviewId/' + projectId + '/' + number },
            apiVersion: POLICY_API_VERSION,
          },
        )
        .then((data) => data.value ?? [])
        .catch(() => [] as AzPolicyEvaluation[]),
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
    const cachedFiles = latest ? this.iterationFiles.get(key + '@' + latest.id)?.files : null
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
    }
    if (cachedFiles) {
      detail.changedFiles = cachedFiles.length
      detail.additions = cachedFiles.reduce((sum, file) => sum + file.additions, 0)
      detail.deletions = cachedFiles.reduce((sum, file) => sum + file.deletions, 0)
    }
    return detail
  }

  private async workItems(repo: AzureRepoRef, number: number): Promise<PrWorkItem[]> {
    const org = repo.organization
    const refs = await this.client.json<AzListResponse<{ id: string | number }>>(
      org,
      this.repoUrl(repo, 'pullRequests', number, 'workitems'),
    )
    const ids = (refs.value ?? [])
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

  /** Changes of `iteration` vs. the merge base (`$compareTo=0`), folders dropped, capped. */
  private async iterationChanges(
    repo: AzureRepoRef,
    number: number,
    iteration: number,
  ): Promise<IterationFiles> {
    const cacheKey = prKey(repo, number) + '@' + iteration
    const cached = this.iterationFiles.get(cacheKey)
    if (cached) return cached
    const maxFiles = this.diffBudget.maxFiles ?? DEFAULT_DIFF_BUDGET.maxFiles
    const entries: AzChangeEntry[] = []
    const changes: AzureChange[] = []
    let skip = 0
    for (let page = 0; page < 50 && changes.length < maxFiles; page++) {
      const data = await this.client.json<AzIterationChanges>(
        repo.organization,
        this.repoUrl(repo, 'pullRequests', number, 'iterations', iteration, 'changes'),
        { query: { $compareTo: 0, $top: CHANGES_PAGE, $skip: skip } },
      )
      entries.push(...(data.changeEntries ?? []))
      for (const entry of data.changeEntries ?? []) {
        const change = mapChangeEntry(entry)
        if (change) changes.push(change)
      }
      if (!data.nextSkip || data.nextSkip <= skip) break
      skip = data.nextSkip
    }
    const result: IterationFiles = { changes: changes.slice(0, maxFiles), files: null }
    this.iterationFiles.set(cacheKey, result)
    while (this.iterationFiles.size > FILES_CACHE_SIZE) {
      const oldest = this.iterationFiles.keys().next().value
      if (oldest === undefined) break
      this.iterationFiles.delete(oldest)
    }
    return result
  }

  async getPullRequestFiles(repoRef: RepoRef, number: number): Promise<DiffFile[]> {
    const repo = this.scoped(repoRef)
    const latest = await this.requireLatestIteration(repo, number)
    const iteration = await this.iterationChanges(repo, number, latest.id)
    if (iteration.files) return iteration.files
    const files = await buildDiffFiles(
      iteration.changes,
      (objectId, maxBytes) =>
        this.client.binary(repo.organization, this.repoUrl(repo, 'blobs', objectId), {
          query: { $format: 'octetstream' },
          maxBytes,
        }),
      this.diffBudget,
    )
    iteration.files = files
    return files
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
    latest: number | null,
    paths: ReadonlySet<string> | null,
  ): CommentThread | null {
    const mapped = mapThread(thread, repo, number)
    if (!mapped) return null
    if (isThreadOutdated(mapped, threadAnchor(thread), latest, paths)) mapped.isOutdated = true
    return mapped
  }

  async getCommentThreads(repoRef: RepoRef, number: number): Promise<CommentThread[]> {
    const repo = this.scoped(repoRef)
    const latest = await this.requireLatestIteration(repo, number)
    const [threads, iteration] = await Promise.all([
      this.threadsAt(repo, number, latest.id),
      this.iterationChanges(repo, number, latest.id).catch(() => null),
    ])
    const paths = iteration ? new Set(iteration.changes.map((change) => change.path)) : null
    return threads
      .map((thread) => this.finishThread(thread, repo, number, latest.id, paths))
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
      const threadId = parseNumericId(req.threadId, 'thread')
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
      return mapComment(created, threadId, repo, req.number)
    }

    const body: Record<string, unknown> = {
      comments: [{ ...comment, parentCommentId: 0 }],
      status: 1,
    }
    if (req.path && req.line !== undefined) {
      const latest = await this.requireLatestIteration(repo, req.number)
      const { changes } = await this.iterationChanges(repo, req.number, latest.id)
      const path = toRepoPath(req.path)
      const change = changes.find((entry) => entry.path === path)
      if (!change) {
        throw new ScmError(
          'NOT_FOUND',
          'Cannot comment on ' + path + ': the file is not part of the latest iteration.',
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
    if (!first) throw new ScmError('UNKNOWN', 'Azure DevOps returned a thread without comments.')
    return mapComment(first, created.id, repo, req.number)
  }

  async setThreadStatus(req: SetThreadStatusRequest): Promise<CommentThread> {
    const repo = this.scoped(req.repo)
    const threadId = parseNumericId(req.threadId, 'thread')
    const url = this.repoUrl(repo, 'pullRequests', req.number, 'threads', threadId)
    await this.client.json<AzThread>(repo.organization, url, {
      method: 'PATCH',
      body: { status: threadStatusToAzure(req.status) },
    })
    const latest = latestIteration(await this.iterations(repo, req.number))
    const thread = await this.client.json<AzThread>(repo.organization, url, {
      query: latest ? { $iteration: latest.id, $baseIteration: 0 } : undefined,
    })
    const cached = latest
      ? this.iterationFiles.get(prKey(repo, req.number) + '@' + latest.id)
      : undefined
    const paths = cached ? new Set(cached.changes.map((change) => change.path)) : null
    const mapped = this.finishThread(thread, repo, req.number, latest?.id ?? null, paths)
    if (!mapped) throw new ScmError('NOT_FOUND', 'Comment thread not found: ' + req.threadId)
    return mapped
  }

  async getFileContent(req: FileContentRequest): Promise<FileContent> {
    const repo = this.scoped(req.repo)
    const latest = await this.requireLatestIteration(repo, req.number)
    const commit =
      req.side === 'head'
        ? latest.sourceRefCommit?.commitId
        : (latest.commonRefCommit?.commitId ?? latest.targetRefCommit?.commitId)
    if (!commit || !COMMIT_SHA_RE.test(commit)) {
      throw new ScmError('NOT_FOUND', 'Azure DevOps did not report the ' + req.side + ' commit.')
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
    return this.summarize(updated, repo.organization)
  }

  // -------------------------------------------------------------------------
  // Stacks
  // -------------------------------------------------------------------------

  async listStackCandidates(): Promise<StackInputPr[]> {
    const out: StackInputPr[] = []
    for (const entry of this.organizations()) {
      const lists = await Promise.all(
        entry.projects.map((project) =>
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
      )
      for (const pr of lists.flat()) out.push(toStackInput(pr, entry.organization))
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
      throw new ScmError('NOT_FOUND', 'Not a commit id: ' + req.headSha.slice(0, 40))
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
          throw new ScmError(
            'UNKNOWN',
            error.message + ' An agentic analysis cannot be generated for this PR.',
          )
        }
        throw error
      }
    } finally {
      await rm(workDir, { recursive: true, force: true })
    }
  }
}
