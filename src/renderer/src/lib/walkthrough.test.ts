import { describe, expect, it } from 'vitest'
import type { CommentThread, DiffFile, WalkthroughCohort } from '../../../shared/types'
import {
  findWalkthrough,
  flattenLayers,
  layerFocus,
  layerThreadCount,
  rangeLabel,
  rangeLineCount,
  resolveLayerFiles,
  stepLayer,
  unassignedFiles,
} from './walkthrough'

const cohorts: WalkthroughCohort[] = [
  {
    title: 'A',
    layers: [
      { title: 'a1', markdown: '', files: [{ path: 'x.ts', ranges: [{ start: 3, end: 5 }] }] },
      { title: 'a2', markdown: '', files: [{ path: 'y.ts', ranges: [] }, { path: 'ghost.ts', ranges: [] }] },
    ],
  },
  { title: 'B', layers: [{ title: 'b1', markdown: '', files: [{ path: 'z.ts', ranges: [{ start: 9, end: 9 }] }] }] },
]

const file = (path: string, status: DiffFile['status'] = 'modified'): DiffFile => ({
  path,
  status,
  additions: 0,
  deletions: 0,
  isBinary: false,
})

describe('walkthrough helpers', () => {
  it('finds the walkthrough section among final or draft sections', () => {
    expect(findWalkthrough([{ kind: 'summary', markdown: 'x' }])).toBeNull()
    expect(findWalkthrough([{ kind: 'walkthrough', markdown: '', cohorts, streaming: true }])?.cohorts).toBe(cohorts)
  })

  it('flattens cohorts in reading order and steps through them with clamping', () => {
    const flat = flattenLayers(cohorts)
    expect(flat.map((f) => f.layer.title)).toEqual(['a1', 'a2', 'b1'])
    expect(flat[2]).toMatchObject({ ref: { cohort: 1, layer: 0 }, index: 2, cohortTitle: 'B' })

    expect(stepLayer(flat, null, 1)).toEqual({ cohort: 0, layer: 0 })
    expect(stepLayer(flat, null, -1)).toEqual({ cohort: 1, layer: 0 })
    expect(stepLayer(flat, { cohort: 0, layer: 1 }, 1)).toEqual({ cohort: 1, layer: 0 })
    expect(stepLayer(flat, { cohort: 1, layer: 0 }, 1)).toBeNull()
    expect(stepLayer(flat, { cohort: 0, layer: 0 }, -1)).toBeNull()
    expect(stepLayer([], null, 1)).toBeNull()
  })

  it('separates known files from paths the PR does not have', () => {
    const files = [file('x.ts'), file('y.ts'), file('z.ts'), file('w.ts')]
    expect(resolveLayerFiles(cohorts[0].layers[1], files)).toEqual({
      known: [{ path: 'y.ts', ranges: [] }],
      unknownPaths: ['ghost.ts'],
    })
    expect(unassignedFiles(cohorts, files).map((f) => f.path)).toEqual(['w.ts'])
  })

  it('builds highlight keys on the right side, old side for removed files', () => {
    const focus = layerFocus({ path: 'x.ts', ranges: [{ start: 3, end: 5 }, { start: 9, end: 9 }] }, file('x.ts'))
    expect([...focus.keys]).toEqual(['RIGHT:3', 'RIGHT:4', 'RIGHT:5', 'RIGHT:9'])
    expect(focus.first).toEqual({ side: 'RIGHT', line: 3 })

    const removed = layerFocus({ path: 'x.ts', ranges: [{ start: 1, end: 2 }] }, file('x.ts', 'removed'))
    expect([...removed.keys]).toEqual(['LEFT:1', 'LEFT:2'])
    expect(removed.first).toEqual({ side: 'LEFT', line: 1 })

    const whole = layerFocus({ path: 'x.ts', ranges: [] }, file('x.ts'))
    expect(whole.keys.size).toBe(0)
    expect(whole.first).toBeNull()
  })

  it('caps a runaway range instead of building a huge set', () => {
    const focus = layerFocus({ path: 'x.ts', ranges: [{ start: 1, end: 1_000_000 }] }, file('x.ts'))
    expect(focus.keys.size).toBe(5_000)
  })

  it('labels and counts ranges', () => {
    expect(rangeLabel([{ start: 3, end: 5 }, { start: 9, end: 9 }])).toBe('3-5, 9')
    expect(rangeLabel([])).toBe('')
    expect(rangeLineCount([{ start: 3, end: 5 }, { start: 9, end: 9 }])).toBe(4)
  })

  it('counts threads on the layer files', () => {
    const thread = (path?: string): CommentThread => ({
      id: path ?? 'pr',
      status: 'active',
      isResolved: false,
      isLineThread: path !== undefined,
      path,
      comments: [],
    })
    expect(layerThreadCount(cohorts[0].layers[1], [thread('y.ts'), thread('x.ts'), thread()])).toBe(1)
  })
})
