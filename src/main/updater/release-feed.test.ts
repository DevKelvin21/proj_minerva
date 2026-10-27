import { describe, expect, it, vi } from 'vitest'
import {
  compareSemver,
  fetchLatestRelease,
  newerRelease,
  versionFromTag,
  ReleaseFeedError,
  type FetchLike,
} from './release-feed'

/**
 * `./release-feed.ts` is the notify-mode engine (macOS unsigned, Linux
 * without a writable AppImage): GitHub releases REST API, no
 * `latest-<platform>.yml`. These tests pin the two bugs it exists for —
 * a fork with zero releases (the atom feed `electron-updater` reads falls
 * back to tags) and a release without the platform manifest — plus the
 * untrusted-input rules (semver gate, URL always built by main).
 */

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function fetchReturning(response: Response | (() => Promise<Response>)) {
  return vi.fn<FetchLike>(async () => (typeof response === 'function' ? response() : response))
}

describe('compareSemver', () => {
  it('orders major.minor.patch numerically (not lexically)', () => {
    expect(compareSemver('0.10.0', '0.9.9')).toBeGreaterThan(0)
    expect(compareSemver('1.0.0', '1.0.0')).toBe(0)
    expect(compareSemver('0.8.1', '0.8.2')).toBeLessThan(0)
  })

  it('a prerelease sorts below the same stable version, and prerelease identifiers compare per semver §11', () => {
    expect(compareSemver('1.0.0-beta.1', '1.0.0')).toBeLessThan(0)
    expect(compareSemver('1.0.0-alpha', '1.0.0-beta')).toBeLessThan(0)
    expect(compareSemver('1.0.0-beta.2', '1.0.0-beta.11')).toBeLessThan(0)
    expect(compareSemver('1.0.0-beta', '1.0.0-beta.1')).toBeLessThan(0)
    expect(compareSemver('1.0.0-1', '1.0.0-alpha')).toBeLessThan(0)
  })

  it('ignores build metadata', () => {
    expect(compareSemver('1.2.3+build.5', '1.2.3')).toBe(0)
  })
})

describe('versionFromTag', () => {
  it('strips the leading v and keeps only classic semver', () => {
    expect(versionFromTag('v0.8.1')).toBe('0.8.1')
    expect(versionFromTag('0.8.1-rc.1')).toBe('0.8.1-rc.1')
  })

  it('rejects anything that is not semver (tags are untrusted input)', () => {
    expect(versionFromTag('latest')).toBeUndefined()
    expect(versionFromTag('v1.2')).toBeUndefined()
    expect(versionFromTag('v1.2.3 && rm -rf /')).toBeUndefined()
    expect(versionFromTag(42)).toBeUndefined()
    expect(versionFromTag(undefined)).toBeUndefined()
  })
})

