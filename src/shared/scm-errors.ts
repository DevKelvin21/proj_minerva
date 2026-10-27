/**
 * Typed SCM error codes across IPC.
 *
 * Electron only carries `message` when a handler rejects (custom error props
 * are stripped), so main encodes the code as a message prefix
 * `[SCM:CODE] human text` and the renderer parses it back. Never match on the
 * human text; match on the code.
 */
import type { ScmErrorCode } from './scm'

export const SCM_ERROR_CODES: readonly ScmErrorCode[] = [
  'UNAUTHENTICATED',
  'CLI_UNAVAILABLE',
  'RATE_LIMITED',
  'NOT_FOUND',
  'FORBIDDEN',
  'CONFLICT',
  'NETWORK',
  'UNKNOWN',
]

const MARKER_RE = /\[SCM:([A-Z_]+)\]\s?/

export function isScmErrorCode(value: unknown): value is ScmErrorCode {
  return typeof value === 'string' && (SCM_ERROR_CODES as readonly string[]).includes(value)
}

/** `[SCM:CODE] message` — the wire format of an SCM error. */
export function encodeScmErrorMessage(code: ScmErrorCode, message: string): string {
  return '[SCM:' + code + '] ' + message
}

export interface DecodedScmError {
  /** `null` when the message carries no (known) SCM marker. */
  code: ScmErrorCode | null
  /** Display text, without Electron's "Error invoking remote method" wrapper or the marker. */
  message: string
}

/**
 * Parses a message produced by `encodeScmErrorMessage`, also when Electron
 * wrapped it (`Error invoking remote method 'scm:x': Error: [SCM:CODE] ...`).
 */
export function decodeScmErrorMessage(message: string): DecodedScmError {
  const match = MARKER_RE.exec(message)
  if (!match || !isScmErrorCode(match[1])) return { code: null, message }
  return { code: match[1], message: message.slice(match.index + match[0].length) }
}

/** Code carried by any thrown value (an `Error` whose message has the marker), or `null`. */
export function scmErrorCodeOf(error: unknown): ScmErrorCode | null {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  return decodeScmErrorMessage(message).code
}
