/**
 * Real GitHub data source with Octokit: GraphQL for listings (few calls, exact
 * data shape) and REST for one-off actions (PR files, posting comments). See
 * `./index.ts` for how it's chosen over `MockGithubService`.
 *
 * The token never lives here: it's requested on every call through
 * `getToken` (in practice the `gh` token bridge), so this class never has to
 * learn about account switches.
 */
import { rm, writeFile } from 'node:fs/promises'
import { Octokit } from 'octokit'
import * as tar from 'tar'
import type {
  CiStatus,
  CommentThread,
  DiffFile,
  DiffFileStatus,
  FileContentRequest,
  PostCommentRequest,
  PrComment,
  PrReviewer,
  PullRequestDetail,
  PullRequestState,
  PullRequestSummary,
  ReviewDecision,
  SetThreadStatusRequest,
  UserRef,
} from '../../../shared/types'
import {
  MAX_FILE_CONTENT_BYTES,
  prWebUrl,
  repoKey,
  shortRef,
  type FileContent,
  type GithubRepoRef,
  type RepoRef,
  type ReviewerVote,
} from '../../../shared/scm'
import { looksBinary } from '../azure/patch-builder'
import { ScmError, isScmError } from '../errors'
import type { ListPullRequestsQuery, ScmDataSource, SnapshotRequest } from '../provider'
import type { StackInputPr } from '../stacks'
import { asGithubRepo } from './repo'

/** Prefijo sintético para hilos generales (issue comments, sin línea): ver `mapIssueCommentToThread`. */
const ISSUE_THREAD_PREFIX = 'issue-'

/**
 * Tope de tamaño del tarball de un snapshot (T54): un repo real puede pesar
 * mucho más que un diff, y este tarball se guarda entero en memoria antes de
 * escribirse a disco (`octokit.request` no expone streaming para binarios) —
 * sin tope, un repo gigante podría agotar memoria del proceso `main`.
 */
export const MAX_TARBALL_BYTES = 150 * 1024 * 1024

/**
 * Tope del tamaño DESCOMPRIMIDO declarado por el índice del tarball (revisión
 * de seguridad F11): sin esto, un tarball de <150 MB comprimido podía
 * expandirse a varios GB (bomba de descompresión) — ver `writeSnapshot`.
 */
export const MAX_EXTRACTED_BYTES = 500 * 1024 * 1024

// ---------------------------------------------------------------------------
// Tipos propios para las respuestas de GraphQL (Octokit no genera tipos para
// queries arbitrarias: se declaran a mano, con los campos que efectivamente
// pedimos). Todos los campos que GitHub puede omitir/nullear se tipan
// opcionales/nullable a propósito, y se mapean con fallback explícito.
// ---------------------------------------------------------------------------

interface GraphqlAuthor {
  login: string
  avatarUrl: string
}

interface GraphqlCommentNode {
  id: string
  body: string
  createdAt: string
  isMinimized: boolean
  url: string
  author: GraphqlAuthor | null
}

type GraphqlReviewDecision = 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null
type GraphqlPrState = 'OPEN' | 'CLOSED' | 'MERGED'

interface SearchPullRequestNode {
  __typename: string
  id?: string
  number?: number
  title?: string
  state?: GraphqlPrState
  isDraft?: boolean
  url?: string
  createdAt?: string
  updatedAt?: string
  headRefName?: string
  baseRefName?: string
  additions?: number
  deletions?: number
  changedFiles?: number
  reviewDecision?: GraphqlReviewDecision
  author?: GraphqlAuthor | null
  repository?: { owner: { login: string }; name: string; nameWithOwner: string }
  comments?: { totalCount: number }
  lastCommit?: {
    nodes: { commit: { oid?: string; statusCheckRollup: { state: string } | null } }[]
  }
}

interface SearchPullRequestsResponse {
  search: { nodes: SearchPullRequestNode[] }
}

interface RequestedReviewer {
  login?: string
  avatarUrl?: string
}

interface PullRequestDetailNode {
  id: string
  number: number
  title: string
  body: string | null
  state: GraphqlPrState
  isDraft: boolean
  url: string
  createdAt: string
  updatedAt: string
  headRefName: string
  baseRefName: string
  additions: number
  deletions: number
  changedFiles: number
  reviewDecision: GraphqlReviewDecision
  author: GraphqlAuthor | null
  comments: { totalCount: number }
  commitCount: { totalCount: number }
  lastCommit: { nodes: { commit: { oid?: string; statusCheckRollup: { state: string } | null } }[] }
  labels: { nodes: { name: string; color: string }[] } | null
  reviewRequests: { nodes: { requestedReviewer: RequestedReviewer | null }[] } | null
  latestReviews: { nodes: { state: string; author: GraphqlAuthor | null }[] } | null
}

interface PullRequestDetailResponse {
  repository: { pullRequest: PullRequestDetailNode | null } | null
}

