import { describe, expect, it } from 'vitest'
import { parsePatch } from './diff-parser'
import {
  autoRevealRanges,
  buildDiffSections,
  classifyAnchor,
  computeGaps,
  expandRange,
  mergeRanges,
  splitFileLines,
} from './expand-context'

// Same shape as the #102 mock: a 22-line head file whose only hunk is new lines 14-22.
const HEAD_LINES = Array.from({ length: 22 }, (_, i) => `line ${i + 1}`)
const PATCH_102 = [
  '@@ -14,7 +14,10 @@',
  ' line 14',
  ' line 15',
  ' line 16',
  '-old 17',
  '+line 17',
  '+line 18',
  '+line 19',
  '+line 20',
  ' line 21',
  ' line 22',
  ' line 23',
].join('\n')

// Two hunks: lines 3-4 changed, then lines 12-13; old file had one extra line at the top.
const TWO_HUNKS = ['@@ -3,3 +2,2 @@', ' a', '-b', ' c', '@@ -13,2 +12,3 @@', ' x', '+y', ' z'].join(
  '\n',
)

describe('splitFileLines', () => {
  it('does not count a trailing newline as a line', () => {
    expect(splitFileLines('a\nb\n')).toEqual(['a', 'b'])
    expect(splitFileLines('a\r\nb')).toEqual(['a', 'b'])
    expect(splitFileLines('')).toEqual([])
  })
})

describe('computeGaps', () => {
  it('finds the gaps before, between and after hunks with their old/new offset', () => {
    const gaps = computeGaps(parsePatch(TWO_HUNKS), 20)
    expect(gaps).toEqual([
      { newStart: 1, newEnd: 1, offset: -1, beforeHunk: 0 },
      { newStart: 4, newEnd: 11, offset: -1, beforeHunk: 1 },
      { newStart: 15, newEnd: 20, offset: 0, beforeHunk: 2 },
    ])
  })

  it('leaves the trailing gap open while the file length is unknown', () => {
    const gaps = computeGaps(parsePatch(PATCH_102), null)
    expect(gaps[0]).toMatchObject({ newStart: 1, newEnd: 13 })
    expect(gaps[1]).toMatchObject({ newStart: 24, newEnd: null })
  })

  it('handles hunks that add a whole file (old side has 0 lines)', () => {
    const gaps = computeGaps(parsePatch('@@ -0,0 +1,2 @@\n+a\n+b'), 2)
    expect(gaps[0]).toMatchObject({ newStart: 1, newEnd: 0 })
    expect(gaps[1]).toMatchObject({ newStart: 3, newEnd: 2 })
  })

  it('has no gaps without hunks', () => {
    expect(computeGaps([], 10)).toEqual([])
  })
})

describe('classifyAnchor (out-of-hunk placement)', () => {
  const hunks = parsePatch(TWO_HUNKS)

  it('places anchors inside hunks', () => {
    expect(classifyAnchor(hunks, 3, 'RIGHT', 20)).toEqual({ placement: 'hunk', hunkIndex: 0 })
    expect(classifyAnchor(hunks, 4, 'LEFT', 20)).toEqual({ placement: 'hunk', hunkIndex: 0 })
  })

  it('maps a RIGHT anchor in hidden code to its gap', () => {
    expect(classifyAnchor(hunks, 8, 'RIGHT', 20)).toEqual({
      placement: 'gap',
      gapIndex: 1,
      newLine: 8,
    })
  })

  it('maps a LEFT anchor in hidden code onto the head file', () => {
    // Old line 9 sits between the hunks, where new = old - 1.
    expect(classifyAnchor(hunks, 9, 'LEFT', 20)).toEqual({
      placement: 'gap',
      gapIndex: 1,
      newLine: 8,
    })
  })

  it('reports anchors past the end of the file', () => {
    expect(classifyAnchor(hunks, 25, 'RIGHT', 20)).toEqual({ placement: 'beyond' })
    expect(classifyAnchor([], 1, 'RIGHT', 20)).toEqual({ placement: 'beyond' })
  })

  it('#102: the line-12 comment is outside the only hunk', () => {
    expect(classifyAnchor(parsePatch(PATCH_102), 12, 'RIGHT', 22)).toEqual({
      placement: 'gap',
      gapIndex: 0,
      newLine: 12,
    })
  })
})

