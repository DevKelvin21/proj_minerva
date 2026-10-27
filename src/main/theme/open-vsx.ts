/**
 * Open VSX theme search and install, in MAIN (the renderer CSP is
 * `connect-src 'self'`, and a downloaded extension is untrusted input).
 *
 * Adapted from T3 Code (`apps/web/src/openVsxThemes.ts`,
 * https://github.com/pingdotgg/t3code), MIT License, Copyright (c) 2026 T3
 * Tools Inc. See THIRD_PARTY_NOTICES.md. Same limits and checks; what changed
 * is where it runs (Node instead of the browser) and the zip reader (yauzl
 * with the protections of `../scm/azure/zip-extract.ts` instead of JSZip).
 *
 * Rules:
 * - Network only to `https://open-vsx.org` and its download CDN
 *   (`openvsx.eclipsecontent.org`, where file URLs redirect). Redirects are
 *   followed by hand and each hop is re-checked; anything else is refused.
 *   The renderer never sends a URL: only `namespace`/`name`, and main asks
 *   Open VSX for the rest.
 * - Every response body is read with a byte cap; requests time out.
 * - The .vsix must match Open VSX's published SHA-256 and its own manifest
 *   (publisher, name, version, license). Only permissive licenses.
 * - The zip is read in memory: entry count, declared size and compression
 *   ratio caps, no absolute/`..` paths, symlinks and special files never
 *   read. Only `extension/package.json` and the theme files it names (plus
 *   their `include` chain) are opened, each capped. Nothing is written to
 *   disk and nothing from the package is executed.
 * - Theme files are reduced to the workbench colors the importer reads
 *   (`sanitizeVsCodeColors`) before they cross IPC; the renderer then parses
 *   each color strictly.
 */
import { createHash } from 'node:crypto'
import yauzl, { type Entry, type ZipFile } from 'yauzl'
import { mt } from '../i18n'
import { classifyEntry, unsafePathReason } from '../scm/azure/zip-extract'
import { parseJsonc } from '../../shared/theme/jsonc'
import { sanitizeVsCodeColors } from '../../shared/theme/vscode-import'
import {
  MAX_OPEN_VSX_QUERY_LENGTH,
  type OpenVsxExtension,
  type OpenVsxSort,
  type OpenVsxThemePackage,
  type OpenVsxThemeSource,
} from '../../shared/theme/open-vsx'

const OPEN_VSX_ORIGIN = 'https://open-vsx.org'
const ALLOWED_HOSTS: ReadonlySet<string> = new Set(['open-vsx.org', 'openvsx.eclipsecontent.org'])
const MAX_REDIRECTS = 3
const REQUEST_TIMEOUT_MS = 10_000
const DOWNLOAD_TIMEOUT_MS = 60_000
const MAX_SEARCH_BYTES = 512 * 1024
const MAX_DETAIL_BYTES = 256 * 1024
const MAX_MANIFEST_BYTES = 256 * 1024
const MAX_CHECKSUM_BYTES = 256
export const MAX_VSIX_BYTES = 20 * 1024 * 1024
const MAX_THEME_BYTES = 256 * 1024
const MAX_ZIP_ENTRIES = 5_000
const MAX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024
const MAX_COMPRESSION_RATIO = 200
const MAX_THEMES_PER_EXTENSION = 40
const MAX_INCLUDE_DEPTH = 8
const MAX_RESOLVED_THEME_FILES = MAX_THEMES_PER_EXTENSION * MAX_INCLUDE_DEPTH
const MAX_PACKAGE_PATH_LENGTH = 1_024
const SEARCH_PAGE_SIZE = 16
const MAX_RESULTS = 8
const SUPPORTED_LICENSES: ReadonlySet<string> = new Set([
  '0BSD',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'CC0-1.0',
  'ISC',
  'MIT',
  'MPL-2.0',
  'Unlicense',
])

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>

export class OpenVsxError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'OpenVsxError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** An https URL on an allowed host (no credentials, default port), or `null`. */
export function trustedOpenVsxUrl(value: unknown, base?: string): URL | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value, base)
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null
    return ALLOWED_HOSTS.has(url.hostname.toLowerCase()) ? url : null
  } catch {
    return null
  }
}

/**
 * Reads a response body up to `limit` bytes (checks `content-length` first,
 * then counts while streaming and cancels past the cap).
 */