interface ReviewThreadNode {
  id: string
  isResolved: boolean
  isOutdated: boolean
  path: string
  line: number | null
  originalLine: number | null
  diffSide: 'LEFT' | 'RIGHT' | null
  comments: { nodes: GraphqlCommentNode[] }
}

interface PullRequestThreadsResponse {
  repository: {
    pullRequest: {
      reviewThreads: { nodes: ReviewThreadNode[] }
      comments: { nodes: GraphqlCommentNode[] }
    } | null
  } | null
}

interface AddReviewThreadReplyResponse {
  addPullRequestReviewThreadReply: { comment: GraphqlCommentNode }
}

// ---------------------------------------------------------------------------
// Queries / mutations. GraphQL de GitHub: campos `commits` con distintos
// argumentos se piden dos veces bajo alias distintos (`commitCount`,
// `lastCommit`) porque GraphQL no permite repetir un campo con args
// diferentes sin alias.
// ---------------------------------------------------------------------------

const SEARCH_PULL_REQUESTS_QUERY = `
  query SearchPullRequests($searchQuery: String!) {
    search(type: ISSUE, query: $searchQuery, first: 50) {
      nodes {
        __typename
        ... on PullRequest {
          id
          number
          title
          state
          isDraft
          url
          createdAt
          updatedAt
          headRefName
          baseRefName
          additions
          deletions
          changedFiles
          reviewDecision
          author { login avatarUrl }
          repository { owner { login } name nameWithOwner }
          comments { totalCount }
          lastCommit: commits(last: 1) {
            nodes { commit { oid statusCheckRollup { state } } }
          }
        }
      }
    }
  }
`

const PULL_REQUEST_DETAIL_QUERY = `
  query PullRequestDetail($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      pullRequest(number: $number) {
        id
        number
        title
        body
        state
        isDraft
        url
        createdAt
        updatedAt
        headRefName
        baseRefName
        additions
        deletions
        changedFiles
        reviewDecision
        author { login avatarUrl }
        comments { totalCount }
        commitCount: commits { totalCount }
        lastCommit: commits(last: 1) {
          nodes { commit { oid statusCheckRollup { state } } }
        }
        labels(first: 30) { nodes { name color } }
        reviewRequests(first: 20) {
          nodes { requestedReviewer { ... on User { login avatarUrl } } }
        }
        latestReviews(first: 20) {
          nodes { state author { login avatarUrl } }
        }
      }
    }
  }
`

const PULL_REQUEST_THREADS_QUERY = `
  query PullRequestThreads($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      pullRequest(number: $number) {
        reviewThreads(first: 100) {
          nodes {
            id
            isResolved
            isOutdated
            path
            line
            originalLine
            diffSide
            comments(first: 100) {
              nodes { id body createdAt isMinimized url author { login avatarUrl } }
            }
          }
        }
        comments(first: 100) {
          nodes { id body createdAt isMinimized url author { login avatarUrl } }
        }
      }
    }
  }
`

const ADD_REVIEW_THREAD_REPLY_MUTATION = `
  mutation AddReviewThreadReply($threadId: ID!, $body: String!) {
    addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $threadId, body: $body }) {
      comment {
        id
        body
        createdAt
        isMinimized
        url
        author { login avatarUrl }
      }
    }
  }
`

const REVIEW_THREAD_FIELDS =
  ' id isResolved isOutdated path line originalLine diffSide' +
  ' comments(first: 100) {' +
  '   nodes { id body createdAt isMinimized url author { login avatarUrl } }' +
  ' }'

const RESOLVE_REVIEW_THREAD_MUTATION =
  'mutation ResolveReviewThread($threadId: ID!) {' +
  '  resolveReviewThread(input: { threadId: $threadId }) { thread {' +
  REVIEW_THREAD_FIELDS +
  '  } }' +
  '}'

const UNRESOLVE_REVIEW_THREAD_MUTATION =
  'mutation UnresolveReviewThread($threadId: ID!) {' +
  '  unresolveReviewThread(input: { threadId: $threadId }) { thread {' +
  REVIEW_THREAD_FIELDS +
  '  } }' +
  '}'

interface ReviewThreadMutationResponse {
  resolveReviewThread?: { thread: ReviewThreadNode }
  unresolveReviewThread?: { thread: ReviewThreadNode }
}

/**
 * The PR a review thread node belongs to. Thread node ids are GLOBAL, so a
 * write must first check the thread is in `repo#number` (what the user is
 * looking at), or a forged id could resolve/reply on any PR the token reaches.
 */
const REVIEW_THREAD_OWNER_QUERY =
  'query ReviewThreadOwner($threadId: ID!) {' +
  '  node(id: $threadId) {' +
  '    __typename' +
  '    ... on PullRequestReviewThread {' +
  '      pullRequest { number repository { nameWithOwner } }' +
  '    }' +
  '  }' +
  '}'

interface ReviewThreadOwnerResponse {
  node: {
    __typename: string
    pullRequest?: { number: number; repository: { nameWithOwner: string } }
  } | null
}

