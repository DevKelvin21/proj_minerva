import { mt } from '../i18n'

/**
 * Turns ANY updater failure into the single short line that crosses IPC as
 * `UpdaterStatus.message` (`shared/types.ts`) and lands verbatim in
 * Settings → Updates.
 *
 * `electron-updater` errors are not display text: `builder-util-runtime`'s
 * `HttpError.message` is `"404 Not Found\nHeaders: {…}"` and the GitHub
 * provider wraps it as `"Cannot find latest-mac.yml in the latest release
 * artifacts (<url>): HttpError: 404 … <stack trace>"`. Showing that in the UI
 * (seen in v0.8.1 on macOS) is noise at best and leaks response headers at
 * worst. Rules, in order:
 * 1. Known `electron-updater` error codes (`newError(message, code)` sets
 *    `error.code`) map to a translated sentence — the code is stable API,
 *    the message text is not.
 * 2. Any other `HttpError` (it carries `statusCode`) becomes "HTTP <status>".
 * 3. Otherwise the FIRST line of `error.message`, trimmed and capped — no
 *    headers, no stack, no XML dump (`ERR_UPDATER_INVALID_RELEASE_FEED`
 *    appends the whole feed after a newline).
 * Pure module (no `electron`), so the mock engine and the unit tests share it.
 */

export const MAX_MESSAGE_LENGTH = 200

/** `latest.yml` / `latest-mac.yml` / `latest-linux-arm64.yml` … — the only shape a channel file name can take. */
const CHANNEL_FILE_RE = /\blatest(?:-[a-z0-9]+)*\.yml\b/i

interface ErrorLike {
  message?: unknown
  code?: unknown
  statusCode?: unknown
}

function asErrorLike(error: unknown): ErrorLike {
  if (typeof error === 'object' && error !== null) return error as ErrorLike
  return {}
}

export function updaterErrorMessage(error: unknown): string {
  const info = asErrorLike(error)
  const rawMessage =
    typeof info.message === 'string' ? info.message : typeof error === 'string' ? error : ''

  switch (info.code) {
    case 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND': {
      const file = CHANNEL_FILE_RE.exec(rawMessage)?.[0] ?? 'latest.yml'
      return mt('updater.manifestMissing', { file })
    }
    case 'ERR_UPDATER_NO_PUBLISHED_VERSIONS':
    case 'ERR_UPDATER_LATEST_VERSION_NOT_FOUND':
      return mt('updater.noReleases')
    case 'ERR_UPDATER_INVALID_RELEASE_FEED':
      return mt('updater.feedUnreadable')
    default:
      break
  }

  if (typeof info.statusCode === 'number' && info.statusCode > 0) {
    return mt('updater.feedUnavailable', { status: info.statusCode })
  }

  const firstLine = rawMessage.split(/\r?\n/, 1)[0].trim()
  if (firstLine === '') return mt('updater.unknownError')
  if (firstLine.length <= MAX_MESSAGE_LENGTH) return firstLine
  return firstLine.slice(0, MAX_MESSAGE_LENGTH - 1) + '…'
}
