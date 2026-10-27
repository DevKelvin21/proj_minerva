/**
 * Typed error for the Azure DevOps provider. Carries a provider-neutral
 * `ScmErrorCode` so callers (IPC handlers, the UI) branch on the code instead
 * of matching message text.
 *
 * Messages are written for the user and must NEVER contain a credential:
 * no PAT, no bearer token, no `Authorization` header value.
 *
 * Extends `ScmError` so `ipc/register.ts` carries the code across IPC.
 */
import type { ScmErrorCode } from '../../../shared/scm'
import { ScmError } from '../errors'

export class AzureScmError extends ScmError {
  /** HTTP status when the error came from a REST call. */
  readonly status?: number
  /** Milliseconds the server asked us to wait (429 / 503 with `Retry-After`). */
  readonly retryAfterMs?: number

  constructor(
    code: ScmErrorCode,
    message: string,
    extra: { status?: number; retryAfterMs?: number } = {},
  ) {
    super(code, message)
    this.name = 'AzureScmError'
    if (extra.status !== undefined) this.status = extra.status
    if (extra.retryAfterMs !== undefined) this.retryAfterMs = extra.retryAfterMs
  }
}

export function isAzureScmError(error: unknown): error is AzureScmError {
  return error instanceof AzureScmError
}
