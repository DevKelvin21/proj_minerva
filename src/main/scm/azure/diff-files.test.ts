import { describe, expect, it } from 'vitest'
import { AzureTooLargeError } from './client'
import { buildDiffFiles, hasBinaryExtension, type FetchBlob } from './diff-files'
import type { AzureChange } from './mappers'

const text = (lines: number, tag: string): Uint8Array =>
  Buffer.from(Array.from({ length: lines }, (_, i) => tag + ' line ' + i).join('\n') + '\n')

function change(i: number, overrides: Partial<AzureChange> = {}): AzureChange {
  return {
    path: 'src/file' + i + '.ts',
    previousPath: null,
    status: 'modified',
    baseObjectId: 'base' + i,
    headObjectId: 'head' + i,
    changeTrackingId: i,
    ...overrides,
  }
}

/** Blob store: `base<i>` / `head<i>` -> small text that differs by one line. */
function store(size = 5): { fetch: FetchBlob; calls: string[]; maxInFlight: () => number } {
  const calls: string[] = []
  let inFlight = 0
  let max = 0
  return {
    calls,
    maxInFlight: () => max,
    fetch: async (id) => {
      calls.push(id)
      inFlight++
      max = Math.max(max, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 1))
      inFlight--
      return id.startsWith('base')
        ? text(size, 'same')
        : Buffer.concat([text(size, 'same'), Buffer.from('new\n')])
    },
  }
}

describe('buildDiffFiles', () => {
  it('builds patches in the original order with bounded concurrency', async () => {
    const blobs = store()
    const files = await buildDiffFiles(
      Array.from({ length: 12 }, (_, i) => change(i)),
      blobs.fetch,
      { concurrency: 3 },
    )
    expect(files.map((file) => file.path)).toEqual(
      Array.from({ length: 12 }, (_, i) => 'src/file' + i + '.ts'),
    )
    expect(files.every((file) => file.additions === 1 && file.patch?.startsWith('@@'))).toBe(true)
    expect(blobs.maxInFlight()).toBeLessThanOrEqual(3 * 2)
  })

  it('caps the file count', async () => {
    const files = await buildDiffFiles(
      Array.from({ length: 10 }, (_, i) => change(i)),
      store().fetch,
      { maxFiles: 4 },
    )
    expect(files).toHaveLength(4)
  })

  it('stops downloading once the byte budget is spent; later files say diff_budget', async () => {
    const blobs = store(50)
    const files = await buildDiffFiles(
      Array.from({ length: 20 }, (_, i) => change(i)),
      blobs.fetch,
      { maxTotalBytes: 3000, concurrency: 1 },
    )
    const omitted = files.filter((file) => file.patchOmitted === 'diff_budget')
    expect(omitted.length).toBeGreaterThan(0)
    expect(files[0].patch).toBeDefined()
    // Every omitted file comes after every diffed one, and none of them was downloaded.
    const firstOmitted = files.findIndex((file) => file.patchOmitted === 'diff_budget')
    expect(files.slice(firstOmitted).every((file) => file.patchOmitted === 'diff_budget')).toBe(
      true,
    )
    expect(blobs.calls).toHaveLength(firstOmitted * 2)
  })

  it('stops diffing once the diff-time budget is spent', async () => {
    let t = 0
    const files = await buildDiffFiles(
      Array.from({ length: 6 }, (_, i) => change(i)),
      store().fetch,
      { maxDiffMs: 100, concurrency: 1 },
      {
        // Two clock reads per diff, 30 ms apart: each diff "costs" 30 ms.
        now: () => {
          t += 30
          return t
        },
        yieldToLoop: async () => {},
      },
    )
    // 4 diffs = 120 ms >= 100 ms: the 5th and 6th are skipped.
    expect(files.slice(0, 4).every((file) => file.patch !== undefined)).toBe(true)
    expect(files.slice(4).map((file) => file.patchOmitted)).toEqual(['diff_budget', 'diff_budget'])
  })

  it('marks a side over the per-file cap as too_large (cap error or oversize body)', async () => {
    const fetch: FetchBlob = async (id, maxBytes) => {
      if (id === 'head0') throw new AzureTooLargeError('big', { method: 'GET', endpoint: 'x' })
      if (id === 'head1') return new Uint8Array(maxBytes)
      return text(2, id)
    }
    const files = await buildDiffFiles([change(0), change(1), change(2)], fetch, {
      maxFileBytes: 100,
    })
    expect(files.map((file) => file.patchOmitted)).toEqual(['too_large', 'too_large', undefined])
    expect(files[0].patch).toBeUndefined()
  })

  it('never downloads binary extensions or pure renames; propagates other errors', async () => {
    const blobs = store()
    const files = await buildDiffFiles(
      [
        change(0, { path: 'assets/logo.PNG' }),
        change(1, {
          status: 'renamed',
          previousPath: 'old.ts',
          baseObjectId: 'same',
          headObjectId: 'same',
        }),
        change(2, { status: 'added', baseObjectId: null }),
      ],
      blobs.fetch,
    )
    expect(files[0]).toMatchObject({ isBinary: true })
    expect(files[1]).toMatchObject({ status: 'renamed', previousPath: 'old.ts', additions: 0 })
    expect(files[1].patch).toBeUndefined()
    expect(files[2].additions).toBe(6)
    expect(blobs.calls).toEqual(['head2'])

    await expect(
      buildDiffFiles([change(0)], async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
  })

  it('knows common binary extensions', () => {
    expect(hasBinaryExtension('a/b/c.woff2')).toBe(true)
    expect(hasBinaryExtension('a/b/c.ts')).toBe(false)
    expect(hasBinaryExtension('.png')).toBe(false)
  })
})
