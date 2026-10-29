/**
 * The only thing the AI layer needs from source control: the PR's metadata,
 * its files (unified patches) and a local snapshot directory at a commit.
 * Backed by the SCM registry in production (`../scm/pr-context-source.ts`);
 * AI code never sees a provider or a token.
 */
import type { RepoRef } from '../../shared/scm'
import type { DiffFile, PullRequestDetail } from '../../shared/types'

export interface PrContextSource {
  getDetail(repo: RepoRef, number: number): Promise<PullRequestDetail>
  getFiles(repo: RepoRef, number: number): Promise<DiffFile[]>
  /** Path of a read-only copy of the repo at `headSha` (cached on disk). */
  ensureSnapshot(repo: RepoRef, headSha: string): Promise<string>
}

/**
 * `source` that says where a run is: `loading` when the AI layer starts
 * reading the PR (details, files, snapshot), `waiting` once the snapshot is
 * ready and the model has the PR to explore. Used by the side-panel chat to
 * show what an answer is doing before its first words.
 */
export function reportingPrContext(
  source: PrContextSource,
  report: (stage: 'loading' | 'waiting') => void,
): PrContextSource {
  return {
    getDetail: (repo, number) => {
      report('loading')
      return source.getDetail(repo, number)
    },
    getFiles: (repo, number) => {
      report('loading')
      return source.getFiles(repo, number)
    },
    ensureSnapshot: async (repo, headSha) => {
      report('loading')
      const dir = await source.ensureSnapshot(repo, headSha)
      report('waiting')
      return dir
    },
  }
}
