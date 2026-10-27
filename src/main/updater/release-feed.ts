import type { UpdateInfoLite } from '../../shared/types'
import { mt } from '../i18n'
import { RELEASE_OWNER, RELEASE_REPO, buildReleaseUrl, isSemver } from './config'

/**
 * Version check for the **notify-only** capability (`./capability.ts`:
 * macOS unsigned, Linux without a writable AppImage) — talks to the GitHub
 * **releases REST API** instead of `electron-updater`.
 *
 * Why not `electron-updater` here: its GitHub provider reads `releases.atom`
 * and then REQUIRES `latest-<platform>.yml` in that entry's assets, even when
 * the app only wants to compare versions. Two real failure modes surfaced on
 * the fork (`DevKelvin21/proj_minerva`):
 * 1. A repo with ZERO releases: GitHub's `releases.atom` silently falls back
 *    to listing **tags** (the ones inherited from upstream when forking), so
 *    the "latest release" is a bare tag and `latest-mac.yml` 404s with a raw
 *    `HttpError` dump (headers + stack) in Settings.
 * 2. A release published without the manifest for one platform (older
 *    upstream releases ≤ 0.6.0 had only installers).
 * Notify mode never downloads anything, so the manifest is dead weight: the
 * REST API returns ONLY releases (never tags), says whether each one is a
 * draft or a prerelease, and works for a public repo without credentials.
 *
 * Pure module on purpose (same criterion as `./capability.ts` and
 * `./mock-updater.ts`): no `electron` import, `fetchImpl` is injected by the
 * caller (`./updater.ts` passes Electron's proxy-aware `net.fetch`; tests pass
 * a fake). Every field of the response is UNTRUSTED: only `tag_name` (through
 * the same semver gate as the feed version) and `published_at` (through
 * `Date.parse`) reach the renderer, and the release URL is ALWAYS built by
 * `buildReleaseUrl` — never taken from `html_url`.
 */

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>

export interface LatestRelease {
  version: string
  releaseDate?: string
}

export interface FetchLatestReleaseOptions {
  fetchImpl: FetchLike
  allowPrerelease: boolean
  owner?: string
  repo?: string
  timeoutMs?: number
}

/** Translated, single-line message meant for the UI (it crosses IPC as `UpdaterStatus.message`). */
export class ReleaseFeedError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'ReleaseFeedError'
  }
}

const REQUEST_TIMEOUT_MS = 15_000
/** Enough for `per_page=30` releases with long bodies; a bigger answer is not a release list. */
const MAX_BODY_BYTES = 2 * 1024 * 1024
const PER_PAGE = 30

/**
 * Semver precedence (semver.org §11) for the "classic" shape `./config.ts`
 * validates: compares major.minor.patch numerically, then prerelease
 * identifiers (a version WITH prerelease sorts before the same version
 * without; numeric identifiers compare as numbers and rank below
 * alphanumeric ones). Build metadata is ignored. Returns <0, 0 or >0.
 */
export function compareSemver(a: string, b: string): number {
  const pa = splitSemver(a)
  const pb = splitSemver(b)
  for (let i = 0; i < 3; i += 1) {
    if (pa.core[i] !== pb.core[i]) return pa.core[i] - pb.core[i]
  }
  if (pa.pre.length === 0 && pb.pre.length === 0) return 0
  if (pa.pre.length === 0) return 1
  if (pb.pre.length === 0) return -1
  const len = Math.min(pa.pre.length, pb.pre.length)
  for (let i = 0; i < len; i += 1) {
    const cmp = compareIdentifier(pa.pre[i], pb.pre[i])
    if (cmp !== 0) return cmp
  }
  return pa.pre.length - pb.pre.length
}

function splitSemver(version: string): { core: number[]; pre: string[] } {
  const withoutBuild = version.split('+')[0]
  const dash = withoutBuild.indexOf('-')
  const corePart = dash === -1 ? withoutBuild : withoutBuild.slice(0, dash)
  const prePart = dash === -1 ? '' : withoutBuild.slice(dash + 1)
  const core = corePart.split('.').map((n) => Number.parseInt(n, 10))
  const pre = prePart === '' ? [] : prePart.split('.')
  return { core, pre }
}

