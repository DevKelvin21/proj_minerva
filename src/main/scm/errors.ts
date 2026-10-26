/**
 * Typed SCM errors in main. Providers throw `ScmError` with a `ScmErrorCode`;
 * `ipc/register.ts` encodes the code into the message (`[SCM:CODE] ...`, see
 * `shared/scm-errors.ts`) because Electron strips custom error props over IPC.
 * Consumers branch on `code`, never on message text.
 */
import type { ScmErrorCode } from '../../shared/scm'
import { scmErrorCodeOf } from '../../shared/scm-errors'

export class ScmError extends Error {
  readonly code: ScmErrorCode

  constructor(code: ScmErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'ScmError'
    this.code = code
  }
}

export function isScmError(error: unknown): error is ScmError {
  return error instanceof ScmError
}

/** Code of an `ScmError`, or of an already-encoded message; `null` otherwise. */
export function scmCodeOf(error: unknown): ScmErrorCode | null {
  return isScmError(error) ? error.code : scmErrorCodeOf(error)
}

/** Wraps anything thrown into an `ScmError` (keeps an existing one as is). */
export function toScmError(error: unknown, fallback: ScmErrorCode = 'UNKNOWN'): ScmError {
  if (isScmError(error)) return error
  const message = error instanceof Error ? error.message : String(error)
  return new ScmError(scmErrorCodeOf(error) ?? fallback, message, { cause: error })
}