async function readCapped(response: Response, limit: number): Promise<Buffer> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > limit) {
    throw new OpenVsxError(mt('themes.openVsx.tooLarge'))
  }
  if (!response.body) return Buffer.alloc(0)
  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > limit) {
        await reader.cancel().catch(() => {})
        throw new OpenVsxError(mt('themes.openVsx.tooLarge'))
      }
      chunks.push(Buffer.from(value))
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks, total)
}

export interface OpenVsxClient {
  search(query: string, sortBy: OpenVsxSort): Promise<OpenVsxExtension[]>
  install(namespace: string, name: string): Promise<OpenVsxThemePackage>
}

interface ExtensionDetail extends OpenVsxExtension {
  manifestUrl: URL
  sha256Url: URL
  vsixUrl: URL
}

export function createOpenVsxClient(fetchImpl: FetchLike = fetch): OpenVsxClient {
  /** GET (or HEAD) with a timeout, following at most 3 redirects, each to an allowed host. */
  async function request(
    url: URL,
    options: { method?: 'GET' | 'HEAD'; timeoutMs?: number } = {},
  ): Promise<Response> {
    let current = url
    const signal = AbortSignal.timeout(options.timeoutMs ?? REQUEST_TIMEOUT_MS)
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      let response: Response
      try {
        response = await fetchImpl(current.toString(), {
          method: options.method ?? 'GET',
          redirect: 'manual',
          signal,
          headers: { accept: 'application/json, application/octet-stream;q=0.9, */*;q=0.1' },
        })
      } catch (error) {
        throw new OpenVsxError(mt('themes.openVsx.unreachable'), { cause: error })
      }
      if (response.status >= 300 && response.status < 400) {
        const next = trustedOpenVsxUrl(response.headers.get('location'), current.toString())
        await response.body?.cancel().catch(() => {})
        if (!next) throw new OpenVsxError(mt('themes.openVsx.untrustedRedirect'))
        current = next
        continue
      }
      return response
    }
    throw new OpenVsxError(mt('themes.openVsx.untrustedRedirect'))
  }

  async function getJson(url: URL, limit: number): Promise<unknown> {
    const response = await request(url)
    if (!response.ok) throw new OpenVsxError(mt('themes.openVsx.unavailable'))
    const bytes = await readCapped(response, limit)
    try {
      return parseJsonc(bytes.toString('utf-8'))
    } catch (error) {
      throw new OpenVsxError(mt('themes.openVsx.unreadable'), { cause: error })
    }
  }

  function apiUrl(...segments: string[]): URL {
    return new URL(OPEN_VSX_ORIGIN + '/api/' + segments.map(encodeURIComponent).join('/'))
  }

  /** Detail response -> extension, or `null` when its license is not one we import. */
  function extensionFromDetail(value: unknown): ExtensionDetail | null {
    if (!isRecord(value) || !isRecord(value.files)) {
      throw new OpenVsxError(mt('themes.openVsx.unreadable'))
    }
    const text = (field: unknown, max: number): string =>
      typeof field === 'string' ? field.trim().slice(0, max) : ''
    const namespace = text(value.namespace, 128)
    const name = text(value.name, 128)
    const version = text(value.version, 64)
    const license = text(value.license, 64)
    const manifestUrl = trustedOpenVsxUrl(value.files.manifest)
    const sha256Url = trustedOpenVsxUrl(value.files.sha256)
    const vsixUrl = trustedOpenVsxUrl(value.files.download)
    if (!namespace || !name || !version || !manifestUrl || !sha256Url || !vsixUrl) {
      throw new OpenVsxError(mt('themes.openVsx.unreadable'))
    }
    if (!SUPPORTED_LICENSES.has(license)) return null
    const icon = trustedOpenVsxUrl(value.files.icon)
    return {
      id: namespace + '.' + name,
      namespace,
      name,
      displayName: text(value.displayName, 80) || name,
      description: text(value.description, 300),
      version,
      license,
      downloadCount:
        typeof value.downloadCount === 'number' && Number.isFinite(value.downloadCount)
          ? Math.max(0, Math.floor(value.downloadCount))
          : 0,
      iconUrl: icon && icon.hostname === 'open-vsx.org' ? icon.toString() : null,
      manifestUrl,
      sha256Url,
      vsixUrl,
    }
  }

  function publicExtension(detail: ExtensionDetail): OpenVsxExtension {
    return {
      id: detail.id,
      namespace: detail.namespace,
      name: detail.name,
      displayName: detail.displayName,
      description: detail.description,
      version: detail.version,
      license: detail.license,
      downloadCount: detail.downloadCount,
      iconUrl: detail.iconUrl,
    }
  }

  async function detailFor(namespace: string, name: string): Promise<ExtensionDetail | null> {
    return extensionFromDetail(await getJson(apiUrl(namespace, name), MAX_DETAIL_BYTES))
  }

  async function search(query: string, sortBy: OpenVsxSort): Promise<OpenVsxExtension[]> {
    const text = query.trim().slice(0, MAX_OPEN_VSX_QUERY_LENGTH)
    if (!text) return []
    const url = new URL(OPEN_VSX_ORIGIN + '/api/-/search')
    url.searchParams.set('query', text)
    url.searchParams.set('category', 'Themes')
    url.searchParams.set('sortBy', sortBy)
    url.searchParams.set('sortOrder', 'desc')
    url.searchParams.set('size', String(SEARCH_PAGE_SIZE))
    const value = await getJson(url, MAX_SEARCH_BYTES)
    if (!isRecord(value) || !Array.isArray(value.extensions)) {
      throw new OpenVsxError(mt('themes.openVsx.unreadable'))
    }
    const identities = value.extensions.flatMap((candidate): Array<[string, string]> => {
      if (!isRecord(candidate)) return []
      const { namespace, name } = candidate
      return typeof namespace === 'string' && typeof name === 'string' && namespace && name
        ? [[namespace, name]]
        : []
    })
    const details = await Promise.allSettled(
      identities.slice(0, SEARCH_PAGE_SIZE).map(async ([namespace, name]) => {
        const detail = await detailFor(namespace, name)
        if (!detail) return null
        const [manifest, head] = await Promise.all([
          getJson(detail.manifestUrl, MAX_MANIFEST_BYTES),
          request(detail.vsixUrl, { method: 'HEAD' }),
        ])
        await head.body?.cancel().catch(() => {})
        if (!head.ok) return null
        const length = Number(head.headers.get('content-length'))
        if (Number.isFinite(length) && length > MAX_VSIX_BYTES) return null
        return isRecord(manifest) &&
          themeContributions(manifest).length > 0 &&
          licenseMatches(manifest, detail.license)
          ? publicExtension(detail)
          : null
      }),
    )
    const completed = details.filter((result) => result.status === 'fulfilled')
    if (identities.length > 0 && completed.length === 0) {
      throw new OpenVsxError(mt('themes.openVsx.unavailable'))
    }
    return completed.flatMap((result) => (result.value ? [result.value] : [])).slice(0, MAX_RESULTS)
  }

  async function install(namespace: string, name: string): Promise<OpenVsxThemePackage> {
    const detail = await detailFor(namespace, name)
    if (!detail) throw new OpenVsxError(mt('themes.openVsx.license'))

    const vsixResponse = await request(detail.vsixUrl, { timeoutMs: DOWNLOAD_TIMEOUT_MS })
    if (!vsixResponse.ok) throw new OpenVsxError(mt('themes.openVsx.unavailable'))
    const vsix = await readCapped(vsixResponse, MAX_VSIX_BYTES)

    const checksumResponse = await request(detail.sha256Url)
    if (!checksumResponse.ok) throw new OpenVsxError(mt('themes.openVsx.checksum'))
    const expected = (await readCapped(checksumResponse, MAX_CHECKSUM_BYTES))
      .toString('utf-8')
      .trim()
      .split(/\s+/)[0]
    const actual = createHash('sha256').update(vsix).digest('hex')
    if (!expected || !/^[a-f\d]{64}$/i.test(expected) || expected.toLowerCase() !== actual) {
      throw new OpenVsxError(mt('themes.openVsx.checksum'))
    }

    const themes = await readThemesFromVsix(vsix, detail)
    return { extension: publicExtension(detail), themes }
  }

  /**
   * One request of each kind at a time: the UI already waits for each one,
   * so a second concurrent call can only come from a misbehaving renderer
   * (a search fans out to ~48 requests, an install buffers up to 20 MB).
   */
  function singleFlight<A extends unknown[], R>(run: (...args: A) => Promise<R>) {
    let busy = false
    return async (...args: A): Promise<R> => {
      if (busy) throw new OpenVsxError(mt('themes.openVsx.busy'))
      busy = true
      try {
        return await run(...args)
      } finally {
        busy = false
      }
    }
  }

  return { search: singleFlight(search), install: singleFlight(install) }
}

