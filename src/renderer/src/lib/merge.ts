/**
 * Pure helpers for the Merge control: which strategy to preselect, and what a
 * failed merge / auto-merge means for the reviewer (by typed SCM code). Main
 * re-validates everything before writing; this only explains what came back.
 */
import type { ScmErrorCode } from '../../../shared/scm'
import { decodeScmErrorMessage } from '../../../shared/scm-errors'
import type { MergeOptions, MergeStrategy } from '../../../shared/types'

/**
 * The strategy the control starts on: the one auto-complete already uses,
 * else the first the repository allows (its usual order puts the merge
 * commit first). `null` = none allowed.
 */
export function initialStrategy(options: MergeOptions): MergeStrategy | null {
  const allowed = options.strategies.filter((item) => item.allowed).map((item) => item.strategy)
  const current = options.current?.strategy
  if (current && allowed.includes(current)) return current
  return allowed[0] ?? null
}

/**
 * Our explanation of a failed merge, by typed SCM code; the component
 * translates it (`prDetail.merge.failures.<reason>`).
 */
export type MergeFailureReason =
  | 'stale'
  | 'conflicts'
  | 'checks'
  | 'blocked'
  | 'forbidden'
  | 'signIn'
  | 'other'

export interface MergeFailure {
  code: ScmErrorCode | null
  /** Main's own text (already without the `[SCM:CODE]` marker). */
  detail: string
  reason: MergeFailureReason
  /** The PR changed behind the UI: refetch it before trying again. */
  shouldRefresh: boolean
}

export function describeMergeError(error: unknown): MergeFailure {
  const raw = error instanceof Error ? error.message : String(error)
  const { code, message } = decodeScmErrorMessage(raw)
  const failure = (reason: MergeFailureReason, shouldRefresh = false): MergeFailure => ({
    code,
    detail: message.replace(/^Error invoking remote method '[^']*': (?:\w*Error: )?/, ''),
    reason,
    shouldRefresh,
  })
  switch (code) {
    case 'CONFLICT':
      return failure('stale', true)
    case 'MERGE_CONFLICT':
      return failure('conflicts', true)
    case 'CHECKS_FAILING':
      return failure('checks', true)
    case 'MERGE_BLOCKED':
      return failure('blocked', true)
    case 'FORBIDDEN':
      return failure('forbidden')
    case 'UNAUTHENTICATED':
    case 'CLI_UNAVAILABLE':
      return failure('signIn')
    default:
      return failure('other')
  }
}
