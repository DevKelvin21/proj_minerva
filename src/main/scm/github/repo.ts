import type { GithubRepoRef, RepoRef } from '../../../shared/scm'
import { githubRepo } from '../../../shared/scm-guards'
import { ScmError } from '../errors'
import { mt } from '../../i18n'

/** A GitHub owner or repository name: one URL path segment, never `.` or `..`. */
const GITHUB_SEGMENT_RE = /^[A-Za-z0-9._-]+$/

function isGithubSegment(value: string): boolean {
  return GITHUB_SEGMENT_RE.test(value) && value !== '.' && value !== '..'
}

/**
 * Narrows a `RepoRef` to the GitHub variant; any other provider is a routing
 * bug. The result is REBUILT from `owner`/`name`: the renderer's `fullName`
 * is never trusted, so what main shows (confirm dialogs, errors) is always
 * the repository it actually reads and writes.
 */
export function asGithubRepo(repo: RepoRef): GithubRepoRef {
  if (repo.provider !== 'github') {
    throw new ScmError('NOT_FOUND', mt('github.notGithubRepo', { repo: repo.fullName }))
  }
  if (!isGithubSegment(repo.owner) || !isGithubSegment(repo.name)) {
    throw new ScmError('NOT_FOUND', mt('github.notGithubRepo', { repo: repo.fullName }))
  }
  return githubRepo(repo.owner, repo.name)
}
