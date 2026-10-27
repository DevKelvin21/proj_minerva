import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildZip, type TestEntry } from './fixtures/test-zip'
import { classifyEntry, commonRoot, extractZipSafely, unsafePathReason } from './zip-extract'

let work: string
let dest: string

beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), 'minerva-zip-'))
  dest = join(work, 'out')
  await rm(dest, { recursive: true, force: true })
  await mkdir(dest)
})

afterEach(async () => {
  await rm(work, { recursive: true, force: true })
})

async function writeZip(entries: TestEntry[]): Promise<string> {
  const path = join(work, 'repo.zip')
  await writeFile(path, buildZip(entries))
  return path
}

describe('extractZipSafely', () => {
  it('extracts files, strips a single wrapper folder and drops exec bits', async () => {
    const zip = await writeZip([
      { name: 'repo/' },
      { name: 'repo/README.md', data: '# hi\n' },
      { name: 'repo/src/app.ts', data: 'export const x = 1\n'.repeat(50), deflate: true },
      { name: 'repo/bin/run.sh', data: 'echo hi\n', mode: 0o100755 },
    ])
    const result = await extractZipSafely(zip, dest)

    expect(result.strippedRoot).toBe('repo')
    expect(result.files).toBe(3)
    expect(await readFile(join(dest, 'README.md'), 'utf8')).toBe('# hi\n')
    expect((await readFile(join(dest, 'src/app.ts'), 'utf8')).length).toBe(19 * 50)
    expect((await stat(join(dest, 'bin/run.sh'))).mode & 0o111).toBe(0)
  })

  it('keeps layout when there is no wrapper folder', async () => {
    const zip = await writeZip([
      { name: 'a.txt', data: 'a' },
      { name: 'dir/b.txt', data: 'b' },
    ])
    const result = await extractZipSafely(zip, dest)
    expect(result.strippedRoot).toBeUndefined()
    expect((await readdir(dest)).sort()).toEqual(['a.txt', 'dir'])
  })

  it('skips symlinks and special files instead of writing them', async () => {
    const zip = await writeZip([
      { name: 'r/ok.txt', data: 'ok' },
      { name: 'r/link', data: '/etc/passwd', mode: 0o120777 },
      { name: 'r/fifo', mode: 0o010644 },
    ])
    const result = await extractZipSafely(zip, dest)
    expect(result.skipped).toEqual([
      { path: 'link', reason: 'symlink' },
      { path: 'fifo', reason: 'special' },
    ])
    expect(await readdir(dest)).toEqual(['ok.txt'])
  })

  it('rejects traversal and absolute paths', async () => {
    for (const name of ['../evil.txt', 'r/../../evil.txt', '/etc/evil']) {
      const zip = await writeZip([{ name, data: 'x' }])
      await expect(extractZipSafely(zip, dest)).rejects.toMatchObject({ reason: 'unsafe-path' })
    }
    expect(await readdir(work)).toEqual(expect.not.arrayContaining(['evil.txt']))
  })

  it('enforces the compressed, declared and entry-count caps before writing', async () => {
    const zip = await writeZip([
      { name: 'r/a.txt', data: 'a'.repeat(1000), deflate: true },
      { name: 'r/b.txt', data: 'b' },
    ])
    await expect(extractZipSafely(zip, dest, { maxZipBytes: 10 })).rejects.toMatchObject({
      reason: 'too-large',
    })
    await expect(extractZipSafely(zip, dest, { maxExtractedBytes: 500 })).rejects.toMatchObject({
      reason: 'too-large',
    })
    await expect(extractZipSafely(zip, dest, { maxEntries: 1 })).rejects.toMatchObject({
      reason: 'too-many-entries',
    })
    expect(await readdir(dest)).toEqual([])
  })

  it('reports a corrupt archive', async () => {
    const path = join(work, 'bad.zip')
    await writeFile(path, 'not a zip')
    await expect(extractZipSafely(path, dest)).rejects.toMatchObject({ reason: 'corrupt' })
  })
})

describe('helpers', () => {
  it('commonRoot needs every entry under one folder', () => {
    expect(commonRoot(['r/', 'r/a', 'r/b/c'])).toBe('r')
    expect(commonRoot(['r/a', 'x/b'])).toBeUndefined()
    expect(commonRoot(['top.txt', 'r/a'])).toBeUndefined()
  })

  it('unsafePathReason', () => {
    expect(unsafePathReason('src/a.ts')).toBeNull()
    expect(unsafePathReason('a/../b')).toBe('parent segment')
    expect(unsafePathReason('C:/x')).toBe('absolute path')
    expect(unsafePathReason('a\\b')).toBe('backslash in name')
    expect(unsafePathReason('..foo')).toBeNull()
    expect(unsafePathReason('docs/NUL.txt', 'win32')).toBe('reserved Windows device name')
    expect(unsafePathReason('a.txt:stream', 'win32')).toBe('colon in name (NTFS stream)')
    expect(unsafePathReason('docs/NUL.txt', 'darwin')).toBeNull()
  })

  it('classifyEntry ignores mode bits from non-unix archives', () => {
    const fromDos = {
      fileName: 'x',
      externalFileAttributes: (0o120777 << 16) >>> 0,
      versionMadeBy: 20,
    }
    expect(classifyEntry(fromDos)).toBe('file')
    expect(classifyEntry({ fileName: 'd', externalFileAttributes: 0x10, versionMadeBy: 20 })).toBe(
      'directory',
    )
  })
})
