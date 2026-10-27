/**
 * Builds the `DiffFile[]` of an Azure DevOps PR iteration from its change
 * entries, under an AGGREGATE budget so a huge PR can't stall main.
 *
 * Azure sends no patch text, so every changed file costs up to two blob
 * downloads plus a line diff (`./patch-builder.ts`). Per-file caps alone are
 * not enough: 300 files x 1 MB x 2 sides is 600 MB of downloads and minutes of
 * diffing. The budget:
 *
 * - `maxFiles` (300, same as the GitHub path): later entries are dropped.
 * - `maxTotalBytes`: blob bytes downloaded for the PR. Once spent, the
 *   remaining files are listed with `patchOmitted: 'diff_budget'` and no
 *   download. Fetches already in flight may overshoot by at most
 *   `concurrency x 2 x maxFileBytes`; that bound is the point.
 * - `maxDiffMs`: total wall-clock spent inside line diffs. Each file's diff
 *   also gets `min(perFileTimeoutMs, what is left)` as its own timeout, so
 *   no single diff can hold the event loop longer than `perFileTimeoutMs`.
 * - `concurrency`: blob downloads in flight at once.
 * - Binary-looking extensions are never downloaded (they never get a patch).
 *
 * Why yield-between-files instead of a `worker_threads` worker: with the caps
 * above the longest synchronous slice is one bounded diff (`perFileTimeoutMs`),
 * and the main loop gets a turn (`setImmediate`) before every diff, so IPC
 * keeps flowing. A worker would move the CPU off-thread but adds a second
 * bundle entry to the electron-vite main build (and the esm-shim gotchas in
 * CLAUDE.md) for no user-visible gain at these sizes. Revisit if the budget
 * grows.
 */
import { setImmediate as yieldToLoop } from 'node:timers/promises'
import type { DiffFile } from '../../../shared/types'
import { AzureTooLargeError } from './client'
import type { AzureChange } from './mappers'
import { buildPatch, MAX_PATCH_SOURCE_BYTES } from './patch-builder'

export interface DiffBudget {
  maxFiles: number
  maxTotalBytes: number
  maxDiffMs: number
  perFileTimeoutMs: number
  concurrency: number
  /** Per-side cap; over it the file has no patch (`too_large`). */
  maxFileBytes: number
}

export const DEFAULT_DIFF_BUDGET: DiffBudget = {
  maxFiles: 300,
  maxTotalBytes: 24 * 1024 * 1024,
  maxDiffMs: 4000,
  perFileTimeoutMs: 750,
  concurrency: 6,
  maxFileBytes: MAX_PATCH_SOURCE_BYTES,
}

/** Never downloaded: these never produce a text patch. Lower-case, with the dot. */
const BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.bmp',
  '.ico',
  '.webp',
  '.tif',
  '.tiff',
  '.psd',
  '.pdf',
  '.zip',
  '.gz',
  '.tgz',
  '.bz2',
  '.xz',
  '.7z',
  '.rar',
  '.jar',
  '.war',
  '.nupkg',
  '.dll',
  '.exe',
  '.so',
  '.dylib',
  '.a',
  '.lib',
  '.o',
  '.obj',
  '.pdb',
  '.class',
  '.wasm',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
  '.mp3',
  '.mp4',
  '.mov',
  '.avi',
  '.wav',
  '.ogg',
  '.webm',
  '.docx',
  '.xlsx',
  '.pptx',
  '.sqlite',
  '.db',
  '.bin',
])

export function hasBinaryExtension(path: string): boolean {
  const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase()
  const dot = name.lastIndexOf('.')
  return dot > 0 && BINARY_EXTENSIONS.has(name.slice(dot))
}

export type FetchBlob = (objectId: string, maxBytes: number) => Promise<Uint8Array>

export interface BuildDiffFilesDeps {
  now?: () => number
  /** Gives the event loop a turn before each diff. */
  yieldToLoop?: () => Promise<unknown>
}

function baseFile(change: AzureChange): DiffFile {
  const file: DiffFile = {
    path: change.path,
    status: change.status,
    additions: 0,
    deletions: 0,
    isBinary: false,
  }
  if (change.previousPath && change.previousPath !== change.path) {
    file.previousPath = change.previousPath
  }
  return file
}

type BlobResult = { bytes: Uint8Array } | { tooLarge: true }

export async function buildDiffFiles(
  changes: AzureChange[],
  fetchBlob: FetchBlob,
  budget: Partial<DiffBudget> = {},
  deps: BuildDiffFilesDeps = {},
): Promise<DiffFile[]> {
  const limits: DiffBudget = { ...DEFAULT_DIFF_BUDGET, ...budget }
  const now = deps.now ?? (() => performance.now())
  const pause = deps.yieldToLoop ?? (() => yieldToLoop())
  const selected = changes.slice(0, limits.maxFiles)
  const results: DiffFile[] = new Array(selected.length)

  let bytesUsed = 0
  let diffMsUsed = 0
  const overBudget = (): boolean =>
    bytesUsed >= limits.maxTotalBytes || diffMsUsed >= limits.maxDiffMs

  const fetchSide = async (objectId: string | null): Promise<BlobResult | null> => {
    if (!objectId) return null
    try {
      // One byte over the cap tells "exactly at the cap" from "over it".
      const bytes = await fetchBlob(objectId, limits.maxFileBytes + 1)
      bytesUsed += bytes.length
      return bytes.length > limits.maxFileBytes ? { tooLarge: true } : { bytes }
    } catch (error) {
      if (error instanceof AzureTooLargeError) return { tooLarge: true }
      throw error
    }
  }

  const processOne = async (change: AzureChange): Promise<DiffFile> => {
    const file = baseFile(change)
    if (hasBinaryExtension(change.path)) return { ...file, isBinary: true }
    // Pure rename (same blob both sides): nothing to diff, nothing to download.
    if (change.baseObjectId && change.baseObjectId === change.headObjectId) return file
    if (overBudget()) return { ...file, patchOmitted: 'diff_budget' }

    const [base, head] = await Promise.all([
      fetchSide(change.baseObjectId),
      fetchSide(change.headObjectId),
    ])
    if ((base && 'tooLarge' in base) || (head && 'tooLarge' in head)) {
      return { ...file, patchOmitted: 'too_large' }
    }
    if (diffMsUsed >= limits.maxDiffMs) return { ...file, patchOmitted: 'diff_budget' }

    await pause()
    const started = now()
    const built = buildPatch(base?.bytes ?? null, head?.bytes ?? null, {
      maxBytes: limits.maxFileBytes,
      timeoutMs: Math.max(1, Math.min(limits.perFileTimeoutMs, limits.maxDiffMs - diffMsUsed)),
    })
    diffMsUsed += now() - started

    const out: DiffFile = {
      ...file,
      additions: built.additions,
      deletions: built.deletions,
      isBinary: built.isBinary,
    }
    if (built.patch !== undefined) out.patch = built.patch
    else if (built.tooLarge) out.patchOmitted = 'too_large'
    return out
  }

  let next = 0
  const worker = async (): Promise<void> => {
    while (next < selected.length) {
      const index = next++
      results[index] = await processOne(selected[index])
    }
  }
  const workers = Math.max(1, Math.min(limits.concurrency, selected.length))
  await Promise.all(Array.from({ length: workers }, worker))
  return results
}