type ThemeContribution = { label?: unknown; uiTheme?: unknown; path?: unknown }

function themeContributions(manifest: Record<string, unknown>): ThemeContribution[] {
  const contributes = isRecord(manifest.contributes) ? manifest.contributes : null
  return Array.isArray(contributes?.themes)
    ? (contributes.themes.filter(isRecord) as ThemeContribution[])
    : []
}

function licenseMatches(manifest: Record<string, unknown>, license: string): boolean {
  return (
    typeof manifest.license === 'string' &&
    manifest.license.trim().toLowerCase() === license.toLowerCase()
  )
}

function contributionType(uiTheme: unknown): OpenVsxThemeSource['type'] {
  if (uiTheme === 'vs') return 'light'
  if (uiTheme === 'vs-dark') return 'dark'
  if (uiTheme === 'hc-black' || uiTheme === 'hc-light') return uiTheme
  return null
}

/**
 * Resolves `path` (from a manifest or an `include`) against `relativeTo`
 * inside the package's `extension/` folder; refuses anything that escapes it.
 */
export function normalizePackagePath(path: string, relativeTo = 'extension/'): string {
  if (
    path.length > MAX_PACKAGE_PATH_LENGTH ||
    path.includes('\0') ||
    path.startsWith('/') ||
    /^[a-zA-Z]:/.test(path)
  ) {
    throw new OpenVsxError(mt('themes.openVsx.unsafePackage'))
  }
  const segments = relativeTo.split('/').slice(0, -1)
  for (const segment of path.replaceAll('\\', '/').split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      if (segments.length <= 1) throw new OpenVsxError(mt('themes.openVsx.unsafePackage'))
      segments.pop()
      continue
    }
    segments.push(segment)
  }
  if (segments[0] !== 'extension') segments.unshift('extension')
  return segments.join('/')
}

