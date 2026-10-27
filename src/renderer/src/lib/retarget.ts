/**
 * Pure helpers for the retarget flow (change a PR's target branch): branch
 * name validation for the free-text input, and the user-facing message for
 * each outcome. Main re-validates everything before writing; this only keeps
 * obvious mistakes from reaching it and explains what came back.
 */
import { shortRef, type ScmErrorCode } from '../../../shared/scm'
import { decodeScmErrorMessage } from '../../../shared/scm-errors'

/**
 * Normalizes and validates a branch name typed by the user, following the
 * parts of `git check-ref-format` that matter for a target branch. Accepts
 * `refs/heads/x` and returns the short form.
 */
export function validateBranchName(
  input: string,
): { ok: true; branch: string } | { ok: false; reason: string } {
  const branch = shortRef(input.trim())
  if (branch === '') return { ok: false, reason: 'Enter a branch name.' }
  if (/[\s~^:?*[\\]/.test(branch) || /\p{Cc}/u.test(branch)) {
    return { ok: false, reason: 'Branch names cannot contain spaces or any of ~ ^ : ? * [ \\' }
  }
  if (branch.includes('..')) return { ok: false, reason: 'Branch names cannot contain "..".' }
  if (branch.includes('@{')) return { ok: false, reason: 'Branch names cannot contain "@{".' }
  if (branch === '@') return { ok: false, reason: '"@" is not a valid branch name.' }
  if (branch.startsWith('-')) return { ok: false, reason: 'Branch names cannot start with "-".' }
  if (branch.startsWith('/') || branch.endsWith('/') || branch.includes('//')) {
    return { ok: false, reason: 'Branch names cannot start or end with "/" or contain "//".' }
  }
  if (branch.endsWith('.')) return { ok: false, reason: 'Branch names cannot end with ".".' }
  const parts = branch.split('/')
  if (parts.some((part) => part.startsWith('.') || part.endsWith('.lock'))) {
    return {
      ok: false,
      reason: 'No part of a branch name can start with "." or end with ".lock".',
    }
  }
  return { ok: true, branch }
}

/** What the UI says after a failed retarget, by typed SCM code. */
export interface RetargetFailure {
  code: ScmErrorCode | null
  /** Main's own text (already without the `[SCM:CODE]` marker). */
  detail: string
  /** Our explanation of what it means for the reviewer. */
  explanation: string
  /** The data on screen is stale: refetch stacks / PR before trying again. */
  shouldRefresh: boolean
}

export function describeRetargetError(error: unknown, newBase: string): RetargetFailure {
  const raw = error instanceof Error ? error.message : String(error)
  const { code, message } = decodeScmErrorMessage(raw)
  switch (code) {
    case 'CONFLICT':
      return {
        code,
        detail: message,
        explanation:
          'The pull request changed since this view loaded (someone may have retargeted, completed or abandoned it). The data was refreshed; check it and try again.',
        shouldRefresh: true,
      }
    case 'NOT_FOUND':
      return {
        code,
        detail: message,
        explanation: 'The branch ' + newBase + ' does not exist in this repository.',
        shouldRefresh: false,
      }
    case 'FORBIDDEN':
      return {
        code,
        detail: message,
        explanation:
          'Your credential cannot change this pull request (Azure DevOps needs the Code (Read & write) scope).',
        shouldRefresh: false,
      }
    case 'UNAUTHENTICATED':
    case 'CLI_UNAVAILABLE':
      return {
        code,
        detail: message,
        explanation: 'Sign in again from Settings, then retry.',
        shouldRefresh: false,
      }
    default:
      return {
        code,
        detail: message,
        explanation: 'The target branch was not changed.',
        shouldRefresh: false,
      }
  }
}
