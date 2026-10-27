import { describe, expect, it } from 'vitest'
import { mapRawSection, mapSnippet, parseFileRefs } from './section-mapper'

describe('mapRawSection', () => {
  it('mapea una sección summary válida', () => {
    expect(mapRawSection({ kind: 'summary', markdown: '## hola' })).toEqual({
      kind: 'summary',
      markdown: '## hola',
    })
  })

  it('mapea una sección architecture válida', () => {
    expect(
      mapRawSection({ kind: 'architecture', markdown: 'texto', mermaid: 'C4Context\n  x' }),
    ).toEqual({ kind: 'architecture', markdown: 'texto', mermaid: 'C4Context\n  x' })
  })

  it('mapea una sección schema válida', () => {
    expect(mapRawSection({ kind: 'schema', markdown: 'texto', mermaid: 'erDiagram' })).toEqual({
      kind: 'schema',
      markdown: 'texto',
      mermaid: 'erDiagram',
    })
  })

  it('mapea una sección endpoint válida con snippets', () => {
    expect(
      mapRawSection({
        kind: 'endpoint',
        markdown: 'texto',
        snippets: [{ label: 'curl', language: 'curl', code: 'curl ...' }],
      }),
    ).toEqual({
      kind: 'endpoint',
      markdown: 'texto',
      snippets: [{ label: 'curl', language: 'curl', code: 'curl ...' }],
    })
  })

  it('mapea una sección setup válida con snippets bash/env', () => {
    expect(
      mapRawSection({
        kind: 'setup',
        markdown: 'texto',
        snippets: [
          { label: 'arranque-local', language: 'bash', code: 'npm install\nnpm run dev' },
          { label: 'env', language: 'env', code: 'DATABASE_URL=postgres://localhost:5432/x' },
        ],
      }),
    ).toEqual({
      kind: 'setup',
      markdown: 'texto',
      snippets: [
        { label: 'arranque-local', language: 'bash', code: 'npm install\nnpm run dev' },
        { label: 'env', language: 'env', code: 'DATABASE_URL=postgres://localhost:5432/x' },
      ],
    })
  })

  it('acepta snippets con language bash y env', () => {
    expect(mapSnippet({ label: 'x', language: 'bash', code: 'npm install' })).toEqual({
      label: 'x',
      language: 'bash',
      code: 'npm install',
    })
    expect(mapSnippet({ label: 'x', language: 'env', code: 'FOO=bar' })).toEqual({
      label: 'x',
      language: 'env',
      code: 'FOO=bar',
    })
  })

  it('sigue rechazando un language inválido', () => {
    expect(mapSnippet({ label: 'x', language: 'python', code: 'print(1)' })).toBeNull()
  })

  it('rechaza setup sin array de snippets', () => {
    expect(mapRawSection({ kind: 'setup', markdown: 'texto' })).toBeNull()
    expect(mapRawSection({ kind: 'setup', markdown: 'texto', snippets: 'x' })).toBeNull()
  })

  it('descarta snippets individuales malformados dentro de un endpoint válido', () => {
    const result = mapRawSection({
      kind: 'endpoint',
      markdown: 'texto',
      snippets: [
        { label: 'curl', language: 'curl', code: 'curl ...' },
        { label: 'bad', language: 'python', code: 'print(1)' },
        { label: 'no code', language: 'http' },
      ],
    })
    expect(result).toEqual({
      kind: 'endpoint',
      markdown: 'texto',
      snippets: [{ label: 'curl', language: 'curl', code: 'curl ...' }],
    })
  })

  it('rechaza architecture/schema sin mermaid', () => {
    expect(mapRawSection({ kind: 'architecture', markdown: 'texto' })).toBeNull()
    expect(mapRawSection({ kind: 'schema', markdown: 'texto' })).toBeNull()
  })

  it('mapea una sección cloud válida con 2 diagramas', () => {
    expect(
      mapRawSection({
        kind: 'cloud',
        markdown: 'texto',
        mermaids: ['C4Context\n  big picture', 'C4Container\n  zoom'],
      }),
    ).toEqual({
      kind: 'cloud',
      markdown: 'texto',
      mermaids: ['C4Context\n  big picture', 'C4Container\n  zoom'],
    })
  })

  it('mapea una sección cloud válida con 1 diagrama', () => {
    expect(
      mapRawSection({ kind: 'cloud', markdown: 'texto', mermaids: ['C4Context\n  x'] }),
    ).toEqual({ kind: 'cloud', markdown: 'texto', mermaids: ['C4Context\n  x'] })
  })

  it('mapea una sección cloud válida sin diagramas (nunca null solo por faltar mermaid)', () => {
    expect(mapRawSection({ kind: 'cloud', markdown: 'texto', mermaids: [] })).toEqual({
      kind: 'cloud',
      markdown: 'texto',
      mermaids: [],
    })
    expect(mapRawSection({ kind: 'cloud', markdown: 'texto' })).toEqual({
      kind: 'cloud',
      markdown: 'texto',
      mermaids: [],
    })
  })

  it('descarta mermaids individuales malformados de una sección cloud sin invalidarla', () => {
    expect(
      mapRawSection({ kind: 'cloud', markdown: 'texto', mermaids: ['ok', '   ', 42, null] }),
    ).toEqual({ kind: 'cloud', markdown: 'texto', mermaids: ['ok'] })
  })

  it('rechaza endpoint sin snippets (o snippets no-array)', () => {
    expect(mapRawSection({ kind: 'endpoint', markdown: 'texto' })).toBeNull()
    expect(mapRawSection({ kind: 'endpoint', markdown: 'texto', snippets: 'x' })).toBeNull()
  })

  it('rechaza kind desconocido', () => {
    expect(mapRawSection({ kind: 'other', markdown: 'texto' })).toBeNull()
  })

  it('rechaza sin markdown o markdown vacío', () => {
    expect(mapRawSection({ kind: 'summary' })).toBeNull()
    expect(mapRawSection({ kind: 'summary', markdown: '   ' })).toBeNull()
  })

  it('rechaza valores que no son objetos', () => {
    expect(mapRawSection(null)).toBeNull()
    expect(mapRawSection('x')).toBeNull()
    expect(mapRawSection([1, 2])).toBeNull()
    expect(mapRawSection(42)).toBeNull()
  })
})

