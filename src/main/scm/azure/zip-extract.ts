/**
 * Safe extraction of a repository zip (Azure DevOps `items?$format=zip`) into
 * a snapshot directory. Same protections as the GitHub tarball path in
 * `main/github/real-service.ts`, because the archive is HOSTILE input (it is
 * the PR author's code):
 *
 * - Size caps on the compressed file and on the sum of DECLARED uncompressed
 *   sizes (zip bomb), checked from the central directory before writing
 *   anything; the bytes actually written are counted too, and yauzl's
 *   `validateEntrySizes` rejects entries whose data disagrees with the index.
 * - An entry-count cap (millions of empty files exhaust inodes, not bytes).
 * - Absolute paths, `..` segments and drive letters fail the whole archive
 *   (yauzl rejects them too; this is a second, independent check). Every
 *   destination is also re-checked to resolve inside `destDir`.
 * - Symlinks, device files, FIFOs and sockets (unix mode bits in the external
 *   attributes) are SKIPPED, not followed: the AI tools that read the snapshot
 *   would follow a link to `~/.ssh` without "writing" anything. Encrypted
 *   entries are skipped as well.
 * - Files are written `0o644` (no exec bits survive) with `wx` (never through
 *   an existing path).
 * - A single top-level folder wrapping everything is stripped, so `destDir`
 *   ends up as the repo root whether or not the server adds one.
 */
import { createWriteStream } from 'node:fs'
import { mkdir, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import yauzl, { type Entry, type ZipFile } from 'yauzl'

/** Same budget as `MAX_TARBALL_BYTES` (GitHub path). */
export const MAX_ZIP_BYTES = 150 * 1024 * 1024
/** Same budget as `MAX_EXTRACTED_BYTES` (GitHub path). */
export const MAX_ZIP_EXTRACTED_BYTES = 500 * 1024 * 1024
export const MAX_ZIP_ENTRIES = 100_000

export interface ZipExtractLimits {
  maxZipBytes: number
  maxExtractedBytes: number
  maxEntries: number
}

export interface ZipExtractResult {
  files: number
  directories: number
  bytes: number
  /** Entries left out on purpose (symlinks, devices, encrypted). Paths are repo-relative. */
  skipped: { path: string; reason: 'symlink' | 'special' | 'encrypted' }[]
  /** The wrapper folder that was stripped, if any. */
  strippedRoot?: string
}

export class ZipExtractError extends Error {
  constructor(
    readonly reason: 'too-large' | 'too-many-entries' | 'unsafe-path' | 'corrupt',
    message: string,
  ) {
    super(message)
    this.name = 'ZipExtractError'
  }
}

const S_IFMT = 0o170000
const S_IFREG = 0o100000
const S_IFDIR = 0o040000
const S_IFLNK = 0o120000
/** `versionMadeBy` high byte: 3 = UNIX (mode bits live in the high 16 bits of the external attrs). */
const MADE_BY_UNIX = 3
/** MS-DOS directory attribute (low byte of the external attrs). */
const DOS_DIRECTORY = 0x10

type EntryKind = 'file' | 'directory' | 'symlink' | 'special'

export function classifyEntry(entry: Pick<Entry, 'fileName' | 'externalFileAttributes' | 'versionMadeBy'>): EntryKind {
  const attrs = entry.externalFileAttributes >>> 0
  if (entry.versionMadeBy >>> 8 === MADE_BY_UNIX) {
    const type = (attrs >>> 16) & S_IFMT
    if (type === S_IFLNK) return 'symlink'
    if (type === S_IFDIR) return 'directory'
    if (type !== 0 && type !== S_IFREG) return 'special'
  }
  if (entry.fileName.endsWith('/') || (attrs & DOS_DIRECTORY) !== 0) return 'directory'
  return 'file'
}

/** Returns the reason a name is unsafe, or `null` when it is a plain relative path. */
export function unsafePathReason(fileName: string): string | null {
  if (fileName.length === 0) return 'empty name'
  if (fileName.includes('\0')) return 'NUL in name'
  if (fileName.includes('\\')) return 'backslash in name'
  if (fileName.startsWith('/') || /^[A-Za-z]:/.test(fileName)) return 'absolute path'
  if (fileName.split('/').some((segment) => segment === '..')) return 'parent segment'
  return null
}

function openZip(zipPath: string): Promise<ZipFile> {
  return yauzl.openPromise(zipPath, {
    lazyEntries: true,
    autoClose: false,
    decodeStrings: true,
    validateEntrySizes: true,
    strictFileNames: true,
  })
}

async function readAllEntries(zip: ZipFile, maxEntries: number): Promise<Entry[]> {
  if (zip.entryCount > maxEntries) {
    throw new ZipExtractError(
      'too-many-entries',
      'The repository archive has ' + zip.entryCount + ' entries (limit ' + maxEntries + ').',
    )
  }
  const entries: Entry[] = []
  for await (const entry of zip.eachEntry()) entries.push(entry)
  return entries
}

/** The single top-level folder every entry lives under, if there is exactly one. */
export function commonRoot(names: string[]): string | undefined {
  let root: string | undefined
  for (const name of names) {
    const slash = name.indexOf('/')
    // A top-level file (no slash) means there is no wrapper folder.
    if (slash <= 0) return undefined
    const first = name.slice(0, slash)
    if (root === undefined) root = first
    else if (root !== first) return undefined
  }
  return root
}

function byteCounter(limit: number, already: () => number, add: (n: number) => void): Transform {
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      add(chunk.length)
      if (already() > limit) {
        callback(new ZipExtractError('too-large', 'The repository archive expands past the size limit.'))
        return
      }
      callback(null, chunk)
    },
  })
}

