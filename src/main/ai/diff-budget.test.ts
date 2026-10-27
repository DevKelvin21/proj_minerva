import { describe, expect, it } from 'vitest'
import { buildDiffBudget, TOTAL_DIFF_BUDGET_CHARS } from './diff-budget'
import type { DiffFile } from '../../shared/types'

function file(overrides: Partial<DiffFile> & Pick<DiffFile, 'path'>): DiffFile {
  return {
    status: 'modified',
    additions: 1,
    deletions: 1,
    isBinary: false,
    patch: '@@ -1,1 +1,1 @@\n-old\n+new',
    ...overrides,
  }
}

describe('buildDiffBudget', () => {
  it('incluye todos los archivos cuando entran cómodos en el presupuesto', () => {
    const files = [file({ path: 'a.ts' }), file({ path: 'b.ts' })]
    const result = buildDiffBudget(files)

    expect(result.omittedFiles).toEqual([])
    expect(result.blocks).toHaveLength(2)
    expect(result.blocks[0]).toContain('a.ts')
    expect(result.blocks[0]).toContain('old')
    expect(result.blocks[1]).toContain('b.ts')
  })

  it('marca archivos binarios sin consumir presupuesto de patch', () => {
    const files = [file({ path: 'image.png', isBinary: true, patch: undefined })]
    const result = buildDiffBudget(files)

    expect(result.omittedFiles).toEqual([])
    expect(result.blocks[0]).toContain('image.png')
    expect(result.blocks[0]).toContain('no text patch')
  })

  it('trunca el patch de un archivo que excede el presupuesto disponible', () => {
    const hugePatch = 'x'.repeat(TOTAL_DIFF_BUDGET_CHARS + 1000)
    const files = [file({ path: 'huge.ts', patch: hugePatch })]
    const result = buildDiffBudget(files)

    expect(result.omittedFiles).toEqual([])
    expect(result.blocks).toHaveLength(1)
    expect(result.blocks[0]).toContain('[truncated')
    expect(result.blocks[0].length).toBeLessThan(hugePatch.length)
  })

  it('omite archivos que ya no entran tras agotar el presupuesto', () => {
    const hugePatch = 'x'.repeat(TOTAL_DIFF_BUDGET_CHARS + 1000)
    const files = [file({ path: 'huge.ts', patch: hugePatch }), file({ path: 'small.ts' })]
    const result = buildDiffBudget(files)

    expect(result.omittedFiles).toEqual(['small.ts'])
    expect(result.blocks).toHaveLength(1)
    expect(result.blocks[0]).toContain('huge.ts')
  })

  it('preserva el orden original de los archivos incluidos', () => {
    const files = [file({ path: 'z.ts' }), file({ path: 'a.ts' }), file({ path: 'm.ts' })]
    const result = buildDiffBudget(files)

    expect(result.blocks.map((b) => (b.match(/### ([^\s]+)/) ?? [])[1])).toEqual([
      'z.ts',
      'a.ts',
      'm.ts',
    ])
  })

  it('lista con el nombre anterior los archivos renombrados', () => {
    const files = [file({ path: 'new-name.ts', previousPath: 'old-name.ts', status: 'renamed' })]
    const result = buildDiffBudget(files)

    expect(result.blocks[0]).toContain('new-name.ts')
    expect(result.blocks[0]).toContain('old-name.ts')
  })
})