/** Throws `NOT_FOUND` unless `threadId` is a review thread of `repo#number`. */
export async function assertReviewThreadOf(
  client: Pick<Octokit, 'graphql'>,
  threadId: string,
  repo: GithubRepoRef,
  number: number,
): Promise<void> {
  const data = await client.graphql<ReviewThreadOwnerResponse>(REVIEW_THREAD_OWNER_QUERY, {
    threadId,
  })
  const owner = data.node?.__typename === 'PullRequestReviewThread' ? data.node.pullRequest : null
  if (
    !owner ||
    owner.number !== number ||
    owner.repository.nameWithOwner.toLowerCase() !== repo.fullName.toLowerCase()
  ) {
    throw new ScmError(
      'NOT_FOUND',
      'Comment thread not found in ' + repo.fullName + '#' + number + ': ' + threadId.slice(0, 80),
    )
  }
}

/** Files the PR files API is paged to (GitHub itself stops at 3000). */
export const MAX_PR_FILES = 300

/** Repos per stack-candidate search query (GitHub search caps query length). */
const STACK_REPOS_PER_QUERY = 10
/** Repos considered for stacks at most (the ones with the most recent PRs win). */
const MAX_STACK_REPOS = 30

// ---------------------------------------------------------------------------
// Mapeos GraphQL -> tipos de dominio, con cuidado explícito de los `null`.
// ---------------------------------------------------------------------------

function mapPrState(state: GraphqlPrState | undefined): PullRequestState {
  switch (state) {
    case 'CLOSED':
      return 'closed'
    case 'MERGED':
      return 'merged'
    default:
      return 'open'
  }
}

function mapReviewDecision(decision: GraphqlReviewDecision | undefined): ReviewDecision {
  switch (decision) {
    case 'APPROVED':
      return 'approved'
    case 'CHANGES_REQUESTED':
      return 'changes_requested'
    case 'REVIEW_REQUIRED':
      return 'review_required'
    default:
      return null
  }
}

function mapCiStatus(state: string | null | undefined): CiStatus {
  switch (state) {
    case 'SUCCESS':
      return 'success'
    case 'FAILURE':
    case 'ERROR':
      return 'failure'
    case 'PENDING':
    case 'EXPECTED':
      return 'pending'
    default:
      return null
  }
}

function mapAuthor(author: GraphqlAuthor | null | undefined): UserRef {
  return author ? { login: author.login, avatarUrl: author.avatarUrl } : { login: 'ghost' }
}

function mapReviewVote(state: string): ReviewerVote {
  switch (state) {
    case 'APPROVED':
      return 'approved'
    case 'CHANGES_REQUESTED':
      return 'changes_requested'
    default:
      // COMMENTED / PENDING / DISMISSED: no standing vote.
      return 'none'
  }
}

function mapSearchNodeToSummary(node: SearchPullRequestNode): PullRequestSummary {
  const repo: GithubRepoRef = {
    provider: 'github',
    owner: node.repository?.owner.login ?? '',
    name: node.repository?.name ?? '',
    fullName: node.repository?.nameWithOwner ?? '',
  }
  const number = node.number ?? 0
  return {
    id: node.id ?? '',
    number,
    title: node.title ?? '',
    author: mapAuthor(node.author),
    repo,
    state: mapPrState(node.state),
    isDraft: Boolean(node.isDraft),
    createdAt: node.createdAt ?? new Date(0).toISOString(),
    updatedAt: node.updatedAt ?? new Date(0).toISOString(),
    headRef: node.headRefName ?? '',
    baseRef: node.baseRefName ?? '',
    headSha: node.lastCommit?.nodes[0]?.commit.oid ?? '',
    webUrl: node.url ?? prWebUrl(repo, number),
    commentCount: node.comments?.totalCount ?? 0,
    reviewDecision: mapReviewDecision(node.reviewDecision),
    ciStatus: mapCiStatus(node.lastCommit?.nodes[0]?.commit.statusCheckRollup?.state),
    additions: node.additions ?? 0,
    deletions: node.deletions ?? 0,
    changedFiles: node.changedFiles ?? 0,
  }
}

/**
 * Reviewers with their vote: latest review state per author, then pending
 * review requests (a re-requested reviewer's old vote no longer stands, so
 * the request wins with `none`). GitHub doesn't tell which are required.
 */
function mapReviewers(pr: PullRequestDetailNode): PrReviewer[] {
  const reviewers = new Map<string, PrReviewer>()
  for (const { state, author } of pr.latestReviews?.nodes ?? []) {
    if (author?.login) {
      reviewers.set(author.login, {
        user: mapAuthor(author),
        vote: mapReviewVote(state),
        isRequired: false,
      })
    }
  }
  for (const { requestedReviewer } of pr.reviewRequests?.nodes ?? []) {
    if (requestedReviewer?.login) {
      reviewers.set(requestedReviewer.login, {
        user: { login: requestedReviewer.login, avatarUrl: requestedReviewer.avatarUrl },
        vote: 'none',
        isRequired: false,
      })
    }
  }
  return [...reviewers.values()]
}

