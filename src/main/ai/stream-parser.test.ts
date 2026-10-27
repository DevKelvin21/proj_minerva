import { describe, expect, it, vi } from 'vitest'
import { StreamSectionParser, stringifySections } from './stream-parser'
import { richDidacticSections } from './fixtures'
import type { DidacticSection } from '../../shared/types'

/** Empuja `text` a `parser` en `n` trozos de tamaño parejo, cortando en cualquier punto (incluso a mitad de un marcador). */
function pushInChunks(parser: StreamSectionParser, text: string, n: number): void {
  const size = Math.max(1, Math.ceil(text.length / n))
  for (let i = 0; i < text.length; i += size) {
    parser.push(text.slice(i, i + size))
  }
}

describe('StreamSectionParser', () => {
  it('stream vacío: snapshot() es [] y finalize() lanza', () => {
    const parser = new StreamSectionParser()
    expect(parser.snapshot()).toEqual([])
    expect(() => parser.finalize()).toThrow('None of the sections')
  })

  it('ignora texto huérfano antes de la primera sección', () => {
    const parser = new StreamSectionParser()
    parser.push('esto es ruido antes de cualquier marcador\nmás ruido\n')
    parser.push('@@@SECTION kind=summary\nhola\n')
    const final = parser.finalize()
    expect(final).toEqual([{ kind: 'summary', markdown: 'hola' }])
  })

  it('acumula markdown de una sección summary en vivo, con streaming:true en la abierta', () => {
    const parser = new StreamSectionParser()
    parser.push('@@@SECTION kind=summary\n')
    parser.push('primera línea\n')
    let snap = parser.snapshot()
    expect(snap).toEqual([{ kind: 'summary', markdown: 'primera línea', streaming: true }])

    parser.push('segunda línea\n')
    snap = parser.snapshot()
    expect(snap).toEqual([
      { kind: 'summary', markdown: 'primera línea\nsegunda línea', streaming: true },
    ])

    const final = parser.finalize()
    expect(final).toEqual([{ kind: 'summary', markdown: 'primera línea\nsegunda línea' }])
  })

  it('varias secciones cerradas no llevan streaming, solo la última abierta', () => {
    const parser = new StreamSectionParser()
    parser.push('@@@SECTION kind=summary\nresumen\n@@@SECTION kind=endpoint\n')
    parser.push('doc del endpoint\n')

    const snap = parser.snapshot()
    expect(snap).toEqual([
      { kind: 'summary', markdown: 'resumen' },
      { kind: 'endpoint', markdown: 'doc del endpoint', snippets: [], streaming: true },
    ])
  })

  it('no expone mermaid en el snapshot mientras el bloque no cerró', () => {
    const parser = new StreamSectionParser()
    parser.push('@@@SECTION kind=architecture\ntexto antes\n@@@MERMAID\nC4Context\n')

    const snap = parser.snapshot()
    expect(snap).toHaveLength(1)
    const section = snap[0]
    expect(section.kind).toBe('architecture')
    expect(section.markdown).toBe('texto antes')
    expect('mermaid' in section).toBe(false)
  })

  it('expone el mermaid recién cerrado, y permite markdown adicional después', () => {
    const parser = new StreamSectionParser()
    parser.push(
      '@@@SECTION kind=architecture\ntexto antes\n@@@MERMAID\nC4Context\n  title x\n@@@END_MERMAID\ntexto después\n',
    )

    const snap = parser.snapshot()
    expect(snap).toEqual([
      {
        kind: 'architecture',
        markdown: 'texto antes\ntexto después',
        mermaid: 'C4Context\n  title x\n',
        streaming: true,
      },
    ])
  })

  it('mermaid multichunk: el DSL llega partido en varios push() y se ensambla igual', () => {
    const parser = new StreamSectionParser()
    const fullText =
      '@@@SECTION kind=architecture\nintro\n@@@MERMAID\nC4Container\n  title Impacto\n  Person(a, "A")\n@@@END_MERMAID\n'

    pushInChunks(parser, fullText, 7)

    const final = parser.finalize()
    expect(final).toEqual([
      {
        kind: 'architecture',
        markdown: 'intro',
        mermaid: 'C4Container\n  title Impacto\n  Person(a, "A")\n',
      },
    ])
  })

  it('tolera un marcador cortado a la mitad entre dos push()', () => {
    const parser = new StreamSectionParser()
    parser.push('@@@SEC')
    parser.push('TION kind=sum')
    parser.push('mary\nhola mundo\n')

    const final = parser.finalize()
    expect(final).toEqual([{ kind: 'summary', markdown: 'hola mundo' }])
  })

  it('tolera @@@END_MERMAID cortado a la mitad entre push()', () => {
    const parser = new StreamSectionParser()
    parser.push('@@@SECTION kind=schema\ntexto\n@@@MERMAID\nerDiagram\n  A ||--o{ B : x\n@@@END_ME')
    parser.push('RMAID\n')

    const final = parser.finalize()
    expect(final).toEqual([
      { kind: 'schema', markdown: 'texto', mermaid: 'erDiagram\n  A ||--o{ B : x\n' },
    ])
  })

  it('snippet con atributos: label y language se parsean y el código se preserva', () => {
    const parser = new StreamSectionParser()
    parser.push(
      '@@@SECTION kind=endpoint\ndoc\n@@@SNIPPET label=curl language=curl\n' +
        'curl -X POST http://localhost:3000/x \\\n  -d \'{"a":1}\'\n@@@END_SNIPPET\n',
    )

    const final = parser.finalize()
    expect(final).toEqual([
      {
        kind: 'endpoint',
        markdown: 'doc',
        snippets: [
          {
            label: 'curl',
            language: 'curl',
            code: 'curl -X POST http://localhost:3000/x \\\n  -d \'{"a":1}\'',
          },
        ],
      },
    ])
  })

  it('un snippet con language inválido se descarta sin tumbar la sección', () => {
    const parser = new StreamSectionParser()
    parser.push(
      '@@@SECTION kind=endpoint\ndoc\n@@@SNIPPET label=bad language=python\nprint(1)\n@@@END_SNIPPET\n',
    )

    const final = parser.finalize()
    expect(final).toEqual([{ kind: 'endpoint', markdown: 'doc', snippets: [] }])
  })

  it('un snippet no aparece en el snapshot mientras no cerró', () => {
    const parser = new StreamSectionParser()
    parser.push('@@@SECTION kind=endpoint\ndoc\n@@@SNIPPET label=curl language=curl\ncurl ...\n')

    const snap = parser.snapshot()
    expect(snap).toEqual([
      { kind: 'endpoint', markdown: 'doc', snippets: [], streaming: true },
    ])
  })

  it('parsea una sección setup con snippet bash', () => {
    const parser = new StreamSectionParser()
    parser.push(
      '@@@SECTION kind=setup\ninstructivo\n@@@SNIPPET label=arranque-local language=bash\n' +
        'npm install\nnpm run dev\n@@@END_SNIPPET\n',
    )

    const final = parser.finalize()
    expect(final).toEqual([
      {
        kind: 'setup',
        markdown: 'instructivo',
        snippets: [
          { label: 'arranque-local', language: 'bash', code: 'npm install\nnpm run dev' },
        ],
      },
    ])
  })

  it('una sección con kind desconocido se descarta pero no rompe el resto del stream', () => {
    const parser = new StreamSectionParser()
    parser.push('@@@SECTION kind=foobar\ncontenido descartable\n@@@SECTION kind=summary\nok\n')

    const snap = parser.snapshot()
    expect(snap).toEqual([{ kind: 'summary', markdown: 'ok', streaming: true }])

    const final = parser.finalize()
    expect(final).toEqual([{ kind: 'summary', markdown: 'ok' }])
  })

  it('un marcador desconocido se trata como texto normal dentro de la sección abierta', () => {
    const parser = new StreamSectionParser()
    parser.push('@@@SECTION kind=summary\nantes\n@@@NOPE algo raro\ndespués\n')

    const final = parser.finalize()
    expect(final).toEqual([{ kind: 'summary', markdown: 'antes\n@@@NOPE algo raro\ndespués' }])
  })

  it('un @@@SECTION con un mermaid sin cerrar descarta el bloque parcial en vez de colarlo', () => {
    const parser = new StreamSectionParser()
    parser.push(
      '@@@SECTION kind=architecture\ntexto\n@@@MERMAID\nC4Context\n(sin cerrar)\n@@@SECTION kind=summary\nresumen\n',
    )

    const final = parser.finalize()
    // La sección architecture no sobrevive (sin mermaid válido); solo queda summary.
    expect(final).toEqual([{ kind: 'summary', markdown: 'resumen' }])
  })

  it('finalize() procesa la última línea aunque el stream no termine en \\n', () => {
    const parser = new StreamSectionParser()
    parser.push('@@@SECTION kind=summary\nlínea sin salto final')
    const final = parser.finalize()
    expect(final).toEqual([{ kind: 'summary', markdown: 'línea sin salto final' }])
  })

  it('finalize() descarta secciones vacías/inválidas y logea cada descarte', () => {
    const log = vi.fn()
    const parser = new StreamSectionParser()
    parser.push('@@@SECTION kind=architecture\ntexto sin mermaid\n@@@SECTION kind=summary\nok\n')

    const final = parser.finalize(log)
    expect(final).toEqual([{ kind: 'summary', markdown: 'ok' }])
    expect(log).toHaveBeenCalled()
  })

  it('finalize() lanza si ninguna sección sobrevive', () => {
    const parser = new StreamSectionParser()
    parser.push('@@@SECTION kind=architecture\ntexto sin mermaid nunca cerrado\n')
    expect(() => parser.finalize()).toThrow('None of the sections')
  })

  describe('kind=cloud (T75)', () => {
    it('parsea una sección cloud con 2 bloques MERMAID en orden', () => {
      const parser = new StreamSectionParser()
      parser.push(
        '@@@SECTION kind=cloud\ntexto\n' +
          '@@@MERMAID\nC4Context\n  title big picture\n@@@END_MERMAID\n' +
          '@@@MERMAID\nC4Container\n  title zoom\n@@@END_MERMAID\n',
      )

      const final = parser.finalize()
      expect(final).toEqual([
        {
          kind: 'cloud',
          markdown: 'texto',
          mermaids: ['C4Context\n  title big picture\n', 'C4Container\n  title zoom\n'],
        },
      ])
    })

    it('una sección cloud con 1 bloque es válida', () => {
      const parser = new StreamSectionParser()
      parser.push(
        '@@@SECTION kind=cloud\ntexto\n@@@MERMAID\nC4Context\n  x\n@@@END_MERMAID\n',
      )

      const final = parser.finalize()
      expect(final).toEqual([
        { kind: 'cloud', markdown: 'texto', mermaids: ['C4Context\n  x\n'] },
      ])
    })

    it('una sección cloud sin ningún bloque MERMAID es válida (solo markdown)', () => {
      const parser = new StreamSectionParser()
      parser.push('@@@SECTION kind=cloud\nsolo texto, sin diagramas\n')

      const final = parser.finalize()
      expect(final).toEqual([
        { kind: 'cloud', markdown: 'solo texto, sin diagramas', mermaids: [] },
      ])
    })

    it('streaming incremental: el draft pasa de 0 a 1 a 2 diagramas al cerrarse cada bloque', () => {
      const parser = new StreamSectionParser()
      parser.push('@@@SECTION kind=cloud\ntexto\n')

      let snap = parser.snapshot()
      expect(snap).toEqual([
        { kind: 'cloud', markdown: 'texto', mermaids: [], streaming: true },
      ])

      parser.push('@@@MERMAID\nC4Context\n  big picture\n')
      snap = parser.snapshot()
      // Bloque todavía abierto: no entra al array.
      expect(snap).toEqual([
        { kind: 'cloud', markdown: 'texto', mermaids: [], streaming: true },
      ])

      parser.push('@@@END_MERMAID\n')
      snap = parser.snapshot()
      expect(snap).toEqual([
        {
          kind: 'cloud',
          markdown: 'texto',
          mermaids: ['C4Context\n  big picture\n'],
          streaming: true,
        },
      ])

      parser.push('@@@MERMAID\nC4Container\n  zoom\n@@@END_MERMAID\n')
      snap = parser.snapshot()
      expect(snap).toEqual([
        {
          kind: 'cloud',
          markdown: 'texto',
          mermaids: ['C4Context\n  big picture\n', 'C4Container\n  zoom\n'],
          streaming: true,
        },
      ])
    })

    it('round-trip: stringifySections de una sección cloud con 2 diagramas se re-parsea idéntica', () => {
      const original: DidacticSection[] = [
        {
          kind: 'cloud',
          markdown: 'La infra corre en AWS con CDN de Cloudflare.',
          mermaids: [
            'C4Context\n  title Infra actual\n  System(app, "App")\n',
            'C4Container\n  title Zoom al cambio\n  Container(api, "API")\n',
          ],
        },
      ]
      const text = stringifySections(original)

      const parser = new StreamSectionParser()
      pushInChunks(parser, text, 6)
      const final = parser.finalize()

      expect(final).toEqual(original)
    })

    it('round-trip: sección cloud sin diagramas', () => {
      const original: DidacticSection[] = [
        { kind: 'cloud', markdown: 'Sin cambios de infra en este PR.', mermaids: [] },
      ]
      const text = stringifySections(original)

      const parser = new StreamSectionParser()
      parser.push(text)
      const final = parser.finalize()

      expect(final).toEqual(original)
    })
  })
})