describe('parseFileRefs', () => {
  it('parses paths with and without ranges, merging a repeated path', () => {
    expect(parseFileRefs('src/a.ts:12-40,55; src/b.ts ;src/a.ts:60')).toEqual([
      { path: 'src/a.ts', ranges: [{ start: 12, end: 40 }, { start: 55, end: 55 }, { start: 60, end: 60 }] },
      { path: 'src/b.ts', ranges: [] },
    ])
  })

  it('keeps a colon that is not followed by ranges as part of the path, and fixes reversed ranges', () => {
    expect(parseFileRefs('C:/weird/path.ts;x.ts:9-3')).toEqual([
      { path: 'C:/weird/path.ts', ranges: [] },
      { path: 'x.ts', ranges: [{ start: 3, end: 9 }] },
    ])
  })

  it('skips empty entries and zero/negative lines', () => {
    expect(parseFileRefs(';;a.ts:0-5,2')).toEqual([{ path: 'a.ts', ranges: [{ start: 2, end: 2 }] }])
  })
})

describe('mapRawSection · walkthrough', () => {
  it('maps valid layers into cohorts and tolerates an empty intro', () => {
    const section = mapRawSection({
      kind: 'walkthrough',
      markdown: '',
      layers: [
        { cohort: 'A', title: 'one', files: [{ path: 'a.ts', ranges: [] }], markdown: 'm', mermaid: 'flowchart TD\n' },
        { cohort: 'A', title: 'two', files: [{ path: 'b.ts', ranges: [{ start: 1, end: 2 }] }], markdown: '' },
        { cohort: '', title: 'three', files: [{ path: 'c.ts', ranges: [] }], markdown: '' },
      ],
    })
    expect(section).toEqual({
      kind: 'walkthrough',
      markdown: '',
      cohorts: [
        {
          title: 'A',
          layers: [
            { title: 'one', markdown: 'm', files: [{ path: 'a.ts', ranges: [] }], mermaid: 'flowchart TD\n' },
            { title: 'two', markdown: '', files: [{ path: 'b.ts', ranges: [{ start: 1, end: 2 }] }] },
          ],
        },
        { title: '', layers: [{ title: 'three', markdown: '', files: [{ path: 'c.ts', ranges: [] }] }] },
      ],
    })
  })

  it('rejects a walkthrough without layers array or with no valid layer', () => {
    expect(mapRawSection({ kind: 'walkthrough', markdown: 'x' })).toBeNull()
    expect(mapRawSection({ kind: 'walkthrough', markdown: 'x', layers: [{ title: 'no files', files: [] }] })).toBeNull()
  })
})
