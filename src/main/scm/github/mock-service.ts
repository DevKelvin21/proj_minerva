/**
 * Mock GitHub data source (`MINERVA_MOCK=1`). Vive enteramente en memoria del
 * proceso `main`: se inicializa desde `./fixtures.ts` y muta su propio estado
 * (p. ej. `postComment` agrega comentarios) mientras el proceso viva.
 *
 * Simula latencia de red (150-400ms, fija por método, no aleatoria) para que
 * la UI ejercite sus estados de carga de forma reproducible.
 *
 * Summaries carry `labels`, `reviewers` and `viewer`, computed against the
 * mock "me" (`MOCK_GITHUB_LOGIN`) with the real provider's rule (a reviewer
 * entry = `required`; GitHub has no optional reviewers).
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, sep } from 'node:path'
import type {
  CommentThread,
  DiffFile,
  FileContentRequest,
  MergeOptions,
  PostCommentRequest,
  PrComment,
  PrViewerRelation,
  PullRequestDetail,
  PullRequestSummary,
  SetThreadStatusRequest,
} from '../../../shared/types'
import {
  isThreadOpen,
  prKey,
  sameRepo,
  shortRef,
  type FileContent,
  type GithubRepoRef,
  type RepoRef,
} from '../../../shared/scm'
import { ScmError } from '../errors'
import { mt } from '../../i18n'
import type {
  AutoMergeWrite,
  ListPullRequestsQuery,
  MergeWrite,
  MergeWriteResult,
  ScmDataSource,
  ScopePullRequest,
  SnapshotRequest,
} from '../provider'
import type { StackInputPr } from '../stacks'
import { MOCK_GITHUB_LOGIN, prFixtures } from './fixtures'
import { genericSnapshotFixture, snapshotFixturesByRepo } from './fixtures-snapshot'
import { asGithubRepo } from './repo'
import { mapGithubMergeOptions, type GithubMergeNode } from './merge-options'
import { githubRepo } from '../../../shared/scm-guards'

/**
 * Repository merge settings of the mock universe (GitHub's "Pull Requests"
 * settings), so every Merge control state shows up somewhere:
 * - api: every method, auto-merge allowed (#482 merges now, #479 waits for
 *   checks and offers auto-merge);
 * - web: no rebase, auto-merge off (#190 conflicts, #198 is a draft);
 * - checkout-service: merged branches are deleted by the repository (#77 has
 *   a failing required check).
 */
const MOCK_REPO_MERGE_SETTINGS: Record<string, GithubMergeNode['repository']> = {
  'shopwave/api': {
    mergeCommitAllowed: true,
    squashMergeAllowed: true,
    rebaseMergeAllowed: true,
    autoMergeAllowed: true,
    deleteBranchOnMerge: false,
    viewerPermission: 'WRITE',
  },
  'shopwave/web': {
    mergeCommitAllowed: true,
    squashMergeAllowed: true,
    rebaseMergeAllowed: false,
    autoMergeAllowed: false,
    deleteBranchOnMerge: false,
    viewerPermission: 'WRITE',
  },
  'shopwave/checkout-service': {
    mergeCommitAllowed: true,
    squashMergeAllowed: true,
    rebaseMergeAllowed: true,
    autoMergeAllowed: true,
    deleteBranchOnMerge: true,
    viewerPermission: 'WRITE',
  },
}

/** PRs whose branch conflicts with its base (`prKey`). */
const MOCK_CONFLICTING = new Set(['github:shopwave/web#190'])

const MOCK_CHECKS_STATE: Record<string, string> = {
  success: 'SUCCESS',
  failure: 'FAILURE',
  pending: 'PENDING',
}

interface PrRecord {
  detail: PullRequestDetail
  files: DiffFile[]
  threads: CommentThread[]
}

/** Ids of the scripted incoming comment (`simulateIncomingComment`). */
const INCOMING_THREAD_ID = 'thread-482-incoming'
const INCOMING_COMMENT_ID = 'c-482-incoming'

