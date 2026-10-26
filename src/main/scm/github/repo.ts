import type { GithubRepoRef, RepoRef } from '../../../shared/scm'
import { ScmError } from '../errors'

/** Narrows a `RepoRef` to the GitHub variant; any other provider is a routing bug. */
export function asGithubRepo(repo: RepoRef): GithubRepoRef {
  if (repo.provider !== 'github') {
    throw new ScmError('NOT_FOUND', 'Not a GitHub repository: ' + repo.fullName)
  }
  return repo
}