describe('stringifySections + StreamSectionParser (round-trip)', () => {
  it('serializar y volver a parsear una fixture real produce las mismas secciones', () => {
    const original = richDidacticSections['github:shopwave/api#482']
    const text = stringifySections(original)

    const parser = new StreamSectionParser()
    parser.push(text)
    const final = parser.finalize()

    expect(final).toEqual(original)
  })

  it('round-trip también funciona repartiendo el texto en varios trozos', () => {
    const original = richDidacticSections['github:shopwave/web#201']
    const text = stringifySections(original)

    const parser = new StreamSectionParser()
    pushInChunks(parser, text, 6)
    const final = parser.finalize()

    expect(final).toEqual(original)
  })

  it('round-trip de la fixture con schema/erDiagram', () => {
    const original = richDidacticSections['github:shopwave/api#479']
    const text = stringifySections(original)

    const parser = new StreamSectionParser()
    pushInChunks(parser, text, 6)
    const final = parser.finalize()

    expect(final).toEqual(original)
  })

  it('round-trip de una sección setup con snippets bash y env', () => {
    const original: DidacticSection[] = [
      {
        kind: 'setup',
        markdown: 'instructivo de arranque',
        snippets: [
          { label: 'arranque-local', language: 'bash', code: 'npm install\nnpm run dev' },
          { label: 'env', language: 'env', code: 'DATABASE_URL=postgres://localhost:5432/x\nPORT=3000' },
        ],
      },
    ]
    const text = stringifySections(original)

    const parser = new StreamSectionParser()
    pushInChunks(parser, text, 5)
    const final = parser.finalize()

    expect(final).toEqual(original)
  })
})
