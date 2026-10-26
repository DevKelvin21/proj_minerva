/**
 * Hash routing for the detachable didactic window (see
 * `src/main/windows/didactic-window.ts` and `src/renderer/src/main.tsx`).
 *
 * Main opens the detached window loading the SAME renderer as the main window,
 * with a hash `didactic/<repo>/<number>?title=...`. `<repo>` is the full
 * `RepoRef` as base64url-encoded JSON, so every provider variant (GitHub,
 * Azure DevOps) round-trips without a per-provider path format. On parse it is
 * validated with the same strict rules as IPC payloads (`./scm-guards.ts`):
 * the hash is an input to the renderer like any other.
 *
 * The prefix has no leading `#`: `BrowserWindow.loadFile` receives the hash
 * via `{ hash }` (Node's `url.format()` adds the `#`), while `loadURL` in dev
 * needs it concatenated by hand. `parseDidacticHash` accepts it with or
 * without the leading `#` (`location.hash` always has it).
 */
import type { RepoRef } from './scm'
import { isRepoRef } from './scm-guards'

export const DIDACTIC_ROUTE_PREFIX = 'didactic/'

/** Upper bound for the encoded repo segment; generous for the longest valid `RepoRef`. */
const MAX_ENCODED_REPO_LEN = 4096

export interface DidacticRouteTarget {
  repo: RepoRef
  number: number
  /** `null` when the hash had no `title` query (shouldn't happen with `buildDidacticHash`, but tolerated). */
  title: string | null
}

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(encoded: string): string | null {
  if (!/^[A-Za-z0-9_-]*$/.test(encoded)) return null
  try {
    const padded = encoded.replace(/-/g, '+').replace(/_/g, '/')
    const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

/** Builds the hash (no leading `#`, see header) that navigates the didactic window to `repo#number`. */
export function buildDidacticHash(repo: RepoRef, number: number, title: string): string {
  return (
    DIDACTIC_ROUTE_PREFIX +
    toBase64Url(JSON.stringify(repo)) +
    '/' +
    number +
    '?title=' +
    encodeURIComponent(title)
  )
}

/** `null` if `hash` is not a valid didactic route (missing prefix, invalid repo or number). */
export function parseDidacticHash(hash: string): DidacticRouteTarget | null {
  const withoutLeadingHash = hash.startsWith('#') ? hash.slice(1) : hash
  if (!withoutLeadingHash.startsWith(DIDACTIC_ROUTE_PREFIX)) return null

  const rest = withoutLeadingHash.slice(DIDACTIC_ROUTE_PREFIX.length)
  const [pathPart, queryPart] = rest.split('?')
  const segments = pathPart.split('/')
  if (segments.length !== 2) return null

  const [encodedRepo, numberPart] = segments
  if (encodedRepo.length === 0 || encodedRepo.length > MAX_ENCODED_REPO_LEN) return null
  const json = fromBase64Url(encodedRepo)
  if (json === null) return null
  let repo: unknown
  try {
    repo = JSON.parse(json)
  } catch {
    return null
  }
  if (!isRepoRef(repo)) return null

  if (!/^\d+$/.test(numberPart)) return null
  const number = Number(numberPart)
  if (!Number.isSafeInteger(number) || number <= 0) return null

  let title: string | null = null
  if (queryPart) {
    const match = /(?:^|&)title=([^&]*)/.exec(queryPart)
    if (match) {
      try {
        title = decodeURIComponent(match[1])
      } catch {
        title = null
      }
    }
  }

  return { repo, number, title }
}
