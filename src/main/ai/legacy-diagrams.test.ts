import { describe, expect, it } from 'vitest'
import { normalizeStoredSection, upgradeLegacySection } from './legacy-diagrams'
import { MAX_DIAGRAM_SOURCE_CHARS } from './section-mapper'

describe('upgradeLegacySection', () => {
  it('turns architecture/schema mermaid strings into mermaid diagrams', () => {
    expect(upgradeLegacySection({ kind: 'architecture', markdown: 'm', mermaid: 'C4Context\n' })).toEqual({
      kind: 'architecture',
      markdown: 'm',
      diagram: { format: 'mermaid', source: 'C4Context\n' },
    })
    expect(upgradeLegacySection({ kind: 'schema', markdown: 'm', mermaid: 'erDiagram' })).toEqual({
      kind: 'schema',
      markdown: 'm',
      diagram: { format: 'mermaid', source: 'erDiagram' },
    })
  })

  it('turns cloud mermaids into diagrams, dropping blanks', () => {
    expect(upgradeLegacySection({ kind: 'cloud', markdown: 'm', mermaids: ['a', ' ', 3] })).toEqual({
      kind: 'cloud',
      markdown: 'm',
      diagrams: [{ format: 'mermaid', source: 'a' }],
    })
  })

  it('upgrades walkthrough layers and leaves layers without a diagram alone', () => {
    const upgraded = upgradeLegacySection({
      kind: 'walkthrough',
      markdown: '',
      cohorts: [
        {
          title: 'C',
          layers: [
            { title: 'a', markdown: '', files: [], mermaid: 'flowchart TD\n' },
            { title: 'b', markdown: '', files: [] },
          ],
        },
      ],
    })
    expect(upgraded).toEqual({
      kind: 'walkthrough',
      markdown: '',
      cohorts: [
        {
          title: 'C',
          layers: [
            { title: 'a', markdown: '', files: [], diagram: { format: 'mermaid', source: 'flowchart TD\n' } },
            { title: 'b', markdown: '', files: [] },
          ],
        },
      ],
    })
  })

  it('passes current sections through untouched', () => {
    const current = { kind: 'architecture', markdown: 'm', diagram: { format: 'html', source: '<p/>' } }
    expect(upgradeLegacySection(current)).toBe(current)
    expect(upgradeLegacySection(null)).toBeNull()
  })
})

describe('normalizeStoredSection', () => {
  const huge = 'x'.repeat(MAX_DIAGRAM_SOURCE_CHARS + 1)

  it('drops a section whose required diagram is invalid or oversized', () => {
    expect(normalizeStoredSection({ kind: 'architecture', markdown: 'm', diagram: { format: 'html', source: huge } })).toBeNull()
    expect(normalizeStoredSection({ kind: 'schema', markdown: 'm', diagram: { format: 'svg', source: '<svg/>' } })).toBeNull()
    expect(normalizeStoredSection({ kind: 'schema', markdown: 'm', mermaid: huge })).toBeNull()
  })

  it('drops only the bad optional diagrams', () => {
    expect(
      normalizeStoredSection({ kind: 'cloud', markdown: 'm', diagrams: [{ format: 'html', source: huge }, { format: 'html', source: '<p/>' }] }),
    ).toEqual({ kind: 'cloud', markdown: 'm', diagrams: [{ format: 'html', source: '<p/>' }] })
    expect(
      normalizeStoredSection({
        kind: 'walkthrough',
        markdown: '',
        cohorts: [{ title: 'C', layers: [{ title: 'a', markdown: '', files: [], diagram: { format: 'html', source: huge } }] }],
      }),
    ).toEqual({ kind: 'walkthrough', markdown: '', cohorts: [{ title: 'C', layers: [{ title: 'a', markdown: '', files: [] }] }] })
  })

  it('keeps valid sections as they are', () => {
    const section = { kind: 'architecture', markdown: 'm', diagram: { format: 'html', source: '<p/>' } }
    expect(normalizeStoredSection(section)).toEqual(section)
    expect(normalizeStoredSection({ kind: 'summary', markdown: 's' })).toEqual({ kind: 'summary', markdown: 's' })
  })
})