/** Latencia simulada por método (ms), determinística — dentro del rango 150-400ms. */
const LATENCY_MS = {
  listPullRequests: 220,
  getPullRequestDetail: 180,
  getPullRequestFiles: 260,
  getCommentThreads: 200,
  postComment: 320,
  merge: 400,
} as const

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function notFoundError(repo: RepoRef, number: number): ScmError {
  return new ScmError('NOT_FOUND', mt('scm.prNotFound', { repo: repo.fullName, number }))
}

/**
 * URL estilo github.com para un comentario mock, con el mismo formato de ancla
 * que la API real (`#discussion_r…` para hilos de línea, `#issuecomment-…`
 * para generales). Las fixtures no la traen: se sella aquí al hidratar.
 */
function mockCommentUrl(
  repo: GithubRepoRef,
  prNumber: number,
  commentId: string,
  isLineThread: boolean,
): string {
  const anchor = isLineThread ? `discussion_r${commentId}` : `issuecomment-${commentId}`
  return `https://github.com/${repo.fullName}/pull/${prNumber}#${anchor}`
}

function mockViewer(detail: PullRequestDetail): PrViewerRelation {
  const me = MOCK_GITHUB_LOGIN.toLowerCase()
  const isAuthor = detail.author.login.toLowerCase() === me
  const entry = detail.reviewers.find((reviewer) => reviewer.user.login.toLowerCase() === me)
  if (!entry || isAuthor) return { isAuthor, reviewer: null }
  return { isAuthor, reviewer: 'required', vote: entry.vote }
}

/**
 * A fresh summary of a record (detail-only fields dropped). Fresh on purpose:
 * the real service builds new objects on every fetch, and consumers such as
 * the watcher (`pr-watcher.ts`) keep what they get; if it were the SAME object
 * `postComment` mutates (commentCount += 1), the diff between ticks would
 * never see a thing.
 */
function toSummary(detail: PullRequestDetail): PullRequestSummary {
  return {
    id: detail.id,
    number: detail.number,
    title: detail.title,
    author: detail.author,
    repo: detail.repo,
    state: detail.state,
    isDraft: detail.isDraft,
    createdAt: detail.createdAt,
    updatedAt: detail.updatedAt,
    headRef: detail.headRef,
    baseRef: detail.baseRef,
    headSha: detail.headSha,
    webUrl: detail.webUrl,
    commentCount: detail.commentCount,
    reviewDecision: detail.reviewDecision,
    ciStatus: detail.ciStatus,
    additions: detail.additions,
    deletions: detail.deletions,
    changedFiles: detail.changedFiles,
    labels: detail.labels.map((label) => ({ ...label })),
    reviewers: detail.reviewers.map((entry) => ({ ...entry })),
    viewer: mockViewer(detail),
  }
}

export class MockGithubService implements ScmDataSource {
  private readonly records = new Map<string, PrRecord>()
  private nextCommentSeq = 1000

  constructor() {
    for (const fixture of prFixtures) {
      const { detail } = fixture
      this.records.set(prKey(detail.repo, detail.number), {
        detail: { ...detail },
        files: fixture.files.map((file) => ({ ...file })),
        threads: fixture.threads.map((thread) => ({
          ...thread,
          comments: thread.comments.map((comment) => ({
            ...comment,
            htmlUrl: mockCommentUrl(
              asGithubRepo(detail.repo),
              detail.number,
              comment.id,
              thread.isLineThread,
            ),
            // Same meaning as the real `viewerDidAuthor`.
            ...(comment.author.login === MOCK_GITHUB_LOGIN ? { isViewer: true } : {}),
          })),
        })),
      })
    }
  }

  private getRecord(repo: RepoRef, number: number): PrRecord {
    asGithubRepo(repo)
    const record = this.records.get(prKey(repo, number))
    if (!record) throw notFoundError(repo, number)
    return record
  }

  async listPullRequests(req: ListPullRequestsQuery): Promise<PullRequestSummary[]> {
    await delay(LATENCY_MS.listPullRequests)
    const all: PullRequestSummary[] = [...this.records.values()].map((record) =>
      toSummary(record.detail),
    )
    // Filtro de estado (T51, F10): default 'open' (comportamiento previo).
    // 'closed' incluye tanto `closed` como `merged` — la UI distingue con un
    // badge (ver `PrListItem.tsx`); 'all' no filtra por estado.
    const state = req.state ?? 'open'
    const byState = all.filter((pr) => {
      if (state === 'all') return true
      if (state === 'closed') return pr.state === 'closed' || pr.state === 'merged'
      return pr.state === 'open'
    })
    const query = req.search?.trim().toLowerCase()
    if (!query) return byState
    return byState.filter(
      (pr) =>
        pr.title.toLowerCase().includes(query) || pr.repo.fullName.toLowerCase().includes(query),
    )
  }

