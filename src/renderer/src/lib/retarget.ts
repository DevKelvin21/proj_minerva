/**
 * Pure helpers for the retarget flow (change a PR's target branch): branch
 * name validation for the free-text input, and the user-facing message for
 * each outcome. Main re-validates everything before writing; this only keeps
 * obvious mistakes from reaching it and explains what came back.
 */
import { shortRef, type ScmErrorCode } from '../../../shared/scm'
import { decodeScmErrorMessage } from '../../../shared/scm-errors'

/**
 * Why a typed branch name is not valid; the component translates it
 * (`stacks.retarget.branchProblems.<problem>`).
 */
export type BranchNameProblem =
  | 'empty'
  | 'invalidChars'
  | 'doubleDot'
  | 'atBrace'
  | 'at'
  | 'leadingDash'
  | 'slashes'
  | 'trailingDot'
  | 'dotOrLock'

/**
 * Normalizes and validates a branch name typed by the user, following the
 * parts of `git check-ref-format` that matter for a target branch. Accepts
 * `refs/heads/x` and returns the short form.
 */
export function validateBranchName(
  input: string,
): { ok: true; branch: string } | { ok: false; reason: BranchNameProblem } {
  const branch = shortRef(input.trim())
  if (branch === '') return { ok: false, reason: 'empty' }
  if (/[\s~^:?*[\\]/.test(branch) || /\p{Cc}/u.test(branch)) {
    return { ok: false, reason: 'invalidChars' }
  }
  if (branch.includes('..')) return { ok: false, reason: 'doubleDot' }
  if (branch.includes('@{')) return { ok: false, reason: 'atBrace' }
  if (branch === '@') return { ok: false, reason: 'at' }
  if (branch.startsWith('-')) return { ok: false, reason: 'leadingDash' }
  if (branch.startsWith('/') || branch.endsWith('/') || branch.includes('//')) {
    return { ok: false, reason: 'slashes' }
  }
  if (branch.endsWith('.')) return { ok: false, reason: 'trailingDot' }
  const parts = branch.split('/')
  if (parts.some((part) => part.startsWith('.') || part.endsWith('.lock'))) {
    return { ok: false, reason: 'dotOrLock' }
  }
  return { ok: true, branch }
}

/**
 * Our explanation of a failed retarget, by typed SCM code; the component
 * translates it (`stacks.retarget.failures.<reason>`, with `newBase`).
 */
export type RetargetFailureReason = 'conflict' | 'notFound' | 'forbidden' | 'signIn' | 'unchanged'

/** What the UI says after a failed retarget, by typed SCM code. */
export interface RetargetFailure {
  code: ScmErrorCode | null
  /** Main's own text (already without the `[SCM:CODE]` marker). */
  detail: string
  /** What it means for the reviewer (translated at render time). */
  reason: RetargetFailureReason
  /** The branch that was asked for (named by the `notFound` explanation). */
  newBase: string
  /** The data on screen is stale: refetch stacks / PR before trying again. */
  shouldRefresh: boolean
}

export function describeRetargetError(error: unknown, newBase: string): RetargetFailure {
  const raw = error instanceof Error ? error.message : String(error)
  const { code, message } = decodeScmErrorMessage(raw)
  const failure = (reason: RetargetFailureReason, shouldRefresh = false): RetargetFailure => ({
    code,
    detail: message,
    reason,
    newBase,
    shouldRefresh,
  })
  switch (code) {
    case 'CONFLICT':
      return failure('conflict', true)
    case 'NOT_FOUND':
      return failure('notFound')
    case 'FORBIDDEN':
      return failure('forbidden')
    case 'UNAUTHENTICATED':
    case 'CLI_UNAVAILABLE':
      return failure('signIn')
    default:
      return failure('unchanged')
  }
}