function compareIdentifier(a: string, b: string): number {
  const na = /^\d+$/.test(a)
  const nb = /^\d+$/.test(b)
  if (na && nb) return Number.parseInt(a, 10) - Number.parseInt(b, 10)
  if (na) return -1
  if (nb) return 1
  return a < b ? -1 : a > b ? 1 : 0
}

/** `v1.2.3` / `1.2.3` → `1.2.3`; anything that does not validate as semver → `undefined`. */
export function versionFromTag(tag: unknown): string | undefined {
  if (typeof tag !== 'string') return undefined
  const version = tag.startsWith('v') ? tag.slice(1) : tag
  return isSemver(version) ? version : undefined
}

function releaseDateFrom(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString()
}

/**
 * Highest published (non-draft) release of `owner/repo`, prereleases only
 * when `allowPrerelease`; `null` when the repo has no eligible release yet.
 * Throws `ReleaseFeedError` (already translated, one line) on network, HTTP
 * or shape problems — never the raw HTTP response.
 */
export async function fetchLatestRelease(
  options: FetchLatestReleaseOptions,
): Promise<LatestRelease | null> {
  const owner = options.owner ?? RELEASE_OWNER
  const repo = options.repo ?? RELEASE_REPO
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases?per_page=${PER_PAGE}`

  let response: Response
  try {
    response = await options.fetchImpl(url, {
      method: 'GET',
      signal: AbortSignal.timeout(options.timeoutMs ?? REQUEST_TIMEOUT_MS),
      headers: {
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
      },
    })
  } catch (error) {
    throw new ReleaseFeedError(mt('updater.feedUnreachable'), { cause: error })
  }

  if (!response.ok) {
    await response.body?.cancel().catch(() => {})
    throw new ReleaseFeedError(mt('updater.feedUnavailable', { status: response.status }))
  }

  let parsed: unknown
  try {
    const text = await readBounded(response)
    parsed = JSON.parse(text)
  } catch (error) {
    throw new ReleaseFeedError(mt('updater.feedUnreadable'), { cause: error })
  }
  if (!Array.isArray(parsed)) {
    throw new ReleaseFeedError(mt('updater.feedUnreadable'))
  }

  let best: LatestRelease | null = null
  for (const entry of parsed) {
    if (typeof entry !== 'object' || entry === null) continue
    const release = entry as Record<string, unknown>
    if (release.draft === true) continue
    if (release.prerelease === true && !options.allowPrerelease) continue
    const version = versionFromTag(release.tag_name)
    if (version === undefined) continue
    if (best === null || compareSemver(version, best.version) > 0) {
      best = { version, releaseDate: releaseDateFrom(release.published_at) }
    }
  }
  return best
}

/** Streams the body with a hard byte cap (same pattern as `../theme/open-vsx.ts`): a feed bigger than `MAX_BODY_BYTES` is rejected before it is buffered whole. */
async function readBounded(response: Response): Promise<string> {
  const body = response.body
  if (!body) return ''
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => {})
        throw new Error('release list too large')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks, total).toString('utf8')
}

/**
 * `UpdateInfoLite` for the UI when `latest` is strictly newer than
 * `currentVersion`; `undefined` when up to date (or when the version cannot
 * be turned into a safe release URL — same rule as the real engine).
 */
export function newerRelease(
  currentVersion: string,
  latest: LatestRelease | null,
): UpdateInfoLite | undefined {
  if (latest === null) return undefined
  if (!isSemver(currentVersion)) return undefined
  if (compareSemver(latest.version, currentVersion) <= 0) return undefined
  const releaseUrl = buildReleaseUrl(latest.version)
  if (releaseUrl === undefined) return undefined
  return { version: latest.version, releaseUrl, releaseDate: latest.releaseDate }
}
