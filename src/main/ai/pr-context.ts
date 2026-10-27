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