function mapDetailNode(pr: PullRequestDetailNode, repo: GithubRepoRef): PullRequestDetail {
  return {
    id: pr.id,
    number: pr.number,
    title: pr.title,
    author: mapAuthor(pr.author),
    repo,
    state: mapPrState(pr.state),
    isDraft: Boolean(pr.isDraft),
    createdAt: pr.createdAt,
    updatedAt: pr.updatedAt,
    headRef: pr.headRefName,
    baseRef: pr.baseRefName,
    headSha: pr.lastCommit?.nodes[0]?.commit.oid ?? '',
    webUrl: pr.url ?? prWebUrl(repo, pr.number),
    commentCount: pr.comments?.totalCount ?? 0,
    reviewDecision: mapReviewDecision(pr.reviewDecision),
    ciStatus: mapCiStatus(pr.lastCommit?.nodes[0]?.commit.statusCheckRollup?.state),
    additions: pr.additions ?? 0,
    deletions: pr.deletions ?? 0,
    changedFiles: pr.changedFiles ?? 0,
    bodyMarkdown: pr.body ?? '',
    labels: (pr.labels?.nodes ?? []).map((label) => ({ name: label.name, color: label.color })),
    reviewers: mapReviewers(pr),
    commits: pr.commitCount?.totalCount ?? 0,
    // `getPullRequestFiles` stops at MAX_PR_FILES; `changedFiles` stays the true total.
    ...((pr.changedFiles ?? 0) > MAX_PR_FILES ? { filesTruncated: true } : {}),
  }
}

function mapGraphqlCommentToPrComment(comment: GraphqlCommentNode): PrComment {
  return {
    id: comment.id,
    author: mapAuthor(comment.author),
    bodyMarkdown: comment.body,
    createdAt: comment.createdAt,
    isMinimized: comment.isMinimized,
    htmlUrl: comment.url,
  }
}

function mapReviewThreadNode(node: ReviewThreadNode): CommentThread {
  return {
    id: node.id,
    status: node.isResolved ? 'resolved' : 'active',
    isResolved: node.isResolved,
    isOutdated: node.isOutdated,
    isLineThread: true,
    path: node.path,
    line: node.line ?? node.originalLine ?? undefined,
    side: node.diffSide === 'LEFT' ? 'LEFT' : 'RIGHT',
    comments: node.comments.nodes.map(mapGraphqlCommentToPrComment),
  }
}

function mapIssueCommentToThread(comment: GraphqlCommentNode): CommentThread {
  return {
    id: `${ISSUE_THREAD_PREFIX}${comment.id}`,
    status: 'active',
    isResolved: false,
    isLineThread: false,
    comments: [mapGraphqlCommentToPrComment(comment)],
  }
}

function mapFileStatus(status: string): DiffFileStatus {
  switch (status) {
    case 'added':
      return 'added'
    case 'removed':
      return 'removed'
    case 'renamed':
      return 'renamed'
    default:
      // 'modified' | 'copied' | 'changed' | 'unchanged' (o cualquier valor
      // futuro no contemplado): tratamos como "modified", el catch-all más
      // razonable para nuestro modelo de 4 estados.
      return 'modified'
  }
}

function mapRestCommentToPrComment(data: {
  id: number
  body?: string | null
  created_at: string
  html_url?: string
  user?: { login: string; avatar_url: string } | null
}): PrComment {
  return {
    id: String(data.id),
    author: data.user
      ? { login: data.user.login, avatarUrl: data.user.avatar_url }
      : { login: 'ghost' },
    bodyMarkdown: data.body ?? '',
    createdAt: data.created_at,
    isMinimized: false,
    htmlUrl: data.html_url,
  }
}

// ---------------------------------------------------------------------------
// Errors: Octokit throws `RequestError` (REST and GraphQL HTTP failures) with
// `.status`, or (GraphQL with HTTP 200 but `errors` in the body) an error with
// `.errors[].type`. Duck-typed so we don't depend on the concrete classes.
// ---------------------------------------------------------------------------

interface GithubErrorLike {
  status?: number
  response?: { headers?: Record<string, string> }
  errors?: { type?: string; message?: string }[]
}

function asGithubErrorLike(error: unknown): GithubErrorLike {
  return typeof error === 'object' && error !== null ? (error as GithubErrorLike) : {}
}

