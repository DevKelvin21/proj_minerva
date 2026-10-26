import { beforeAll, describe, expect, it } from 'vitest'
import { buildPatch, looksBinary } from './patch-builder'

/**
 * The renderer's own parser is the acceptance test for our output. It lives
 * outside `tsconfig.node.json` (a static import trips TS6307 on the composite
 * project), so it is loaded at runtime and typed with the fields we check.
 */
interface ParsedLine {
  kind: 'context' | 'add' | 'del'
  oldNumber?: number
  newNumber?: number
  content: string
}
interface ParsedHunk {
  oldStart: number
  lines: ParsedLine[]
}
let parsePatch: (patch: string) => ParsedHunk[]
const DIFF_PARSER_PATH = '../../../renderer/src/lib/diff-parser'

beforeAll(async () => {
  const mod = (await import(/* @vite-ignore */ DIFF_PARSER_PATH)) as {
    parsePatch: typeof parsePatch
  }
  parsePatch = mod.parsePatch
})

const buf = (text: string): Buffer => Buffer.from(text, 'utf8')

function lines(count: number, prefix = 'line'): string {
  return Array.from({ length: count }, (_, i) => prefix + ' ' + (i + 1)).join('\n') + '\n'
}

describe('buildPatch', () => {
  it('builds a GitHub-style edit patch the renderer parser understands', () => {
    const base = lines(20)
    const head = base.replace('line 10\n', 'line ten\n')
    const result = buildPatch(buf(base), buf(head))

    expect(result.additions).toBe(1)
    expect(result.deletions).toBe(1)
    expect(result.patch?.startsWith('@@ -7,7 +7,7 @@')).toBe(true)
    expect(result.patch).not.toMatch(/^(---|\+\+\+|diff |Index:)/m)

    const hunks = parsePatch(result.patch ?? '')
    expect(hunks).toHaveLength(1)
    const del = hunks[0].lines.find((l) => l.kind === 'del')
    const add = hunks[0].lines.find((l) => l.kind === 'add')
    expect(del).toMatchObject({ oldNumber: 10, content: 'line 10' })
    expect(add).toMatchObject({ newNumber: 10, content: 'line ten' })
    // 3 lines of context on each side.
    expect(hunks[0].lines.filter((l) => l.kind === 'context')).toHaveLength(6)
  })

  it('splits distant changes into separate hunks', () => {
    const base = lines(40)
    const head = base.replace('line 2\n', 'two\n').replace('line 35\n', 'thirty-five\n')
    const hunks = parsePatch(buildPatch(buf(base), buf(head)).patch ?? '')
    expect(hunks).toHaveLength(2)
    expect(hunks[1].oldStart).toBe(32)
  })

  it('uses git ranges for added and deleted files', () => {
    const added = buildPatch(null, buf('a\nb\n'))
    expect(added.patch?.split('\n')[0]).toBe('@@ -0,0 +1,2 @@')
    expect(added.additions).toBe(2)
    expect(parsePatch(added.patch ?? '')[0].lines.map((l) => l.newNumber)).toEqual([1, 2])

    const deleted = buildPatch(buf('only\n'), null)
    expect(deleted.patch?.split('\n')[0]).toBe('@@ -1 +0,0 @@')
    expect(deleted.deletions).toBe(1)
  })

  it('keeps the no-newline-at-EOF marker and the parser ignores it', () => {
    const result = buildPatch(buf('x\ny'), buf('x\nz'))
    expect(result.patch).toContain('\\ No newline at end of file')
    const parsed = parsePatch(result.patch ?? '')
    expect(parsed[0].lines.map((l) => l.kind)).toEqual(['context', 'del', 'add'])
  })

  it('normalizes CRLF and reports a pure line-ending flip without a patch', () => {
    const crlf = buildPatch(buf('a\r\nb\r\n'), buf('a\r\nc\r\n'))
    expect(crlf.patch).not.toContain('\r')
    expect(crlf.additions).toBe(1)
    expect(crlf.lineEndingsChanged).toBe(false)

    const flip = buildPatch(buf('a\r\nb\r\n'), buf('a\nb\n'))
    expect(flip.patch).toBeUndefined()
    expect(flip.lineEndingsChanged).toBe(true)
  })

  it('returns no patch for identical content (pure rename)', () => {
    const same = buildPatch(buf('same\n'), buf('same\n'))
    expect(same).toMatchObject({ additions: 0, deletions: 0, isBinary: false, tooLarge: false })
    expect(same.patch).toBeUndefined()
  })

  it('drops a leading UTF-8 BOM', () => {
    const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), buf('a\n')])
    const result = buildPatch(bom, buf('a\nb\n'))
    expect(result.patch).toBe('@@ -1 +1,2 @@\n a\n+b')
  })

  it('flags binary content (NUL byte or invalid UTF-8)', () => {
    const png = buildPatch(Buffer.from([0x89, 0x50, 0x00, 0x47]), null)
    expect(png.isBinary).toBe(true)
    expect(png.patch).toBeUndefined()
    expect(buildPatch(null, Buffer.from([0xc3, 0x28]))).toMatchObject({ isBinary: true })
    expect(looksBinary(buf('plain ñ text'))).toBe(false)
  })

  it('caps by size before decoding', () => {
    const result = buildPatch(buf('a'.repeat(50)), buf('b'), { maxBytes: 10 })
    expect(result).toMatchObject({ tooLarge: true, isBinary: false })
    expect(result.patch).toBeUndefined()
  })
})