  async getPullRequestDetail(repo: RepoRef, number: number): Promise<PullRequestDetail> {
    await delay(LATENCY_MS.getPullRequestDetail)
    return this.getRecord(repo, number).detail
  }

  async getPullRequestFiles(repo: RepoRef, number: number): Promise<DiffFile[]> {
    await delay(LATENCY_MS.getPullRequestFiles)
    return this.getRecord(repo, number).files
  }

  async getCommentThreads(repo: RepoRef, number: number): Promise<CommentThread[]> {
    await delay(LATENCY_MS.getCommentThreads)
    return this.getRecord(repo, number).threads
  }

  async postComment(req: PostCommentRequest): Promise<PrComment> {
    await delay(LATENCY_MS.postComment)
    const record = this.getRecord(req.repo, req.number)
    const repo = asGithubRepo(req.repo)

    const commentId = `c-mock-${this.nextCommentSeq}`
    const comment: PrComment = {
      id: commentId,
      author: { login: 'edygg' },
      bodyMarkdown: req.bodyMarkdown,
      createdAt: new Date().toISOString(),
      isMinimized: false,
      isViewer: true,
    }

    if (req.threadId) {
      const thread = record.threads.find((t) => t.id === req.threadId)
      if (!thread) throw new ScmError('NOT_FOUND', mt('scm.threadNotFound', { id: req.threadId }))
      comment.htmlUrl = mockCommentUrl(repo, req.number, commentId, thread.isLineThread)
      thread.comments.push(comment)
    } else {
      comment.htmlUrl = mockCommentUrl(repo, req.number, commentId, Boolean(req.path))
      record.threads.push({
        id: `thread-mock-${this.nextCommentSeq}`,
        status: 'active',
        isResolved: false,
        isLineThread: Boolean(req.path),
        path: req.path,
        line: req.line,
        side: req.side,
        comments: [comment],
      })
    }
    this.nextCommentSeq += 1
    record.detail.commentCount = (record.detail.commentCount ?? 0) + 1

    return comment
  }

  /**
   * A reviewer (`jrivas`) opens a new line thread on "my" api#482 and the PR's
   * `updatedAt` moves, like on github.com. Driven by
   * `MINERVA_MOCK_INCOMING_COMMENT_MS` (`../mock-mode.ts`); runs once.
   * Returns `false` when it already ran (or the fixture is gone).
   */
  simulateIncomingComment(now: Date = new Date()): boolean {
    const record = this.records.get(prKey(githubRepo('shopwave', 'api'), 482))
    if (!record || record.threads.some((thread) => thread.id === INCOMING_THREAD_ID)) return false
    const repo = asGithubRepo(record.detail.repo)
    const createdAt = now.toISOString()
    record.threads.push({
      id: INCOMING_THREAD_ID,
      status: 'active',
      isResolved: false,
      isLineThread: true,
      path: 'src/routes/carts.ts',
      line: 26,
      side: 'RIGHT',
      comments: [
        {
          id: INCOMING_COMMENT_ID,
          author: {
            login: 'jrivas',
            avatarUrl: 'https://avatars.githubusercontent.com/u/1002?v=4',
          },
          bodyMarkdown: 'Should this retry on 409, or is a 409 final for the client?',
          createdAt,
          isMinimized: false,
          htmlUrl: mockCommentUrl(repo, 482, INCOMING_COMMENT_ID, true),
        },
      ],
    })
    // Review comments do not count in GitHub's `comments.totalCount`: only `updatedAt` moves.
    record.detail = { ...record.detail, updatedAt: createdAt }
    return true
  }

