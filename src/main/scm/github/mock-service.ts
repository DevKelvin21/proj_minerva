/**
 * Mock GitHub data source (`MINERVA_MOCK=1`). Vive enteramente en memoria del
 * proceso `main`: se inicializa desde `./fixtures.ts` y muta su propio estado
 * (p. ej. `postComment` agrega comentarios) mientras el proceso viva.
 *
 * Simula latencia de red (150-400ms, fija por método, no aleatoria) para que
 * la UI ejercite sus estados de carga de forma reproducible.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, sep } from 'node:path'
import type {
  CommentThread,
  DiffFile,
  PostCommentRequest,
  PrComment,
  PullRequestDetail,
  PullRequestSummary,
} from '../../../shared/types'
import { prKey, type GithubRepoRef, type RepoRef } from '../../../shared/scm'
import { ScmError } from '../errors'
import type { ListPullRequestsQuery, ScmDataSource, SnapshotRequest } from '../provider'
import { prFixtures } from './fixtures'
import { genericSnapshotFixture, snapshotFixturesByRepo } from './fixtures-snapshot'
import { asGithubRepo } from './repo'

interface PrRecord {
  detail: PullRequestDetail
  files: DiffFile[]
  threads: CommentThread[]
}

/** Latencia simulada por método (ms), determinística — dentro del rango 150-400ms. */
const LATENCY_MS = {
  listPullRequests: 220,
  getPullRequestDetail: 180,
  getPullRequestFiles: 260,
  getCommentThreads: 200,
  postComment: 320,
} as const

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function notFoundError(repo: RepoRef, number: number): ScmError {
  return new ScmError('NOT_FOUND', `Pull request not found: ${repo.fullName}#${number}`)
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
    // Copia shallow por PR: el servicio real construye objetos frescos en cada
    // fetch, y consumidores como el watcher (`pr-watcher.ts`) dependen de eso —
    // su snapshot guarda lo devuelto acá, y si fuera el MISMO objeto que muta
    // `postComment` (commentCount += 1), el diff entre ticks nunca vería nada.
    const all: PullRequestSummary[] = [...this.records.values()].map((record) => ({
      ...record.detail,
    }))
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
    }

    if (req.threadId) {
      const thread = record.threads.find((t) => t.id === req.threadId)
      if (!thread) throw new ScmError('NOT_FOUND', `Comment thread not found: ${req.threadId}`)
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
