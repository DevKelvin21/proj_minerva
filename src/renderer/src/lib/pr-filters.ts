/**
 * Pure grouping helper: PRs by repo, for the Home filter results. Lives
 * outside the components so they only render.
 */
import { repoKey, type RepoRef } from '../../../shared/scm'
import type { PullRequestSummary } from '../../../shared/types'

export interface RepoGroupData {
  repo: RepoRef
  pullRequests: PullRequestSummary[]
}

/** Agrupa por `repoKey` (provider-aware) preservando el orden de primera aparición de cada repo. */
export function groupByRepo(pullRequests: PullRequestSummary[]): RepoGroupData[] {
  const groups: RepoGroupData[] = []
  const indexByRepo = new Map<string, number>()

  for (const pr of pullRequests) {
    const key = repoKey(pr.repo)
    const existingIndex = indexByRepo.get(key)
    if (existingIndex === undefined) {
      indexByRepo.set(key, groups.length)
      groups.push({ repo: pr.repo, pullRequests: [pr] })
    } else {
      groups[existingIndex].pullRequests.push(pr)
    }
  }

  return groups
}