/** Maps any Octokit/GitHub failure to a typed `ScmError`. */
export function mapGithubError(error: unknown, repoFullName?: string): ScmError {
  if (isScmError(error)) return error
  const err = asGithubErrorLike(error)
  const status = typeof err.status === 'number' ? err.status : undefined
  const repoLabel = repoFullName ?? 'this repository'
  const options = { cause: error }

  if (status === 401) {
    return new ScmError(
      'UNAUTHENTICATED',
      'Not authenticated: the GitHub token is invalid or expired.',
      options,
    )
  }

  if (status === 403 || status === 429) {
    const headers = err.response?.headers ?? {}
    const remaining = headers['x-ratelimit-remaining']
    const reset = headers['x-ratelimit-reset']
    if (status === 429 || (remaining === '0' && reset)) {
      const resetMs = Number(reset) * 1000
      const minutes = Number.isFinite(resetMs)
        ? Math.max(1, Math.ceil((resetMs - Date.now()) / 60000))
        : 1
      return new ScmError(
        'RATE_LIMITED',
        `GitHub rate limit reached, try again in ${minutes} min`,
        options,
      )
    }
    return new ScmError('FORBIDDEN', `No permission for ${repoLabel}`, options)
  }

  if (status === 404) {
    return new ScmError(
      'NOT_FOUND',
      `No permission for ${repoLabel} (or it doesn't exist)`,
      options,
    )
  }

  const graphqlErrorType = err.errors?.[0]?.type
  if (graphqlErrorType === 'FORBIDDEN') {
    return new ScmError('FORBIDDEN', `No permission for ${repoLabel}`, options)
  }
  if (graphqlErrorType === 'NOT_FOUND') {
    return new ScmError(
      'NOT_FOUND',
      `No permission for ${repoLabel} (or it doesn't exist)`,
      options,
    )
  }

  if (status) {
    return new ScmError('UNKNOWN', `GitHub error (status ${status})`, options)
  }

  if (error instanceof TypeError) {
    return new ScmError('NETWORK', 'Could not reach GitHub: ' + error.message, options)
  }

  return new ScmError(
    'UNKNOWN',
    error instanceof Error ? error.message : 'Unknown error talking to GitHub',
    options,
  )
}

// ---------------------------------------------------------------------------
// Servicio real.
// ---------------------------------------------------------------------------

/** The Octokit surface the service uses (a fake in unit tests). */
export type GithubClient = Pick<Octokit, 'graphql' | 'rest' | 'request'>

export class RealGithubService implements ScmDataSource {
  constructor(
    private readonly getToken: () => string | null,
    private readonly createClient?: (token: string) => GithubClient,
  ) {}

  private requireToken(): string {
    const token = this.getToken()
    if (!token) {
      throw new ScmError(
        'UNAUTHENTICATED',
        "Not authenticated: sign in with 'gh auth login' and retry.",
      )
    }
    return token
  }

  private client(token: string): GithubClient {
    if (this.createClient) return this.createClient(token)
    return new Octokit({
      auth: token,
      throttle: {
        // No reintentamos automáticamente ante rate limit: dejamos que el
        // error real suba y lo mapeamos nosotros (`mapGithubError`) a un
        // mensaje en español con el tiempo de espera.
        onRateLimit: () => false,
        onSecondaryRateLimit: () => false,
      },
    })
  }

  async listPullRequests(req: ListPullRequestsQuery): Promise<PullRequestSummary[]> {
    const token = this.requireToken()
    try {
      const client = this.client(token)
      const extra = req.search?.trim()
      // Qualifier de estado (T51, F10): 'open' (default, comportamiento
      // previo) → `is:open`; 'closed' → `is:closed` (GitHub reporta los
      // mergeados como `is:closed is:merged`, así que sin qualifier extra ya
      // incluye ambos); 'all' → sin qualifier de estado. `sort:updated-desc`
      // SIEMPRE: determinismo del top-50, relevante sobre todo con `closed`
      // en juego.
      const state = req.state ?? 'open'
      const stateQualifier =
        state === 'open' ? 'is:open' : state === 'closed' ? 'is:closed' : undefined
      const searchQuery = [
        'is:pr',
        stateQualifier,
        'involves:@me',
        'archived:false',
        extra,
        'sort:updated-desc',
      ]
        .filter((part): part is string => Boolean(part))
        .join(' ')
      const data = await client.graphql<SearchPullRequestsResponse>(SEARCH_PULL_REQUESTS_QUERY, {
        searchQuery,
      })
      return data.search.nodes
        .filter((node) => node.__typename === 'PullRequest')
        .map(mapSearchNodeToSummary)
    } catch (error) {
      throw mapGithubError(error)
    }
  }

  async getPullRequestDetail(repoRef: RepoRef, number: number): Promise<PullRequestDetail> {
    const repo = asGithubRepo(repoRef)
    const token = this.requireToken()
    try {
      const client = this.client(token)
      const data = await client.graphql<PullRequestDetailResponse>(PULL_REQUEST_DETAIL_QUERY, {
        owner: repo.owner,
        name: repo.name,
        number,
      })
      const pr = data.repository?.pullRequest
      if (!pr) {
        throw new ScmError('NOT_FOUND', `Pull request not found: ${repo.fullName}#${number}`)
      }
      return mapDetailNode(pr, repo)
    } catch (error) {
      throw mapGithubError(error, repo.fullName)
    }
  }

