/**
 * Small typed REST client for Azure DevOps over Node's `fetch`. `az` is only
 * used to obtain the credential (`./credentials.ts`); every data call goes
 * through here (an `az` invocation costs 1-3 s, a REST call ~100-300 ms).
 *
 * - Base URLs: `https://dev.azure.com/{org}` and `https://vssps.dev.azure.com/{org}`.
 *   `api-version` (default 7.1) is appended unless the caller set one.
 * - Host allow-list: the credential is only ever attached to HTTPS URLs on
 *   `dev.azure.com`, `vssps.dev.azure.com` or `{org}.visualstudio.com`, AND
 *   only for the same organization it belongs to. Response bodies carry URLs
 *   (`url`, `_links`): this stops one from being used to exfiltrate the token.
 * - Redirects are followed by hand (max 3); the header is dropped when the
 *   target fails the allow-list.
 * - `X-TFS-FedAuthRedirect: Suppress` makes a bad credential come back as a
 *   401 instead of a 203 + HTML sign-in page. A 203 or an HTML body where JSON
 *   was expected is still treated as 401, just in case.
 * - One automatic retry after 401 (`credentials.invalidate(org, 'rejected')`).
 * - 429/503 with `Retry-After`: waits and retries (bounded); too long a wait
 *   becomes `RATE_LIMITED` with `retryAfterMs`.
 * - Errors are `AzureApiError` with a `ScmErrorCode`; they never include
 *   request headers.
 */
import { createWriteStream } from 'node:fs'
import { rm } from 'node:fs/promises'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'
import type { ScmErrorCode } from '../../../shared/scm'
import type { AzureAuthHeader } from './credentials'
import { AzureScmError } from './errors'

export const AZURE_API_VERSION = '7.1'

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 5 * 60_000
const DEFAULT_MAX_RETRY_AFTER_MS = 30_000
const MAX_THROTTLE_RETRIES = 2
const MAX_REDIRECTS = 3
const MAX_ERROR_MESSAGE_CHARS = 300
const CONTINUATION_HEADER = 'x-ms-continuationtoken'

export interface CredentialProvider {
  getAuthHeader(org: string): Promise<AzureAuthHeader>
  invalidate(org?: string, reason?: 'refresh' | 'rejected'): void
}

export interface AzureClientOptions {
  credentials: CredentialProvider
  fetch?: typeof fetch
  timeoutMs?: number
  downloadTimeoutMs?: number
  /** Longest `Retry-After` we are willing to sleep through before giving up. */
  maxRetryAfterMs?: number
  sleep?: (ms: number) => Promise<void>
  userAgent?: string
}

export type QueryValue = string | number | boolean | undefined | null
export type Query = Record<string, QueryValue>

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  query?: Query
  body?: unknown
  /** Overrides the default `api-version` (e.g. `7.1-preview`). */
  apiVersion?: string
  timeoutMs?: number
}

export class AzureApiError extends AzureScmError {
  readonly method: string
  /** Host + path only (no query string). */
  readonly endpoint: string

  constructor(
    code: ScmErrorCode,
    message: string,
    extra: { status?: number; retryAfterMs?: number; method: string; endpoint: string },
  ) {
    super(code, message, extra)
    this.name = 'AzureApiError'
    this.method = extra.method
    this.endpoint = extra.endpoint
  }
}

/** A download that went over its `maxBytes` cap (so callers can degrade instead of failing). */
export class AzureTooLargeError extends AzureApiError {
  constructor(message: string, extra: { method: string; endpoint: string }) {
    super('UNKNOWN', message, extra)
    this.name = 'AzureTooLargeError'
  }
}

export function statusToErrorCode(status: number): ScmErrorCode {
  if (status === 401 || status === 203) return 'UNAUTHENTICATED'
  if (status === 403) return 'FORBIDDEN'
  if (status === 404) return 'NOT_FOUND'
  if (status === 409 || status === 412) return 'CONFLICT'
  if (status === 429) return 'RATE_LIMITED'
  return 'UNKNOWN'
}

