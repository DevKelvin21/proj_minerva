import { describe, expect, it } from 'vitest'
import { MAX_MESSAGE_LENGTH, updaterErrorMessage } from './error-message'
import { MOCK_RAW_FEED_ERROR } from './mock-updater'

/**
 * `updaterErrorMessage` is the only thing standing between an
 * `electron-updater` failure and `UpdaterStatus.message` in Settings. The
 * v0.8.1 macOS report showed the raw `HttpError` dump (status line, response
 * headers, stack trace) in the card; these tests pin that nothing like that
 * crosses IPC again.
 */

function withCode(message: string, code: string): Error {
  return Object.assign(new Error(message), { code })
}

describe('updaterErrorMessage', () => {
  it('the v0.8.1 "Cannot find latest-mac.yml" dump becomes one translated sentence naming the manifest', () => {
    const text = updaterErrorMessage(MOCK_RAW_FEED_ERROR)
    expect(text).toBe(
      'The latest release has no update manifest for this platform (latest-mac.yml), ' +
        'so Minerva cannot compare versions yet.',
    )
    expect(text).not.toContain('Headers')
    expect(text).not.toContain('\n')
    expect(text).not.toMatch(/\bat \w+ \(/)
    expect(text).not.toContain('authentication token')
  })

  it('names the platform manifest from the message (latest.yml / latest-linux.yml) and falls back to latest.yml', () => {
    expect(
      updaterErrorMessage(
        withCode(
          'Cannot find latest-linux.yml in the latest release artifacts (x): y',
          'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND',
        ),
      ),
    ).toContain('(latest-linux.yml)')
    expect(
      updaterErrorMessage(
        withCode('something else entirely', 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND'),
      ),
    ).toContain('(latest.yml)')
  })

  it('"no published versions" and "latest version not found" map to the no-releases message', () => {
    expect(
      updaterErrorMessage(
        withCode('No published versions on GitHub', 'ERR_UPDATER_NO_PUBLISHED_VERSIONS'),
      ),
    ).toBe('No published release was found on GitHub yet.')
    expect(
      updaterErrorMessage(
        withCode(
          'Unable to find latest version on GitHub (url), please ensure…',
          'ERR_UPDATER_LATEST_VERSION_NOT_FOUND',
        ),
      ),
    ).toBe('No published release was found on GitHub yet.')
  })

  it('an unreadable feed never leaks the XML electron-updater appends after a newline', () => {
    const text = updaterErrorMessage(
      withCode(
        'Cannot parse releases feed: boom,\nXML:\n<?xml version="1.0"?><feed>…</feed>',
        'ERR_UPDATER_INVALID_RELEASE_FEED',
      ),
    )
    expect(text).toBe('GitHub returned a release list Minerva could not read.')
  })

  it('an HttpError without a known code becomes "HTTP <status>" with nothing else', () => {
    const httpError = Object.assign(
      new Error('500 Internal Server Error\nHeaders: {"server":"GitHub.com"}'),
      {
        statusCode: 500,
      },
    )
    expect(updaterErrorMessage(httpError)).toBe(
      'GitHub did not answer the update check (HTTP 500). Try again later.',
    )
  })

  it('any other error keeps only its first line, trimmed', () => {
    expect(
      updaterErrorMessage(new Error('  net::ERR_INTERNET_DISCONNECTED  \n    at foo (bar.js:1:1)')),
    ).toBe('net::ERR_INTERNET_DISCONNECTED')
    expect(updaterErrorMessage('plain string error\nsecond line')).toBe('plain string error')
  })

  it('caps the length of an unknown message', () => {
    const text = updaterErrorMessage(new Error('x'.repeat(1000)))
    expect(text.length).toBe(MAX_MESSAGE_LENGTH)
    expect(text.endsWith('…')).toBe(true)
  })

  it('an empty or non-error value falls back to the unknown-error message', () => {
    expect(updaterErrorMessage(new Error(''))).toBe('Unknown error while checking for updates.')
    expect(updaterErrorMessage(undefined)).toBe('Unknown error while checking for updates.')
    expect(updaterErrorMessage({})).toBe('Unknown error while checking for updates.')
  })
})