  async getPullRequestFiles(repoRef: RepoRef, number: number): Promise<DiffFile[]> {
    const repo = asGithubRepo(repoRef)
    const token = this.requireToken()
    try {
      const client = this.client(token)
      const perPage = 100
      const maxFiles = MAX_PR_FILES
      const files: Awaited<ReturnType<Octokit['rest']['pulls']['listFiles']>>['data'] = []

      for (let page = 1; files.length < maxFiles; page++) {
        const { data } = await client.rest.pulls.listFiles({
          owner: repo.owner,
          repo: repo.name,
          pull_number: number,
          per_page: perPage,
          page,
        })
        files.push(...data)
        if (data.length < perPage) break
      }

      return files.slice(0, maxFiles).map((file) => ({
        path: file.filename,
        previousPath: file.previous_filename,
        status: mapFileStatus(file.status),
        additions: file.additions,
        deletions: file.deletions,
        patch: file.patch,
        isBinary: file.patch === undefined,
      }))
    } catch (error) {
      throw mapGithubError(error, repo.fullName)
    }
  }

  async getCommentThreads(repoRef: RepoRef, number: number): Promise<CommentThread[]> {
    const repo = asGithubRepo(repoRef)
    const token = this.requireToken()
    try {
      const client = this.client(token)
      const data = await client.graphql<PullRequestThreadsResponse>(PULL_REQUEST_THREADS_QUERY, {
        owner: repo.owner,
        name: repo.name,
        number,
      })
      const pr = data.repository?.pullRequest
      if (!pr) {
        throw new ScmError('NOT_FOUND', `Pull request not found: ${repo.fullName}#${number}`)
      }

      const lineThreads = pr.reviewThreads.nodes.map(mapReviewThreadNode)
      const generalThreads = pr.comments.nodes.map(mapIssueCommentToThread)
      return [...lineThreads, ...generalThreads]
    } catch (error) {
      throw mapGithubError(error, repo.fullName)
    }
  }

  async postComment(req: PostCommentRequest): Promise<PrComment> {
    const repo = asGithubRepo(req.repo)
    const token = this.requireToken()
    try {
      const client = this.client(token)

      // Caso 1: respuesta a un hilo de línea ya existente (threadId es el id
      // GraphQL del review thread). Los hilos sintéticos de comentarios
      // generales (`issue-<id>`, ver `mapIssueCommentToThread`) no son un
      // hilo real para GitHub — una "respuesta" a uno de esos cae al caso
      // general (caso 3), como cualquier otro comentario del PR.
      if (req.threadId && !req.threadId.startsWith(ISSUE_THREAD_PREFIX)) {
        await assertReviewThreadOf(client, req.threadId, repo, req.number)
        const data = await client.graphql<AddReviewThreadReplyResponse>(
          ADD_REVIEW_THREAD_REPLY_MUTATION,
          { threadId: req.threadId, body: req.bodyMarkdown },
        )
        return mapGraphqlCommentToPrComment(data.addPullRequestReviewThreadReply.comment)
      }

      // Caso 2: hilo nuevo en una línea concreta del diff.
      if (req.path && req.line !== undefined && !req.threadId) {
        const { data: pr } = await client.rest.pulls.get({
          owner: repo.owner,
          repo: repo.name,
          pull_number: req.number,
        })
        const { data: comment } = await client.rest.pulls.createReviewComment({
          owner: repo.owner,
          repo: repo.name,
          pull_number: req.number,
          commit_id: pr.head.sha,
          path: req.path,
          line: req.line,
          side: req.side ?? 'RIGHT',
          body: req.bodyMarkdown,
        })
        return mapRestCommentToPrComment(comment)
      }

      // Caso 3: comentario general (incluye "respuestas" a hilos sintéticos).
      const { data: comment } = await client.rest.issues.createComment({
        owner: repo.owner,
        repo: repo.name,
        issue_number: req.number,
        body: req.bodyMarkdown,
      })
      return mapRestCommentToPrComment(comment)
    } catch (error) {
      throw mapGithubError(error, repo.fullName)
    }
  }

  /**
   * GitHub threads only know resolved/unresolved: `resolved` resolves,
   * `active` unresolves (the validator lets nothing else through). PR-level
   * comments (`issue-…` ids) have no resolve state on GitHub.
   */
  async setThreadStatus(req: SetThreadStatusRequest): Promise<CommentThread> {
    const repo = asGithubRepo(req.repo)
    if (req.threadId.startsWith(ISSUE_THREAD_PREFIX)) {
      throw new ScmError('NOT_FOUND', 'General PR comments cannot be resolved on GitHub.')
    }
    const token = this.requireToken()
    try {
      const client = this.client(token)
      await assertReviewThreadOf(client, req.threadId, repo, req.number)
      const resolve = req.status === 'resolved'
      const data = await client.graphql<ReviewThreadMutationResponse>(
        resolve ? RESOLVE_REVIEW_THREAD_MUTATION : UNRESOLVE_REVIEW_THREAD_MUTATION,
        { threadId: req.threadId },
      )
      const thread = resolve ? data.resolveReviewThread?.thread : data.unresolveReviewThread?.thread
      if (!thread) throw new ScmError('NOT_FOUND', 'Comment thread not found: ' + req.threadId)
      return mapReviewThreadNode(thread)
    } catch (error) {
      throw mapGithubError(error, repo.fullName)
    }
  }