/** The package's file entries by name, after the archive-wide safety checks. */
async function indexZip(zip: ZipFile): Promise<Map<string, Entry>> {
  if (zip.entryCount > MAX_ZIP_ENTRIES) throw new OpenVsxError(mt('themes.openVsx.unsafePackage'))
  const files = new Map<string, Entry>()
  let declared = 0
  for await (const entry of zip.eachEntry()) {
    if (unsafePathReason(entry.fileName, 'linux') !== null) {
      throw new OpenVsxError(mt('themes.openVsx.unsafePackage'))
    }
    declared += entry.uncompressedSize
    if (declared > MAX_UNCOMPRESSED_BYTES)
      throw new OpenVsxError(mt('themes.openVsx.unsafePackage'))
    if (
      entry.uncompressedSize > 0 &&
      (entry.compressedSize === 0 ||
        entry.uncompressedSize / entry.compressedSize > MAX_COMPRESSION_RATIO)
    ) {
      throw new OpenVsxError(mt('themes.openVsx.unsafePackage'))
    }
    // Symlinks, devices and encrypted entries are never opened.
    if (classifyEntry(entry) !== 'file' || entry.isEncrypted()) continue
    files.set(entry.fileName, entry)
  }
  return files
}

async function readEntryText(zip: ZipFile, entry: Entry | undefined): Promise<string> {
  if (!entry || entry.uncompressedSize > MAX_THEME_BYTES) {
    throw new OpenVsxError(mt('themes.openVsx.unreadable'))
  }
  const stream = await zip.openReadStreamPromise(entry)
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    total += chunk.length
    if (total > MAX_THEME_BYTES) {
      stream.destroy()
      throw new OpenVsxError(mt('themes.openVsx.unreadable'))
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks, total).toString('utf-8')
}

async function readJsoncObject(
  zip: ZipFile,
  entry: Entry | undefined,
): Promise<Record<string, unknown>> {
  let value: unknown
  try {
    value = parseJsonc(await readEntryText(zip, entry))
  } catch (error) {
    if (error instanceof OpenVsxError) throw error
    throw new OpenVsxError(mt('themes.openVsx.unreadable'), { cause: error })
  }
  if (!isRecord(value)) throw new OpenVsxError(mt('themes.openVsx.unreadable'))
  return value
}