/**
 * One encoded path segment. `encodeURIComponent` leaves `.` alone, and the
 * URL parser resolves `.`/`..` segments, so `project: '..'` would silently
 * move the request (and the credential) to another path: refused, like empty
 * segments.
 */
function encodeSegment(segment: string | number): string {
  const text = String(segment)
  if (text === '' || text === '.' || text === '..') {
    throw new AzureScmError('NOT_FOUND', 'Invalid Azure DevOps URL segment.')
  }
  return encodeURIComponent(text)
}

function encodeSegments(segments: (string | number)[]): string {
  return segments.map(encodeSegment).join('/')
}

/** `https://dev.azure.com/{org}/{...segments}` with every segment encoded. */
export function orgApiUrl(org: string, ...segments: (string | number)[]): string {
  const base = 'https://dev.azure.com/' + encodeSegment(org)
  return segments.length ? base + '/' + encodeSegments(segments) : base
}

/** `https://vssps.dev.azure.com/{org}/{...segments}` (profiles, identities). */
export function vsspsApiUrl(org: string, ...segments: (string | number)[]): string {
  const base = 'https://vssps.dev.azure.com/' + encodeSegment(org)
  return segments.length ? base + '/' + encodeSegments(segments) : base
}

/** `https://dev.azure.com/{org}/{project}/_apis/git/repositories/{repo}/{...segments}` */
export function gitRepoUrl(
  org: string,
  project: string,
  repositoryId: string,
  ...segments: (string | number)[]
): string {
  return orgApiUrl(org, project, '_apis', 'git', 'repositories', repositoryId, ...segments)
}

/** True when `url` may carry `org`'s credential. */
export function isAllowedAzureUrl(url: URL, org: string): boolean {
  if (url.protocol !== 'https:' || url.username || url.password) return false
  if (url.port && url.port !== '443') return false
  const host = url.hostname.toLowerCase()
  const orgLower = org.toLowerCase()
  if (host === 'dev.azure.com' || host === 'vssps.dev.azure.com') {
    const first = url.pathname.split('/')[1] ?? ''
    try {
      return decodeURIComponent(first).toLowerCase() === orgLower
    } catch {
      return false
    }
  }
  if (host.endsWith('.visualstudio.com')) {
    const label = host.slice(0, -'.visualstudio.com'.length)
    return label === orgLower || label === orgLower + '.vssps'
  }
  return false
}

function withQuery(url: string, query: Query | undefined, apiVersion: string): URL {
  const parsed = new URL(url)
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === '') continue
    parsed.searchParams.set(key, String(value))
  }
  if (!parsed.searchParams.has('api-version')) parsed.searchParams.set('api-version', apiVersion)
  return parsed
}

/** `Retry-After` as seconds or HTTP date -> ms (`null` if absent/invalid). */
export function parseRetryAfter(value: string | null, now: number = Date.now()): number | null {
  if (!value) return null
  const seconds = Number(value)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const date = Date.parse(value)
  return Number.isFinite(date) ? Math.max(0, date - now) : null
}

function endpointOf(url: URL): string {
  return url.host + url.pathname
}

async function serverMessage(response: Response): Promise<string> {
  try {
    const text = await response.text()
    try {
      const json = JSON.parse(text) as { message?: unknown }
      if (typeof json.message === 'string') return json.message.slice(0, MAX_ERROR_MESSAGE_CHARS)
    } catch {
      // Not JSON.
    }
    return ''
  } catch {
    return ''
  }
}

