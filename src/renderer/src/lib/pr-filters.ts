/**
 * Helper puro de agrupación para la lista de PRs. Vive fuera de los
 * componentes para que `Sidebar`/`RepoGroup` se limiten a renderizar.
 *
 * El filtrado por `search` ya no ocurre acá: desde T4 se pide a `main` vía
 * `scm:listPullRequests({ search })` (ver `hooks/use-pull-requests.ts`).
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