  /**
   * `dkumar`, the required reviewer of "my" api#482, requests changes, like a
   * review submitted on github.com (`MINERVA_MOCK_INCOMING_REVIEW_MS`).
   * Returns `false` when it already ran.
   */
  simulateIncomingReview(now: Date = new Date()): boolean {
    const record = this.records.get(prKey(githubRepo('shopwave', 'api'), 482))
    const entry = record?.detail.reviewers.find((reviewer) => reviewer.user.login === 'dkumar')
    if (!record || !entry || entry.vote === 'changes_requested') return false
    record.detail = {
      ...record.detail,
      updatedAt: now.toISOString(),
      reviewDecision: 'changes_requested',
      reviewers: record.detail.reviewers.map((reviewer) =>
        reviewer === entry ? { ...reviewer, vote: 'changes_requested' } : reviewer,
      ),
    }
    return true
  }

  async setThreadStatus(req: SetThreadStatusRequest): Promise<CommentThread> {
    await delay(LATENCY_MS.postComment)
    const record = this.getRecord(req.repo, req.number)
    const thread = record.threads.find((t) => t.id === req.threadId)
    if (!thread || !thread.isLineThread) {
      throw new ScmError('NOT_FOUND', mt('scm.threadNotFound', { id: req.threadId }))
    }
    thread.status = req.status
    thread.isResolved = !isThreadOpen(req.status)
    return { ...thread, comments: [...thread.comments] }
  }

  /**
   * Head side: the file from the snapshot fixture. Base side: the same text
   * (the fixtures carry no separate base tree), except for added files,
   * which do not exist there. Good enough for the demo's context excerpts.
   */
  async getFileContent(req: FileContentRequest): Promise<FileContent> {
    await delay(LATENCY_MS.getPullRequestDetail)
    const record = this.getRecord(req.repo, req.number)
    const diffFile = record.files.find((file) => file.path === req.path)
    if (req.side === 'base' && diffFile?.status === 'added') {
      throw new ScmError('NOT_FOUND', mt('github.mockMissingAtBase', { path: req.path }))
    }
    if (req.side === 'head' && diffFile?.status === 'removed') {
      throw new ScmError('NOT_FOUND', mt('github.mockMissingAtHead', { path: req.path }))
    }
    const files = snapshotFixturesByRepo[req.repo.fullName] ?? genericSnapshotFixture
    const file = files.find((entry) => entry.path === req.path)
    if (!file) throw new ScmError('NOT_FOUND', mt('github.mockFileNotFound', { path: req.path }))
    return { content: file.content, isBinary: false, tooLarge: false }
  }

  private branchesOf(repo: RepoRef): Set<string> {
    const branches = new Set<string>(['main'])
    for (const record of this.records.values()) {
      if (!sameRepo(record.detail.repo, repo)) continue
      branches.add(record.detail.headRef)
      branches.add(record.detail.baseRef)
    }
    return branches
  }

  async branchExists(repo: RepoRef, branch: string): Promise<boolean> {
    asGithubRepo(repo)
    return this.branchesOf(repo).has(shortRef(branch))
  }

  async updatePullRequestBase(
    repo: RepoRef,
    number: number,
    newBase: string,
  ): Promise<PullRequestSummary> {
    await delay(LATENCY_MS.postComment)
    const record = this.getRecord(repo, number)
    record.detail.baseRef = shortRef(newBase)
    record.detail.updatedAt = new Date().toISOString()
    return { ...record.detail }
  }

  /** The same GitHub facts the real query reads, built from the fixtures. */
  private mergeNode(record: PrRecord): GithubMergeNode {
    const { detail } = record
    const key = prKey(detail.repo, detail.number)
    const repository = MOCK_REPO_MERGE_SETTINGS[detail.repo.fullName] ?? {
      mergeCommitAllowed: true,
      squashMergeAllowed: true,
      rebaseMergeAllowed: true,
      autoMergeAllowed: false,
      deleteBranchOnMerge: false,
      viewerPermission: 'WRITE',
    }
    const mergeStateStatus = detail.isDraft
      ? 'DRAFT'
      : MOCK_CONFLICTING.has(key)
        ? 'DIRTY'
        : detail.ciStatus === 'failure' || detail.ciStatus === 'pending'
          ? 'BLOCKED'
          : 'CLEAN'
    return {
      repository,
      pullRequest: {
        state: detail.state === 'open' ? 'OPEN' : detail.state === 'merged' ? 'MERGED' : 'CLOSED',
        isDraft: detail.isDraft,
        headRefOid: detail.headSha,
        isCrossRepository: false,
        mergeable: MOCK_CONFLICTING.has(key) ? 'CONFLICTING' : 'MERGEABLE',
        mergeStateStatus,
        reviewDecision: null,
        viewerCanEnableAutoMerge: true,
        autoMergeRequest: detail.autoComplete
          ? {
              mergeMethod: (detail.autoComplete.strategy ?? 'merge').toUpperCase(),
              enabledBy: { login: detail.autoComplete.setBy.login },
            }
          : null,
        checksState: detail.ciStatus ? (MOCK_CHECKS_STATE[detail.ciStatus] ?? null) : null,
      },
    }
  }

