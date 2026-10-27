import type { GithubRepoRef, RepoRef } from '../../../shared/scm'
import { ScmError } from '../errors'
import { mt } from '../../i18n'

/** Narrows a `RepoRef` to the GitHub variant; any other provider is a routing bug. */
export function asGithubRepo(repo: RepoRef): GithubRepoRef {
  if (repo.provider !== 'github') {
    throw new ScmError('NOT_FOUND', mt('github.notGithubRepo', { repo: repo.fullName }))
  }
  return repo
}