function describeStatus(status: number, endpoint: string, detail: string): string {
  const base =
    status === 401 || status === 203
      ? 'Azure DevOps rejected the credential'
      : status === 403
        ? 'Not allowed by Azure DevOps (missing permission or PAT scope)'
        : status === 404
          ? 'Not found on Azure DevOps (or no access)'
          : status === 409 || status === 412
            ? 'Conflict: the item changed on Azure DevOps'
            : status === 429
              ? 'Azure DevOps rate limit reached'
              : 'Azure DevOps error (HTTP ' + status + ')'
  return base + ' [' + endpoint + ']' + (detail ? ': ' + detail : '')
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

export class AzureDevOpsClient {
  private readonly credentials: CredentialProvider
  private readonly fetchFn: typeof fetch
  private readonly timeoutMs: number
  private readonly downloadTimeoutMs: number
  private readonly maxRetryAfterMs: number
  private readonly sleep: (ms: number) => Promise<void>
  private readonly userAgent: string

  constructor(options: AzureClientOptions) {
    this.credentials = options.credentials
    this.fetchFn = options.fetch ?? fetch
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.downloadTimeoutMs = options.downloadTimeoutMs ?? DEFAULT_DOWNLOAD_TIMEOUT_MS
    this.maxRetryAfterMs = options.maxRetryAfterMs ?? DEFAULT_MAX_RETRY_AFTER_MS
    this.sleep = options.sleep ?? defaultSleep
    this.userAgent = options.userAgent ?? 'Minerva'
  }

  /** JSON request. `org` selects the credential and is checked against the URL. */
  async json<T>(org: string, url: string, options: RequestOptions = {}): Promise<T> {
    return (await this.jsonWithHeaders<T>(org, url, options)).data
  }

  async jsonWithHeaders<T>(
    org: string,
    url: string,
    options: RequestOptions = {},
  ): Promise<{ data: T; headers: Headers }> {
    const target = withQuery(url, options.query, options.apiVersion ?? AZURE_API_VERSION)
    const response = await this.send(org, target, {
      method: options.method ?? 'GET',
      accept: 'application/json',
      body: options.body,
      timeoutMs: options.timeoutMs ?? this.timeoutMs,
    })
    const contentType = response.headers.get('content-type') ?? ''
    if (response.status === 204) return { data: undefined as T, headers: response.headers }
    if (!contentType.includes('json')) {
      await response.body?.cancel()
      const signInPage = contentType.includes('text/html')
      // An HTML page that slipped past FedAuthRedirect=Suppress. It may also be a
      // captive portal or maintenance page, so drop the cache but do not blacklist
      // the credential (only a real 401/203 does that).
      if (signInPage) this.credentials.invalidate(org, 'refresh')
      throw new AzureApiError(
        signInPage ? 'UNAUTHENTICATED' : 'UNKNOWN',
        describeStatus(
          signInPage ? 401 : response.status,
          endpointOf(target),
          'unexpected ' + (contentType || 'untyped') + ' response',
        ),
        { status: response.status, method: options.method ?? 'GET', endpoint: endpointOf(target) },
      )
    }
    return { data: (await response.json()) as T, headers: response.headers }
  }

  /** Raw bytes (blobs), capped at `maxBytes`. */
  async binary(
    org: string,
    url: string,
    options: { query?: Query; accept?: string; maxBytes: number; timeoutMs?: number },
  ): Promise<Buffer> {
    const target = withQuery(url, options.query, AZURE_API_VERSION)
    const response = await this.send(org, target, {
      method: 'GET',
      accept: options.accept ?? 'application/octet-stream',
      timeoutMs: options.timeoutMs ?? this.timeoutMs,
    })
    const declared = Number(response.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > options.maxBytes) {
      await response.body?.cancel()
      throw this.tooLarge(target, options.maxBytes)
    }
    const chunks: Buffer[] = []
    let total = 0
    if (response.body) {
      for await (const chunk of Readable.fromWeb(response.body as WebReadableStream<Uint8Array>)) {
        total += (chunk as Buffer).length
        if (total > options.maxBytes) throw this.tooLarge(target, options.maxBytes)
        chunks.push(chunk as Buffer)
      }
    }
    return Buffer.concat(chunks)
  }

  /** Streams a large download (repo zip) to `destPath`; deletes the partial file on error. */
  async download(
    org: string,
    url: string,
    destPath: string,
    options: { query?: Query; accept?: string; maxBytes: number; timeoutMs?: number },
  ): Promise<number> {
    const target = withQuery(url, options.query, AZURE_API_VERSION)
    const response = await this.send(org, target, {
      method: 'GET',
      accept: options.accept ?? 'application/zip',
      timeoutMs: options.timeoutMs ?? this.downloadTimeoutMs,
    })
    const declared = Number(response.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > options.maxBytes) {
      await response.body?.cancel()
      throw this.tooLarge(target, options.maxBytes)
    }
    if (!response.body) return 0
    let total = 0
    const cap = new Transform({
      transform: (chunk: Buffer, _encoding, callback) => {
        total += chunk.length
        if (total > options.maxBytes) callback(this.tooLarge(target, options.maxBytes))
        else callback(null, chunk)
      },
    })
    let created = false
    const out = createWriteStream(destPath, { flags: 'wx', mode: 0o600 })
    out.once('open', () => {
      created = true
    })
    try {
      await pipeline(Readable.fromWeb(response.body as WebReadableStream<Uint8Array>), cap, out)
    } catch (error) {
      // `wx` fails on an existing file: never delete a file another writer owns.
      if (created) await rm(destPath, { force: true })
      throw error instanceof AzureScmError ? error : this.networkError(target, 'GET', error)
    }
    return total
  }

  /**
   * Follows `x-ms-continuationtoken` pages (e.g. `git/repositories`, refs).
   * Stops at `maxItems` (default 5000) as a safety net.
   */
  async listContinuation<T>(
    org: string,
    url: string,
    options: { query?: Query; apiVersion?: string; maxItems?: number } = {},
  ): Promise<T[]> {
    const maxItems = options.maxItems ?? 5000
    const items: T[] = []
    let token: string | null = null
    do {
      const { data, headers }: { data: { value?: T[] }; headers: Headers } =
        await this.jsonWithHeaders(org, url, {
          query: { ...options.query, continuationToken: token ?? undefined },
          apiVersion: options.apiVersion,
        })
      items.push(...(data.value ?? []))
      token = headers.get(CONTINUATION_HEADER)
    } while (token && items.length < maxItems)
    return items.slice(0, maxItems)
  }

  /**
   * `$top`/`$skip` paging for `{ value: [] }` lists (e.g. `git/pullrequests`,
   * which caps one page at 1000 and has no continuation header).
   */
  async listTopSkip<T>(
    org: string,
    url: string,
    options: { query?: Query; pageSize?: number; maxItems?: number; apiVersion?: string } = {},
  ): Promise<T[]> {
    const pageSize = options.pageSize ?? 100
    const maxItems = options.maxItems ?? 1000
    return paginateTopSkip(
      async (top, skip) => {
        const data = await this.json<{ value?: T[] }>(org, url, {
          query: { ...options.query, $top: top, $skip: skip },
          apiVersion: options.apiVersion,
        })
        return data.value ?? []
      },
      { pageSize, maxItems },
    )
  }

  private tooLarge(target: URL, maxBytes: number): AzureApiError {
    return new AzureTooLargeError(
      'Download larger than ' +
        Math.floor(maxBytes / (1024 * 1024)) +
        ' MB [' +
        endpointOf(target) +
        ']',
      { method: 'GET', endpoint: endpointOf(target) },
    )
  }

  private networkError(target: URL, method: string, error: unknown): AzureApiError {
    const name = error instanceof Error ? error.name : ''
    const timedOut = name === 'TimeoutError' || name === 'AbortError'
    const message = timedOut
      ? 'Azure DevOps did not answer in time [' + endpointOf(target) + ']'
      : // Never append the raw error text: undici can echo header values in it.
        'Could not reach Azure DevOps [' +
        endpointOf(target) +
        ']' +
        (name ? ' (' + name + ')' : '')
    return new AzureApiError('NETWORK', message, { method, endpoint: endpointOf(target) })
  }

  /**
   * Sends with auth, manual redirects, one 401 retry and bounded
   * throttling retries. Returns only 2xx responses (except 203).
   */
  private async send(
    org: string,
    target: URL,
    request: { method: string; accept: string; body?: unknown; timeoutMs: number },
  ): Promise<Response> {
    if (!isAllowedAzureUrl(target, org)) {
      throw new AzureApiError('UNKNOWN', 'Refusing to send credentials to ' + target.host, {
        method: request.method,
        endpoint: endpointOf(target),
      })
    }

    let authRetried = false
    let throttleRetries = 0
    for (;;) {
      const auth = await this.credentials.getAuthHeader(org)
      const response = await this.fetchFollowingRedirects(org, target, request, auth.header)

      if (response.status === 401 || response.status === 203) {
        await response.body?.cancel()
        this.credentials.invalidate(org, 'rejected')
        if (!authRetried) {
          authRetried = true
          continue
        }
        throw new AzureApiError('UNAUTHENTICATED', describeStatus(401, endpointOf(target), ''), {
          status: response.status,
          method: request.method,
          endpoint: endpointOf(target),
        })
      }

      if (response.status === 429 || response.status === 503) {
        const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'))
        await response.body?.cancel()
        const waitMs = retryAfterMs ?? 1000 * 2 ** throttleRetries
        if (throttleRetries < MAX_THROTTLE_RETRIES && waitMs <= this.maxRetryAfterMs) {
          throttleRetries++
          await this.sleep(waitMs)
          continue
        }
        throw new AzureApiError(
          response.status === 429 ? 'RATE_LIMITED' : 'UNKNOWN',
          describeStatus(response.status, endpointOf(target), ''),
          {
            status: response.status,
            method: request.method,
            endpoint: endpointOf(target),
            ...(retryAfterMs !== null ? { retryAfterMs } : {}),
          },
        )
      }

      if (response.status < 200 || response.status >= 300) {
        const detail = await serverMessage(response)
        throw new AzureApiError(
          statusToErrorCode(response.status),
          describeStatus(response.status, endpointOf(target), detail),
          { status: response.status, method: request.method, endpoint: endpointOf(target) },
        )
      }
      return response
    }
  }

  private async fetchFollowingRedirects(
    org: string,
    start: URL,
    request: { method: string; accept: string; body?: unknown; timeoutMs: number },
    authHeader: string,
  ): Promise<Response> {
    let current = start
    let method = request.method
    let body = request.body
    const signal = AbortSignal.timeout(request.timeoutMs)
    for (let hop = 0; ; hop++) {
      const headers: Record<string, string> = {
        Accept: request.accept,
        'User-Agent': this.userAgent,
        'X-TFS-FedAuthRedirect': 'Suppress',
      }
      // Re-checked on every hop: a redirect may leave the allow-list.
      if (isAllowedAzureUrl(current, org)) headers.Authorization = authHeader
      if (body !== undefined) headers['Content-Type'] = 'application/json'

      let response: Response
      try {
        response = await this.fetchFn(current, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          redirect: 'manual',
          signal,
        })
      } catch (error) {
        throw this.networkError(current, method, error)
      }

      const location = response.headers.get('location')
      if (response.status < 300 || response.status >= 400 || !location) return response
      await response.body?.cancel()
      if (hop >= MAX_REDIRECTS) {
        throw new AzureApiError('NETWORK', 'Too many redirects [' + endpointOf(start) + ']', {
          method,
          endpoint: endpointOf(start),
        })
      }
      const next = new URL(location, current)
      if (next.protocol !== 'https:') {
        throw new AzureApiError(
          'NETWORK',
          'Refusing a non-HTTPS redirect [' + endpointOf(start) + ']',
          {
            method,
            endpoint: endpointOf(start),
          },
        )
      }
      if (
        response.status === 303 ||
        ((response.status === 301 || response.status === 302) && method !== 'GET')
      ) {
        method = 'GET'
        body = undefined
      }
      current = next
    }
  }
}

/** Generic `$top`/`$skip` loop: stops on a short page or at `maxItems`. */
export async function paginateTopSkip<T>(
  fetchPage: (top: number, skip: number) => Promise<T[]>,
  options: { pageSize: number; maxItems: number },
): Promise<T[]> {
  const items: T[] = []
  while (items.length < options.maxItems) {
    const top = Math.min(options.pageSize, options.maxItems - items.length)
    const page = await fetchPage(top, items.length)
    items.push(...page)
    if (page.length < top) break
  }
  return items
}
