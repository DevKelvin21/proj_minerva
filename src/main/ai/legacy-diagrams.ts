/**
 * Analyses persisted before HTML diagrams (`analyses.json`, `./analysis-store.ts`)
 * carry Mermaid as bare strings: `mermaid` on `architecture`/`schema` and on
 * walkthrough layers, `mermaids` on `cloud`. This upgrades one persisted
 * section to the `DidacticDiagram` shape (`{ format: 'mermaid', source }`) so
 * the renderer keeps drawing them with Mermaid; new analyses never produce
 * those fields. Pure and tolerant: anything that is not a legacy field passes
 * through untouched, and the store's own validation still runs afterwards.
 */
import type { DidacticDiagram } from '../../shared/types'
import { mapDiagram } from './section-mapper'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function legacyMermaid(value: unknown): DidacticDiagram | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? { format: 'mermaid', source: value }
    : undefined
}

function upgradeLayer(layer: unknown): unknown {
  if (!isRecord(layer) || !('mermaid' in layer)) return layer
  const { mermaid, ...rest } = layer
  const diagram = legacyMermaid(mermaid)
  return diagram && !('diagram' in rest) ? { ...rest, diagram } : rest
}

export function upgradeLegacySection(section: unknown): unknown {
  if (!isRecord(section)) return section

  if (section.kind === 'walkthrough' && Array.isArray(section.cohorts)) {
    return {
      ...section,
      cohorts: section.cohorts.map((cohort) =>
        isRecord(cohort) && Array.isArray(cohort.layers)
          ? { ...cohort, layers: cohort.layers.map(upgradeLayer) }
          : cohort,
      ),
    }
  }

  if ((section.kind === 'architecture' || section.kind === 'schema') && 'mermaid' in section) {
    const { mermaid, ...rest } = section
    const diagram = legacyMermaid(mermaid)
    return 'diagram' in rest || !diagram ? rest : { ...rest, diagram }
  }

  if (section.kind === 'cloud' && 'mermaids' in section) {
    const { mermaids, ...rest } = section
    if ('diagrams' in rest) return rest
    const diagrams = Array.isArray(mermaids)
      ? mermaids.map(legacyMermaid).filter((d): d is DidacticDiagram => d !== undefined)
      : []
    return { ...rest, diagrams }
  }

  return section
}

/**
 * Diagram fields of a persisted section, checked like fresh ones
 * (`mapDiagram`: known format, non-blank, under the size cap): an edited or
 * corrupted `analyses.json` gets no further than the model could. A section
 * whose REQUIRED diagram fails is dropped (`null`); optional ones (cloud,
 * layers) just lose the bad diagram.
 */
function checkDiagrams(section: unknown): unknown {
  if (!isRecord(section)) return section
  if (section.kind === 'architecture' || section.kind === 'schema') {
    const diagram = mapDiagram(section.diagram)
    return diagram ? { ...section, diagram } : null
  }
  if (section.kind === 'cloud') {
    const diagrams = Array.isArray(section.diagrams)
      ? section.diagrams.map(mapDiagram).filter((d): d is DidacticDiagram => d !== null).slice(0, 2)
      : []
    return { ...section, diagrams }
  }
  if (section.kind === 'walkthrough' && Array.isArray(section.cohorts)) {
    return {
      ...section,
      cohorts: section.cohorts.map((cohort) =>
        isRecord(cohort) && Array.isArray(cohort.layers)
          ? {
              ...cohort,
              layers: cohort.layers.map((layer) => {
                if (!isRecord(layer) || !('diagram' in layer)) return layer
                const { diagram: raw, ...rest } = layer
                const diagram = mapDiagram(raw)
                return diagram ? { ...rest, diagram } : rest
              }),
            }
          : cohort,
      ),
    }
  }
  return section
}

/** A persisted section upgraded from the Mermaid era and with its diagrams re-checked; `null` = drop it. */
export function normalizeStoredSection(section: unknown): unknown {
  return checkDiagrams(upgradeLegacySection(section))
}
