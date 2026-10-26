import type { PrContextSource } from '../ai/pr-context'
import type { ScmRegistry } from './registry'
import { ensureSnapshot } from './snapshot-store'

/** `PrContextSource` for the AI layer, resolving the provider per repo. */
export function createPrContextSource(registry: ScmRegistry): PrContextSource {
  return {
    getDetail: (repo, number) => registry.forRepo(repo).getPullRequestDetail(repo, number),
    getFiles: (repo, number) => registry.forRepo(repo).getPullRequestFiles(repo, number),
    ensureSnapshot: (repo, headSha) => ensureSnapshot(registry.forRepo(repo), repo, headSha),
  }
}
