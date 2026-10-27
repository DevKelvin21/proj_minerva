/**
 * Builds a GitHub-compatible unified patch for one file from its base and
 * head contents. Azure DevOps returns no patch text (only blob ids per
 * changed file), and the renderer's diff viewer only understands
 * `DiffFile.patch` as GitHub sends it (`renderer/src/lib/diff-parser.ts`):
 * hunks only, starting at `@@`, no `diff --git`/`---`/`+++` headers.
 *
 * Pure: no I/O. The caller downloads the blobs and passes them in.
 *
 * Decisions:
 * - Binary: a NUL byte in the first 8000 bytes (git's own heuristic) or
 *   content that is not valid UTF-8. No patch, `isBinary: true`.
 * - Size cap: either side over `maxBytes` gives no patch and `tooLarge: true`
 *   (the line diff is O(N*D) and would block the main process).
 * - Line endings: CRLF is normalized to LF on both sides BEFORE diffing, so a
 *   CRLF file does not render a stray `\r` on every line and a pure
 *   line-ending flip does not show the whole file as rewritten. The flip is
 *   reported with `lineEndingsChanged` instead (more useful to a reviewer).
 * - A leading UTF-8 BOM is dropped for display (it is not a line).
 */
import { structuredPatch } from 'diff'

export const DEFAULT_PATCH_CONTEXT_LINES = 3

/** Per-side size cap. Over this, no patch is built. */
export const MAX_PATCH_SOURCE_BYTES = 1024 * 1024

/** Wall-clock budget for one file's line diff before giving up. */
const DIFF_TIMEOUT_MS = 2000

/** Bytes inspected for a NUL byte (same window as git's `buffer_is_binary`). */
const BINARY_SNIFF_BYTES = 8000

export interface BuildPatchOptions {
  context?: number
  maxBytes?: number
  timeoutMs?: number
}

export interface BuiltPatch {
  /** Hunks only, `@@ … @@` first. Absent for binary, too-large and identical contents. */
  patch?: string
  additions: number
  deletions: number
  isBinary: boolean
  /** True when a side exceeded the size cap or the diff timed out. */
  tooLarge: boolean
  /** True when the only difference in line endings is CRLF vs LF between sides. */
  lineEndingsChanged: boolean
}

type LineEnding = 'crlf' | 'lf' | 'none'

const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false })

export function looksBinary(buffer: Uint8Array): boolean {
  const end = Math.min(buffer.length, BINARY_SNIFF_BYTES)
  for (let i = 0; i < end; i++) {
    if (buffer[i] === 0) return true
  }
  try {
    utf8.decode(buffer)
    return false
  } catch {
    return true
  }
}

function dominantLineEnding(text: string): LineEnding {
  const crlf = text.split('\r\n').length - 1
  const lf = text.split('\n').length - 1 - crlf
  if (crlf === 0 && lf === 0) return 'none'
  return crlf >= lf ? 'crlf' : 'lf'
}

/** `fatal` + `ignoreBOM: false` already strips one leading BOM. */
function decode(buffer: Uint8Array): string {
  return utf8.decode(buffer)
}

function rangeHeader(start: number, lines: number): string {
  // jsdiff reports the start of an empty range one past git's convention
  // (git prints `-0,0` for a file that did not exist).
  const gitStart = lines === 0 ? Math.max(0, start - 1) : start
  return lines === 1 ? String(gitStart) : gitStart + ',' + lines
}

/**
 * @param base contents at the target side; `null` when the file was added.
 * @param head contents at the source side; `null` when the file was deleted.
 */
export function buildPatch(
  base: Uint8Array | null,
  head: Uint8Array | null,
  options: BuildPatchOptions = {},
): BuiltPatch {
  const context = options.context ?? DEFAULT_PATCH_CONTEXT_LINES
  const maxBytes = options.maxBytes ?? MAX_PATCH_SOURCE_BYTES
  const empty: BuiltPatch = {
    additions: 0,
    deletions: 0,
    isBinary: false,
    tooLarge: false,
    lineEndingsChanged: false,
  }

  if ((base?.length ?? 0) > maxBytes || (head?.length ?? 0) > maxBytes) {
    return { ...empty, tooLarge: true }
  }
  if ((base && looksBinary(base)) || (head && looksBinary(head))) {
    return { ...empty, isBinary: true }
  }

  const baseRaw = base ? decode(base) : ''
  const headRaw = head ? decode(head) : ''
  const baseEnding = dominantLineEnding(baseRaw)
  const headEnding = dominantLineEnding(headRaw)
  const lineEndingsChanged =
    baseEnding !== 'none' && headEnding !== 'none' && baseEnding !== headEnding

  const baseText = baseRaw.replace(/\r\n/g, '\n')
  const headText = headRaw.replace(/\r\n/g, '\n')
  if (baseText === headText) return { ...empty, lineEndingsChanged }

  const structured = structuredPatch('a', 'b', baseText, headText, undefined, undefined, {
    context,
    timeout: options.timeoutMs ?? DIFF_TIMEOUT_MS,
  })
  if (!structured) return { ...empty, tooLarge: true, lineEndingsChanged }

  let additions = 0
  let deletions = 0
  const out: string[] = []
  for (const hunk of structured.hunks) {
    out.push(
      '@@ -' +
        rangeHeader(hunk.oldStart, hunk.oldLines) +
        ' +' +
        rangeHeader(hunk.newStart, hunk.newLines) +
        ' @@',
    )
    for (const line of hunk.lines) {
      if (line.startsWith('+')) additions++
      else if (line.startsWith('-')) deletions++
      out.push(line)
    }
  }

  return {
    patch: out.join('\n'),
    additions,
    deletions,
    isBinary: false,
    tooLarge: false,
    lineEndingsChanged,
  }
}