describe('fetchLatestRelease', () => {
  const releases = [
    { tag_name: 'v0.9.0', draft: true, prerelease: false, published_at: null },
    { tag_name: 'v0.8.1', draft: false, prerelease: false, published_at: '2026-10-20T10:00:00Z' },
    {
      tag_name: 'v0.8.2-beta.1',
      draft: false,
      prerelease: true,
      published_at: '2026-10-25T10:00:00Z',
    },
    { tag_name: 'v0.7.1', draft: false, prerelease: false, published_at: '2026-10-01T10:00:00Z' },
    { tag_name: 'nightly', draft: false, prerelease: false, published_at: '2026-10-26T10:00:00Z' },
  ]

  it('asks the releases REST endpoint of the configured fork, never the atom feed', async () => {
    const fetchImpl = fetchReturning(jsonResponse(releases))
    await fetchLatestRelease({ fetchImpl, allowPrerelease: false })
    expect(fetchImpl).toHaveBeenCalledOnce()
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://api.github.com/repos/DevKelvin21/proj_minerva/releases?per_page=30')
    expect(init.method).toBe('GET')
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('picks the highest semver among published releases, skipping drafts and non-semver tags', async () => {
    const latest = await fetchLatestRelease({
      fetchImpl: fetchReturning(jsonResponse(releases)),
      allowPrerelease: false,
    })
    expect(latest).toEqual({ version: '0.8.1', releaseDate: '2026-10-20T10:00:00.000Z' })
  })

  it('includes prereleases only when allowPrerelease is true', async () => {
    const latest = await fetchLatestRelease({
      fetchImpl: fetchReturning(jsonResponse(releases)),
      allowPrerelease: true,
    })
    expect(latest?.version).toBe('0.8.2-beta.1')
  })

  it('a repo with zero releases (the fork right after forking) resolves to null, not an error', async () => {
    const latest = await fetchLatestRelease({
      fetchImpl: fetchReturning(jsonResponse([])),
      allowPrerelease: true,
    })
    expect(latest).toBeNull()
  })

  it('drops an unparsable published_at instead of forwarding it', async () => {
    const latest = await fetchLatestRelease({
      fetchImpl: fetchReturning(
        jsonResponse([
          { tag_name: 'v1.0.0', draft: false, prerelease: false, published_at: 'yesterday' },
        ]),
      ),
      allowPrerelease: false,
    })
    expect(latest).toEqual({ version: '1.0.0', releaseDate: undefined })
  })

  it('HTTP errors become a short translated message with the status, never the response', async () => {
    await expect(
      fetchLatestRelease({
        fetchImpl: fetchReturning(jsonResponse({ message: 'rate limited' }, 403)),
        allowPrerelease: true,
      }),
    ).rejects.toMatchObject({
      name: 'ReleaseFeedError',
      message: 'GitHub did not answer the update check (HTTP 403). Try again later.',
    })
  })

  it('a network failure becomes "could not reach GitHub"', async () => {
    const fetchImpl = fetchReturning(() => Promise.reject(new TypeError('fetch failed')))
    await expect(fetchLatestRelease({ fetchImpl, allowPrerelease: true })).rejects.toBeInstanceOf(
      ReleaseFeedError,
    )
    await expect(fetchLatestRelease({ fetchImpl, allowPrerelease: true })).rejects.toThrow(
      /Could not reach GitHub/,
    )
  })

  it('a body that is not a JSON array becomes "could not read"', async () => {
    await expect(
      fetchLatestRelease({
        fetchImpl: fetchReturning(new Response('<html>oops</html>', { status: 200 })),
        allowPrerelease: true,
      }),
    ).rejects.toThrow(/could not read/)
    await expect(
      fetchLatestRelease({
        fetchImpl: fetchReturning(jsonResponse({ not: 'an array' })),
        allowPrerelease: true,
      }),
    ).rejects.toThrow(/could not read/)
  })

  it('rejects a body over the byte cap before buffering it whole', async () => {
    const huge =
      '[' + '{"tag_name":"v1.0.0","draft":false,"prerelease":false},'.repeat(60_000) + ']'
    await expect(
      fetchLatestRelease({
        fetchImpl: fetchReturning(new Response(huge, { status: 200 })),
        allowPrerelease: true,
      }),
    ).rejects.toThrow(/could not read/)
  })
})

describe('newerRelease', () => {
  it('returns an UpdateInfoLite with a release URL built by main when latest is strictly newer', () => {
    expect(
      newerRelease('0.8.1', { version: '0.9.0', releaseDate: '2026-10-27T00:00:00.000Z' }),
    ).toEqual({
      version: '0.9.0',
      releaseUrl: 'https://github.com/DevKelvin21/proj_minerva/releases/tag/v0.9.0',
      releaseDate: '2026-10-27T00:00:00.000Z',
    })
  })

  it('is undefined when up to date, when ahead of the feed, or when there is no release at all', () => {
    expect(newerRelease('0.8.1', { version: '0.8.1' })).toBeUndefined()
    expect(newerRelease('0.8.1', { version: '0.2.1' })).toBeUndefined()
    expect(newerRelease('0.8.1', null)).toBeUndefined()
  })

  it('is undefined when the installed version is not semver (never compares garbage)', () => {
    expect(newerRelease('dev', { version: '0.9.0' })).toBeUndefined()
  })
})
