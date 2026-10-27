/**
 * Runtime guards for SCM shapes that cross a trust boundary: IPC payloads
 * (`main/ipc/validators.ts`) and the detached didactic window's URL hash
 * (`./didactic-route.ts`). Same rules in both places, so they live here.
 */
import type { AzureRepoRef, GithubRepoRef, RepoRef } from './scm'

export const MAX_REPO_FIELD_LEN = 200
/** `organization/project/name` can be longer than any single field. */
export const MAX_REPO_FULL_NAME_LEN = 3 * MAX_REPO_FIELD_LEN + 2

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(value)
  return own.length === keys.length && own.every((key) => keys.includes(key))
}

function isBoundedString(value: unknown, maxLen: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLen
}

const GITHUB_KEYS = ['provider', 'owner', 'name', 'fullName'] as const
const AZURE_KEYS = [
  'provider',
  'organization',
  'project',
  'name',
  'repositoryId',
  'fullName',
] as const

export function isGithubRepoRef(value: unknown): value is GithubRepoRef {
  if (!isPlainObject(value) || value.provider !== 'github') return false
  if (!hasExactKeys(value, GITHUB_KEYS)) return false
  return (
    isBoundedString(value.owner, MAX_REPO_FIELD_LEN) &&
    isBoundedString(value.name, MAX_REPO_FIELD_LEN) &&
    isBoundedString(value.fullName, MAX_REPO_FULL_NAME_LEN)
  )
}

/** Azure repository ids are GUIDs (`8-4-4-4-12` hex). */
export const AZURE_GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * One URL path segment of an Azure REST URL (org, project, repo name): not
 * `.`/`..` (a URL parser would resolve them and move the request elsewhere),
 * no `/` `\\` or control characters.
 */
export function isSafeAzureSegment(value: unknown, maxLen = MAX_REPO_FIELD_LEN): value is string {
  if (!isBoundedString(value, maxLen) || value === '.' || value === '..') return false
  // eslint-disable-next-line no-control-regex
  return !/[\x00-\x1f\x7f/\\]/.test(value)
}

export function isAzureRepoRef(value: unknown): value is AzureRepoRef {
  if (!isPlainObject(value) || value.provider !== 'azure') return false
  if (!hasExactKeys(value, AZURE_KEYS)) return false
  return (
    isSafeAzureSegment(value.organization) &&
    isSafeAzureSegment(value.project) &&
    isSafeAzureSegment(value.name) &&
    typeof value.repositoryId === 'string' &&
    AZURE_GUID_RE.test(value.repositoryId) &&
    isBoundedString(value.fullName, MAX_REPO_FULL_NAME_LEN)
  )
}

/** Strict: exact key set per variant, non-empty bounded strings. */
export function isRepoRef(value: unknown): value is RepoRef {
  return isGithubRepoRef(value) || isAzureRepoRef(value)
}

/** Builds a GitHub `RepoRef` with its derived `fullName`. */
export function githubRepo(owner: string, name: string): GithubRepoRef {
  return { provider: 'github', owner, name, fullName: owner + '/' + name }
}

export const MAX_BRANCH_NAME_LEN = 250

/**
 * A short git branch name (`feature/x`, never `refs/heads/feature/x`), per
 * `git check-ref-format --branch` rules: no spaces or control characters, no
 * `~ ^ : ? * [ \`, no `..` or `@{`, no empty / dot-leading components, does
 * not start with `-` or end with `/`, `.` or `.lock`.
 */
export function isValidBranchName(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_BRANCH_NAME_LEN) {
    return false
  }
  if (value.startsWith('refs/') || value.startsWith('-') || value === '@') return false
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x20\x7f~^:?*[\\]/.test(value)) return false
  if (value.includes('..') || value.includes('@{') || value.includes('//')) return false
  if (value.endsWith('/') || value.endsWith('.') || value.endsWith('.lock')) return false
  return value.split('/').every((part) => part.length > 0 && !part.startsWith('.'))
}

/** Azure DevOps organization name: letters, digits and hyphens, 1-50, no leading/trailing hyphen. */
export function isAzureOrganizationName(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,48}[A-Za-z0-9])?$/.test(value)
}

/**
 * Azure DevOps project name: 1-64 characters, none of the reserved
 * `\ / : * ? " < > | ; # $ { } , + = [ ]` or control characters, not
 * starting with `_` or `.`, not ending with `.`.
 */
export function isAzureProjectName(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64) return false
  if (value.trim() !== value) return false
  if (value.startsWith('_') || value.startsWith('.') || value.endsWith('.')) return false
  // eslint-disable-next-line no-control-regex
  return !/[\x00-\x1f\x7f\\/:*?"<>|;#${},+=[\]]/.test(value)
}

export const MAX_AZURE_ORGANIZATIONS = 5
export const MAX_AZURE_PROJECTS_PER_ORG = 30