  /**
   * `base` = the merge base (what LEFT-side line numbers refer to, the same
   * commit GitHub diffs against), `head` = the PR head. Contents API JSON
   * form: base64 up to 1 MB, empty `content` above (reported as `tooLarge`).
   */
  async getFileContent(req: FileContentRequest): Promise<FileContent> {
    const repo = asGithubRepo(req.repo)
    const token = this.requireToken()
    try {
      const client = this.client(token)
      const { data: pr } = await client.rest.pulls.get({
        owner: repo.owner,
        repo: repo.name,
        pull_number: req.number,
      })
      let ref = pr.head.sha
      if (req.side === 'base') {
        const { data: compare } = await client.rest.repos.compareCommitsWithBasehead({
          owner: repo.owner,
          repo: repo.name,
          basehead: pr.base.sha + '...' + pr.head.sha,
          per_page: 1,
        })
        ref = compare.merge_base_commit.sha
      }
      const { data } = await client.rest.repos.getContent({
        owner: repo.owner,
        repo: repo.name,
        path: req.path,
        ref,
      })
      if (Array.isArray(data) || data.type !== 'file') {
        throw new ScmError('NOT_FOUND', 'Not a file: ' + req.path)
      }
      if (data.size > MAX_FILE_CONTENT_BYTES || !('content' in data) || !data.content) {
        return { content: null, isBinary: false, tooLarge: data.size > 0 }
      }
      const bytes = Buffer.from(data.content, 'base64')
      if (looksBinary(bytes)) return { content: null, isBinary: true, tooLarge: false }
      return { content: new TextDecoder('utf-8').decode(bytes), isBinary: false, tooLarge: false }
    } catch (error) {
      throw mapGithubError(error, repo.fullName)
    }
  }

  async branchExists(repoRef: RepoRef, branch: string): Promise<boolean> {
    const repo = asGithubRepo(repoRef)
    const token = this.requireToken()
    try {
      // `git/ref/{ref}` is an EXACT match (unlike `git/matching-refs`).
      await this.client(token).rest.git.getRef({
        owner: repo.owner,
        repo: repo.name,
        ref: 'heads/' + shortRef(branch),
      })
      return true
    } catch (error) {
      if (asGithubErrorLike(error).status === 404) return false
      throw mapGithubError(error, repo.fullName)
    }
  }

  async updatePullRequestBase(
    repoRef: RepoRef,
    number: number,
    newBase: string,
  ): Promise<PullRequestSummary> {
    const repo = asGithubRepo(repoRef)
    const token = this.requireToken()
    try {
      await this.client(token).rest.pulls.update({
        owner: repo.owner,
        repo: repo.name,
        pull_number: number,
        base: shortRef(newBase),
      })
    } catch (error) {
      throw mapGithubError(error, repo.fullName)
    }
    return this.getPullRequestDetail(repo, number)
  }

  /**
   * Open PRs of the repos the user has open PRs in (from the usual
   * `involves:@me` listing), so a whole chain shows up even where the user
   * only reviews one link. Capped at `MAX_STACK_REPOS` repos.
   */
  async listStackCandidates(): Promise<StackInputPr[]> {
    const mine = await this.listPullRequests({ state: 'open' })
    const repos: GithubRepoRef[] = []
    const seen = new Set<string>()
    for (const pr of mine) {
      if (pr.repo.provider !== 'github' || seen.has(repoKey(pr.repo))) continue
      seen.add(repoKey(pr.repo))
      repos.push(pr.repo)
    }
    const token = this.requireToken()
    const out: StackInputPr[] = []
    try {
      const client = this.client(token)
      const selected = repos.slice(0, MAX_STACK_REPOS)
      for (let i = 0; i < selected.length; i += STACK_REPOS_PER_QUERY) {
        const chunk = selected.slice(i, i + STACK_REPOS_PER_QUERY)
        const searchQuery =
          'is:pr is:open archived:false ' +
          chunk.map((repo) => 'repo:' + repo.fullName).join(' ') +
          ' sort:updated-desc'
        const data = await client.graphql<SearchPullRequestsResponse>(SEARCH_PULL_REQUESTS_QUERY, {
          searchQuery,
        })
        for (const node of data.search.nodes) {
          if (node.__typename !== 'PullRequest') continue
          const pr = mapSearchNodeToSummary(node)
          out.push({
            repo: pr.repo,
            number: pr.number,
            title: pr.title,
            headRef: pr.headRef,
            baseRef: pr.baseRef,
            state: pr.state,
            isDraft: pr.isDraft,
            createdAt: pr.createdAt,
          })
        }
      }
      return out
    } catch (error) {
      throw mapGithubError(error)
    }
  }