interface SanitizedTheme {
  include?: string
  colors: Record<string, string>
}

/** Reads a theme file and its `include` chain (depth, cycle and file-count capped). */
async function loadTheme(
  zip: ZipFile,
  files: Map<string, Entry>,
  path: string,
  cache: Map<string, SanitizedTheme>,
  budget: { files: number },
  ancestors: ReadonlySet<string> = new Set(),
): Promise<SanitizedTheme> {
  if (ancestors.size >= MAX_INCLUDE_DEPTH || ancestors.has(path)) {
    throw new OpenVsxError(mt('themes.openVsx.unreadable'))
  }
  const cached = cache.get(path)
  if (cached) return cached
  budget.files += 1
  if (budget.files > MAX_RESOLVED_THEME_FILES)
    throw new OpenVsxError(mt('themes.openVsx.unreadable'))
  const raw = await readJsoncObject(zip, files.get(path))
  const own: SanitizedTheme = {
    ...(typeof raw.include === 'string' ? { include: raw.include } : {}),
    colors: sanitizeVsCodeColors(raw.colors),
  }
  if (own.include === undefined) {
    cache.set(path, own)
    return own
  }
  const base = await loadTheme(
    zip,
    files,
    normalizePackagePath(own.include, path),
    cache,
    budget,
    new Set([...ancestors, path]),
  )
  const resolved = { colors: { ...base.colors, ...own.colors } }
  cache.set(path, resolved)
  return resolved
}

function openZipBuffer(buffer: Buffer): Promise<ZipFile> {
  return yauzl.fromBufferPromise(buffer, {
    lazyEntries: true,
    autoClose: false,
    decodeStrings: true,
    validateEntrySizes: true,
    strictFileNames: true,
  })
}

/** Opens a .vsix in memory and returns its color themes (see the header for every check). */
export async function readThemesFromVsix(
  vsix: Buffer,
  extension: Pick<
    OpenVsxExtension,
    'id' | 'namespace' | 'name' | 'displayName' | 'version' | 'license'
  >,
): Promise<OpenVsxThemeSource[]> {
  let zip: ZipFile
  try {
    zip = await openZipBuffer(vsix)
  } catch (error) {
    throw new OpenVsxError(mt('themes.openVsx.unsafePackage'), { cause: error })
  }
  try {
    let files: Map<string, Entry>
    try {
      files = await indexZip(zip)
    } catch (error) {
      if (error instanceof OpenVsxError) throw error
      throw new OpenVsxError(mt('themes.openVsx.unsafePackage'), { cause: error })
    }
    const manifest = await readJsoncObject(zip, files.get('extension/package.json'))
    if (
      typeof manifest.publisher !== 'string' ||
      typeof manifest.name !== 'string' ||
      (manifest.publisher + '.' + manifest.name).toLowerCase() !== extension.id.toLowerCase() ||
      manifest.version !== extension.version ||
      !licenseMatches(manifest, extension.license)
    ) {
      throw new OpenVsxError(mt('themes.openVsx.mismatch'))
    }
    const contributions = themeContributions(manifest)
    if (contributions.length === 0) throw new OpenVsxError(mt('themes.openVsx.noThemes'))
    if (contributions.length > MAX_THEMES_PER_EXTENSION) {
      throw new OpenVsxError(mt('themes.openVsx.tooManyThemes'))
    }
    const cache = new Map<string, SanitizedTheme>()
    const budget = { files: 0 }
    const themes: OpenVsxThemeSource[] = []
    for (const contribution of contributions) {
      if (typeof contribution.path !== 'string')
        throw new OpenVsxError(mt('themes.openVsx.unreadable'))
      const path = normalizePackagePath(contribution.path)
      const theme = await loadTheme(zip, files, path, cache, budget)
      const label =
        typeof contribution.label === 'string' && contribution.label.trim()
          ? contribution.label.trim().slice(0, 80)
          : extension.displayName
      themes.push({
        label,
        type: contributionType(contribution.uiTheme),
        path,
        colors: theme.colors,
      })
    }
    return themes
  } finally {
    zip.close()
  }
}
