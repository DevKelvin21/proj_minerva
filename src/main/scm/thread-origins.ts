/**
 * Commits main itself reported as thread origins (`CommentThread.origin`),
 * per PR. `scm:getFileContent` takes a renderer-supplied `commit`, and main
 * must never read an arbitrary ref: a provider accepts it only when it is one
 * of these (or one of the PR's own commits/iterations, checked by the
 * provider). Small LRU by PR, in memory only.
 */
import { prKey, type RepoRef } from '../../shared/scm'
import type { CommentThread } from '../../shared/types'

/** A full commit SHA (40 hex), the only shape a thread origin may carry. */
export const FULL_COMMIT_SHA_RE = /^[0-9a-f]{40}$/i

const MAX_PRS = 50

export class ThreadOriginCommits {
  private readonly byPr = new Map<string, Set<string>>()

  constructor(private readonly maxPrs = MAX_PRS) {}

  /** Remembers every origin commit of `threads` (adds; a later push keeps the old ones). */
  record(repo: RepoRef, number: number, threads: readonly CommentThread[]): void {
    const commits = threads
      .map((thread) => thread.origin?.commit)
      .filter((commit): commit is string => !!commit && FULL_COMMIT_SHA_RE.test(commit))
    if (commits.length === 0) return
    const key = prKey(repo, number)
    const set = this.byPr.get(key) ?? new Set<string>()
    this.byPr.delete(key)
    for (const commit of commits) set.add(commit.toLowerCase())
    this.byPr.set(key, set)
    while (this.byPr.size > this.maxPrs) {
      const oldest = this.byPr.keys().next().value
      if (oldest === undefined) break
      this.byPr.delete(oldest)
    }
  }

  has(repo: RepoRef, number: number, commit: string): boolean {
    return this.byPr.get(prKey(repo, number))?.has(commit.toLowerCase()) ?? false
  }
}