/**
 * Extracts `zipPath` into `destDir` (which must exist and should be empty).
 * Throws `ZipExtractError` for policy violations; I/O errors propagate.
 */
export async function extractZipSafely(
  zipPath: string,
  destDir: string,
  limits: Partial<ZipExtractLimits> = {},
): Promise<ZipExtractResult> {
  const maxZipBytes = limits.maxZipBytes ?? MAX_ZIP_BYTES
  const maxExtractedBytes = limits.maxExtractedBytes ?? MAX_ZIP_EXTRACTED_BYTES
  const maxEntries = limits.maxEntries ?? MAX_ZIP_ENTRIES

  const { size } = await stat(zipPath)
  if (size > maxZipBytes) {
    throw new ZipExtractError(
      'too-large',
      'The repository archive is larger than ' + Math.floor(maxZipBytes / (1024 * 1024)) + ' MB.',
    )
  }

  let zip: ZipFile
  try {
    zip = await openZip(zipPath)
  } catch (error) {
    throw new ZipExtractError('corrupt', 'The repository archive is not a valid zip: ' + errorText(error))
  }

  try {
    let entries: Entry[]
    try {
      entries = await readAllEntries(zip, maxEntries)
    } catch (error) {
      if (error instanceof ZipExtractError) throw error
      // yauzl's own name validation (absolute / `..`) surfaces here.
      throw new ZipExtractError('unsafe-path', 'The repository archive is unsafe: ' + errorText(error))
    }

    let declared = 0
    for (const entry of entries) {
      const reason = unsafePathReason(entry.fileName)
      if (reason) {
        throw new ZipExtractError('unsafe-path', 'The repository archive has an unsafe path (' + reason + ').')
      }
      declared += entry.uncompressedSize
    }
    if (declared > maxExtractedBytes) {
      throw new ZipExtractError(
        'too-large',
        'The repository expands to more than ' +
          Math.floor(maxExtractedBytes / (1024 * 1024)) +
          ' MB uncompressed.',
      )
    }

    const root = commonRoot(entries.map((entry) => entry.fileName))
    const destRoot = resolve(destDir)
    const result: ZipExtractResult = { files: 0, directories: 0, bytes: 0, skipped: [] }
    if (root) result.strippedRoot = root

    for (const entry of entries) {
      const rel = root ? entry.fileName.slice(root.length + 1) : entry.fileName
      const cleanRel = rel.replace(/\/+$/, '')
      if (cleanRel.length === 0) continue

      const target = resolve(destRoot, cleanRel)
      const fromRoot = relative(destRoot, target)
      if (fromRoot.startsWith('..') || isAbsolute(fromRoot)) {
        throw new ZipExtractError('unsafe-path', 'The repository archive has a path outside the snapshot.')
      }

      const kind = classifyEntry(entry)
      if (kind === 'symlink' || kind === 'special') {
        result.skipped.push({ path: cleanRel, reason: kind })
        continue
      }
      if (kind === 'directory') {
        await mkdir(target, { recursive: true })
        result.directories++
        continue
      }
      if (entry.isEncrypted()) {
        result.skipped.push({ path: cleanRel, reason: 'encrypted' })
        continue
      }

      await mkdir(join(target, '..'), { recursive: true })
      const source = await zip.openReadStreamPromise(entry)
      await pipeline(
        source,
        byteCounter(
          maxExtractedBytes,
          () => result.bytes,
          (n) => {
            result.bytes += n
          },
        ),
        createWriteStream(target, { flags: 'wx', mode: 0o644 }),
      )
      result.files++
    }
    return result
  } finally {
    zip.close()
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