  async getMergeOptions(repo: RepoRef, number: number): Promise<MergeOptions> {
    await delay(LATENCY_MS.getPullRequestDetail)
    return mapGithubMergeOptions(this.mergeNode(this.getRecord(repo, number)))
  }

  /** Merges in memory: the PR becomes `merged` (no branch to delete in the mock). */
  async mergePullRequest(req: MergeWrite): Promise<MergeWriteResult> {
    await delay(LATENCY_MS.merge)
    const record = this.getRecord(req.repo, req.number)
    if (record.detail.headSha !== req.headSha) {
      throw new ScmError('CONFLICT', mt('github.mergeHeadMoved'))
    }
    record.detail.state = 'merged'
    record.detail.updatedAt = new Date().toISOString()
    delete record.detail.autoComplete
    return { completed: true }
  }

  async setAutoMerge(req: AutoMergeWrite): Promise<void> {
    await delay(LATENCY_MS.merge)
    const record = this.getRecord(req.repo, req.number)
    if (!req.enable) {
      delete record.detail.autoComplete
      return
    }
    if (record.detail.headSha !== req.headSha) {
      throw new ScmError('CONFLICT', mt('github.mergeHeadMoved'))
    }
    record.detail.autoComplete = { setBy: { login: MOCK_GITHUB_LOGIN }, strategy: req.strategy }
    record.detail.updatedAt = new Date().toISOString()
  }

  /** The mock scope is the whole universe: every open PR. */
  async listScopePullRequests(): Promise<ScopePullRequest[]> {
    await delay(LATENCY_MS.listPullRequests)
    return [...this.records.values()]
      .filter((record) => record.detail.state === 'open')
      .map(({ detail }) => ({ summary: toSummary(detail) }))
  }

  async listMergedBySourceBranch(repo: RepoRef, branch: string): Promise<StackInputPr[]> {
    asGithubRepo(repo)
    return [...this.records.values()]
      .filter(
        ({ detail }) =>
          detail.state === 'merged' &&
          sameRepo(detail.repo, repo) &&
          detail.headRef === shortRef(branch),
      )
      .map(({ detail }) => ({
        repo: detail.repo,
        number: detail.number,
        title: detail.title,
        headRef: detail.headRef,
        baseRef: detail.baseRef,
        state: 'merged' as const,
        isDraft: detail.isDraft,
        mergedInto: detail.baseRef,
        createdAt: detail.createdAt,
        closedAt: detail.updatedAt,
      }))
  }

  /**
   * Mock de `writeSnapshot` (T54): en vez de bajar y extraer un tarball real,
   * escribe con `fs` el árbol fixture del repo (`./fixtures-snapshot.ts`) —
   * `headSha` se ignora (el fixture no varía por commit, igual que el resto
   * del mock no varía por SHA real).
   */
  async writeSnapshot(req: SnapshotRequest, destDir: string): Promise<void> {
    await delay(LATENCY_MS.getPullRequestFiles)
    const files = snapshotFixturesByRepo[req.repo.fullName] ?? genericSnapshotFixture
    for (const file of files) {
      // Las rutas de fixture usan siempre '/'; se traducen al separador real
      // del SO antes de unir con `destDir` (relevante solo fuera de POSIX).
      const relativePath = sep === '/' ? file.path : file.path.split('/').join(sep)
      const absolutePath = join(destDir, relativePath)
      await mkdir(dirname(absolutePath), { recursive: true })
      await writeFile(absolutePath, file.content, 'utf-8')
    }
  }
}
