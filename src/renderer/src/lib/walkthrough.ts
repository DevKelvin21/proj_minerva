/**
 * Pure helpers for the guided walkthrough ("Layers" view of the Files tab):
 * finding the `walkthrough` section of an analysis, flattening cohorts into a
 * navigable list, resolving a layer's files against the PR's real file list
 * and turning its line ranges into the diff position keys the diff bodies
 * highlight (`lineThreadKey`, side + line). No React, no I/O.
 */
import type { DraftDidacticSection } from '../../../shared/events'
import type {
  CommentThread,
  DidacticSection,
  DiffFile,
  WalkthroughCohort,
  WalkthroughFileRef,
  WalkthroughLayer,
  WalkthroughLineRange,
} from '../../../shared/types'
import { lineThreadKey, type LineSide } from './line-threads'

/** Position of a layer inside the walkthrough (both 0-based). */
export interface LayerRef {
  cohort: number
  layer: number
}

export interface FlatLayer {
  ref: LayerRef
  /** 0-based position in reading order across every cohort. */
  index: number
  cohortTitle: string
  layer: WalkthroughLayer
}

/** The walkthrough section of a final or streaming analysis, if any. */
export function findWalkthrough(
  sections: readonly (DidacticSection | DraftDidacticSection)[],
): { markdown: string; cohorts: WalkthroughCohort[]; streaming?: boolean } | null {
  for (const section of sections) {
    if (section.kind === 'walkthrough') return section
  }
  return null
}

export function flattenLayers(cohorts: readonly WalkthroughCohort[]): FlatLayer[] {
  const flat: FlatLayer[] = []
  cohorts.forEach((cohort, c) => {
    cohort.layers.forEach((layer, l) => {
      flat.push({ ref: { cohort: c, layer: l }, index: flat.length, cohortTitle: cohort.title, layer })
    })
  })
  return flat
}

export function sameLayerRef(a: LayerRef | null, b: LayerRef | null): boolean {
  if (a === null || b === null) return a === b
  return a.cohort === b.cohort && a.layer === b.layer
}

/** The flat entry of `ref`, or `null` when it no longer exists (e.g. a re-analysis shrank the list). */
export function findFlatLayer(flat: readonly FlatLayer[], ref: LayerRef | null): FlatLayer | null {
  if (!ref) return null
  return flat.find((entry) => sameLayerRef(entry.ref, ref)) ?? null
}

/** Layer `delta` steps away in reading order, clamped to the ends (`null` when there is nowhere to go). */
export function stepLayer(flat: readonly FlatLayer[], ref: LayerRef | null, delta: number): LayerRef | null {
  if (flat.length === 0) return null
  const current = findFlatLayer(flat, ref)
  if (!current) return delta >= 0 ? flat[0].ref : flat[flat.length - 1].ref
  const next = current.index + delta
  if (next < 0 || next >= flat.length) return null
  return flat[next].ref
}

/**
 * The layer's files that exist in the PR (in the layer's order) and the paths
 * the model referenced that are not in the diff (shown as a warning, never as
 * a selectable file).
 */
export function resolveLayerFiles(
  layer: WalkthroughLayer,
  files: readonly DiffFile[],
): { known: WalkthroughFileRef[]; unknownPaths: string[] } {
  const byPath = new Map(files.map((file) => [file.path, file] as const))
  const known: WalkthroughFileRef[] = []
  const unknownPaths: string[] = []
  for (const ref of layer.files) {
    if (byPath.has(ref.path)) known.push(ref)
    else unknownPaths.push(ref.path)
  }
  return { known, unknownPaths }
}

/** Files of the PR no layer mentions (listed apart so nothing is lost). */
export function unassignedFiles(
  cohorts: readonly WalkthroughCohort[],
  files: readonly DiffFile[],
): DiffFile[] {
  const covered = new Set<string>()
  for (const cohort of cohorts) {
    for (const layer of cohort.layers) {
      for (const ref of layer.files) covered.add(ref.path)
    }
  }
  return files.filter((file) => !covered.has(file.path))
}

/** Side of the diff a layer's line numbers refer to for `file` (see `WalkthroughFileRef`). */
export function layerSide(file: Pick<DiffFile, 'status'>): LineSide {
  return file.status === 'removed' ? 'LEFT' : 'RIGHT'
}

export interface LayerFocus {
  /** Diff position keys (`lineThreadKey`) inside the layer's ranges for this file. */
  keys: ReadonlySet<string>
  /** First line of the first range, to scroll to; `null` for a whole-file reference. */
  first: { side: LineSide; line: number } | null
}

/** Cap on highlighted lines per file so a bogus `1-999999` range can't build a huge set. */
const MAX_HIGHLIGHT_LINES = 5_000

export function layerFocus(ref: WalkthroughFileRef, file: Pick<DiffFile, 'status'>): LayerFocus {
  const side = layerSide(file)
  const keys = new Set<string>()
  let first: LayerFocus['first'] = null
  for (const range of ref.ranges) {
    if (first === null) first = { side, line: range.start }
    for (let line = range.start; line <= range.end; line++) {
      if (keys.size >= MAX_HIGHLIGHT_LINES) break
      keys.add(lineThreadKey(line, side))
    }
  }
  return { keys, first }
}

/** `12-40, 55` style label of a file's ranges (empty for a whole-file reference). */
export function rangeLabel(ranges: readonly WalkthroughLineRange[]): string {
  return ranges.map((r) => (r.start === r.end ? String(r.start) : `${r.start}-${r.end}`)).join(', ')
}

export function rangeLineCount(ranges: readonly WalkthroughLineRange[]): number {
  return ranges.reduce((sum, r) => sum + (r.end - r.start + 1), 0)
}

/** Open comment threads that sit on any file of the layer (file-level or line-level). */
export function layerThreadCount(layer: WalkthroughLayer, threads: readonly CommentThread[]): number {
  const paths = new Set(layer.files.map((f) => f.path))
  return threads.filter((thread) => thread.path !== undefined && paths.has(thread.path)).length
}