describe('mergeRanges / expandRange / autoRevealRanges', () => {
  it('merges overlapping and touching ranges', () => {
    expect(
      mergeRanges([
        { start: 10, end: 12 },
        { start: 1, end: 3 },
        { start: 4, end: 5 },
        { start: 11, end: 15 },
        { start: 9, end: 8 },
      ]),
    ).toEqual([
      { start: 1, end: 5 },
      { start: 10, end: 15 },
    ])
  })

  it('expands down from the top, up from the bottom, or everything', () => {
    const gap = { newStart: 4, newEnd: 60 }
    expect(expandRange(gap, 'down')).toEqual({ start: 4, end: 23 })
    expect(expandRange(gap, 'up')).toEqual({ start: 41, end: 60 })
    expect(expandRange(gap, 'all')).toEqual({ start: 4, end: 60 })
    expect(expandRange({ newStart: 4, newEnd: 10 }, 'up')).toEqual({ start: 4, end: 10 })
    expect(expandRange({ newStart: 24, newEnd: null }, 'all')).toEqual({ start: 24, end: 43 })
  })

  it('reveals a window around anchors in hidden code only', () => {
    const hunks = parsePatch(PATCH_102)
    expect(
      autoRevealRanges(
        hunks,
        [
          { line: 12, side: 'RIGHT' },
          { line: 17, side: 'RIGHT' },
        ],
        22,
      ),
    ).toEqual([{ start: 9, end: 15 }])
    expect(autoRevealRanges(hunks, [{ line: 2, lineEnd: 4, side: 'RIGHT' }], 22)).toEqual([
      { start: 1, end: 7 },
    ])
  })
})

describe('buildDiffSections', () => {
  const hunks = parsePatch(PATCH_102)

  it('without the file, shows hunks and hidden gaps only', () => {
    const sections = buildDiffSections(hunks, null, [{ start: 9, end: 15 }])
    expect(sections.map((s) => s.type)).toEqual(['gap', 'hunk', 'gap'])
    expect(sections[2]).toMatchObject({ gap: { newStart: 24, newEnd: null } })
  })

  it('reveals the requested lines from the head file, numbered on both sides', () => {
    const head = Array.from({ length: 25 }, (_, i) => `line ${i + 1}`)
    const sections = buildDiffSections(hunks, head, [{ start: 9, end: 15 }])
    expect(sections.map((s) => s.type)).toEqual(['gap', 'context', 'hunk', 'gap'])
    expect(sections[0]).toMatchObject({ gap: { newStart: 1, newEnd: 8 } })
    const context = sections[1]
    if (context.type !== 'context') throw new Error('expected context')
    expect(context.lines[0]).toEqual({
      kind: 'context',
      oldNumber: 9,
      newNumber: 9,
      content: 'line 9',
    })
    expect(context.lines.at(-1)?.newNumber).toBe(13)
    expect(sections[3]).toMatchObject({ gap: { newStart: 24, newEnd: 25 } })
  })

  it('drops a gap once it is fully revealed and splits it around a middle window', () => {
    const sections = buildDiffSections(hunks, HEAD_LINES.concat(['line 23']), [
      { start: 1, end: 13 },
    ])
    expect(sections.map((s) => s.type)).toEqual(['context', 'hunk'])

    const middle = buildDiffSections(parsePatch(TWO_HUNKS), HEAD_LINES, [{ start: 7, end: 8 }])
    expect(middle.map((s) => s.type)).toEqual([
      'gap',
      'hunk',
      'gap',
      'context',
      'gap',
      'hunk',
      'gap',
    ])
    expect(middle[2]).toMatchObject({ gap: { newStart: 4, newEnd: 6 } })
    expect(middle[4]).toMatchObject({ gap: { newStart: 9, newEnd: 11 } })
  })
})