  /** Exact `head=owner:branch` filter (same-repo stacks), merged only. */
  async listMergedBySourceBranch(repoRef: RepoRef, branch: string): Promise<StackInputPr[]> {
    const repo = asGithubRepo(repoRef)
    const token = this.requireToken()
    try {
      const { data } = await this.client(token).rest.pulls.list({
        owner: repo.owner,
        repo: repo.name,
        state: 'closed',
        head: repo.owner + ':' + shortRef(branch),
        per_page: 20,
      })
      return data
        .filter((pr) => pr.merged_at)
        .map((pr) => ({
          repo,
          number: pr.number,
          title: pr.title,
          headRef: pr.head.ref,
          baseRef: pr.base.ref,
          state: 'merged' as const,
          isDraft: Boolean(pr.draft),
          mergedInto: pr.base.ref,
          createdAt: pr.created_at,
          closedAt: pr.merged_at ?? undefined,
        }))
    } catch (error) {
      throw mapGithubError(error, repo.fullName)
    }
  }

  /**
   * Descarga el tarball del repo AL COMMIT `headSha` (endpoint REST, no
   * git — el snapshot es de un commit puntual, no un clon con historia) y lo
   * extrae en `destDir`. El tar.gz temporal se escribe como archivo HERMANO
   * de `destDir` (mismo padre, nombre `<destDir>.tar.gz`) porque node-tar
   * necesita un `file` real en disco (no acepta el `ArrayBuffer` en
   * memoria); se borra al final, tanto en éxito como en error.
   *
   * Los tarballs de GitHub traen un directorio raíz sintético
   * (`owner-repo-sha7/`) envolviendo el contenido real: `strip: 1` lo pela
   * para que `destDir` termine siendo la raíz del repo.
   */
  async writeSnapshot(req: SnapshotRequest, destDir: string): Promise<void> {
    const repo = asGithubRepo(req.repo)
    const token = this.requireToken()
    const client = this.client(token)
    const tmpTarPath = destDir + '.tar.gz'

    try {
      const response = await client.request('GET /repos/{owner}/{repo}/tarball/{ref}', {
        owner: repo.owner,
        repo: repo.name,
        ref: req.headSha,
      })
      const buffer = Buffer.from(response.data as ArrayBuffer)
      if (buffer.byteLength > MAX_TARBALL_BYTES) {
        const maxMb = Math.floor(MAX_TARBALL_BYTES / (1024 * 1024))
        throw new ScmError(
          'UNKNOWN',
          'Repository ' +
            repo.fullName +
            ' is too large to copy locally (tarball over ' +
            maxMb +
            ' MB). An agentic analysis cannot be generated for this PR.',
        )
      }

      await writeFile(tmpTarPath, buffer)

      // Bomba de descompresión (revisión de seguridad F11, hallazgo #1): el
      // tope de arriba es sobre el tarball COMPRIMIDO — un repo hostil puede
      // meter archivos altamente compresibles que quepan en 150 MB pero se
      // expandan a varios GB al extraer, llenando el disco antes de que el
      // barrido LRU de snapshot-store corra. Pre-scan barato del índice del
      // tarball (sin escribir nada) sumando los tamaños declarados; si el
      // total DESCOMPRIMIDO excede el tope, se aborta ANTES de extraer.
      let declaredBytes = 0
      await tar.list({
        file: tmpTarPath,
        onReadEntry: (entry) => {
          declaredBytes += entry.size ?? 0
        },
      })
      if (declaredBytes > MAX_EXTRACTED_BYTES) {
        const maxMb = Math.floor(MAX_EXTRACTED_BYTES / (1024 * 1024))
        throw new ScmError(
          'UNKNOWN',
          'Repository ' +
            repo.fullName +
            ' is too large to copy locally (over ' +
            maxMb +
            ' MB uncompressed). An agentic analysis cannot be generated for this PR.',
        )
      }

      // Solo archivos y directorios: un repo hostil puede traer SYMLINKS
      // apuntando fuera del snapshot (p. ej. a `~/.ssh`), y las herramientas
      // read-only de los proveedores agénticos los seguirían al leer —
      // escaparían del jail sin "escribir" nada. Se omiten en la extracción
      // (hardlinks incluidos), no se falla: el resto del árbol sigue siendo
      // analizable.
      await tar.extract({
        file: tmpTarPath,
        cwd: destDir,
        strip: 1,
        // El tipo del filter une `Stats | ReadEntry` (node-tar lo comparte
        // con `tar.create`); en extract siempre llega `ReadEntry` (tiene
        // `type`) — cualquier otra cosa se deniega por defecto.
        filter: (_path, entry) =>
          'type' in entry && (entry.type === 'File' || entry.type === 'Directory'),
      })
    } catch (error) {
      throw mapGithubError(error, repo.fullName)
    } finally {
      await rm(tmpTarPath, { force: true })
    }
  }
}
