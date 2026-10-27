/**
 * "Expand context" line math for the diff: which lines of the file the patch
 * hides (before, between and after its hunks), which of them the reviewer
 * revealed, and where a comment anchored outside every hunk lands. Pure, so
 * `SplitDiff`/`InlineDiff` only render what this computes.
 *
 * Hidden lines are unchanged lines, identical on both sides, so they are read
 * from the HEAD file and numbered on both sides with a constant offset per gap
 * (`old = new - offset`). All ranges here are NEW-side line numbers, inclusive.
 */
import type { DiffHunk, DiffLine } from './diff-parser'

export interface LineRange {
  start: number
  end: number
}

/** A run of hidden lines between two visible blocks (or a file edge). */
export interface HiddenGap {
  /** First hidden new-side line. */
  newStart: number
  /** Last hidden new-side line; `null` = runs to the end of a file whose length is unknown yet. */
  newEnd: number | null
  /** `oldNumber = newNumber - offset` inside this gap. */
  offset: number
  /** Index of the hunk right after this gap (`hunks.length` = after the last hunk). */
  beforeHunk: number
}

export type DiffSection =
  | { type: 'hunk'; key: string; hunkIndex: number; hunk: DiffHunk }
  | { type: 'context'; key: string; lines: DiffLine[] }
  | { type: 'gap'; key: string; gap: HiddenGap }

export type AnchorPlacement =
  | { placement: 'hunk'; hunkIndex: number }
  | { placement: 'gap'; gapIndex: number; newLine: number }
  | { placement: 'beyond' }

/** Lines revealed per click on "expand up/down". */
export const EXPAND_STEP = 20

/** Lines shown above and below a comment anchored outside every hunk. */
export const AUTO_EXPAND_RADIUS = 3

/** Lines of a file as the diff numbers them (a trailing newline does not add a line). */
export function splitFileLines(content: string): string[] {
  if (content === '') return []
  const text = content.endsWith('\n') ? content.slice(0, -1) : content
  return text.split(/\r?\n/)
}

/**
 * First new/old line a hunk covers. A side with 0 lines (pure addition or
 * deletion) reports the line BEFORE the change as its start, per the unified
 * diff format, so the next line is the first one "after" it.
 */
function hunkSpan(hunk: DiffHunk): { firstNew: number; firstOld: number } {
  return {
    firstNew: hunk.newLines === 0 ? hunk.newStart + 1 : hunk.newStart,
    firstOld: hunk.oldLines === 0 ? hunk.oldStart + 1 : hunk.oldStart,
  }
}

/**
 * The `hunks.length + 1` gaps of a file: gap `i` sits before hunk `i`, the
 * last one after the last hunk. A gap can be empty (`newEnd < newStart`).
 * Without hunks there is nothing to anchor the math to, so no gaps.
 */
export function computeGaps(hunks: readonly DiffHunk[], totalNewLines: number | null): HiddenGap[] {
  if (hunks.length === 0) return []
  const gaps: HiddenGap[] = []
  let nextNew = 1
  let nextOld = 1
  hunks.forEach((hunk, index) => {
    const { firstNew, firstOld } = hunkSpan(hunk)
    gaps.push({
      newStart: nextNew,
      newEnd: firstNew - 1,
      offset: firstNew - firstOld,
      beforeHunk: index,
    })
    nextNew = firstNew + hunk.newLines
    nextOld = firstOld + hunk.oldLines
  })
  gaps.push({
    newStart: nextNew,
    newEnd: totalNewLines,
    offset: nextNew - nextOld,
    beforeHunk: hunks.length,
  })
  return gaps
}

export function gapLength(gap: HiddenGap): number | null {
  return gap.newEnd === null ? null : Math.max(0, gap.newEnd - gap.newStart + 1)
}

/** Sorts and merges overlapping or touching ranges. */
export function mergeRanges(ranges: readonly LineRange[]): LineRange[] {
  const sorted = ranges
    .filter((r) => r.end >= r.start)
    .map((r) => ({ ...r }))
    .sort((a, b) => a.start - b.start)
  const merged: LineRange[] = []
  for (const range of sorted) {
    const last = merged[merged.length - 1]
    if (last && range.start <= last.end + 1) last.end = Math.max(last.end, range.end)
    else merged.push(range)
  }
  return merged
}

/**
 * Where an anchor (a comment's line on one side) falls: inside a hunk (always
 * visible), inside a gap (with its NEW-side line, so LEFT anchors in hidden
 * code map onto the head file), or past the end of the file.
 */
export function classifyAnchor(
  hunks: readonly DiffHunk[],
  line: number,
  side: 'LEFT' | 'RIGHT',
  totalNewLines: number | null,
): AnchorPlacement {
  if (hunks.length === 0) return { placement: 'beyond' }
  for (let i = 0; i < hunks.length; i++) {
    const { firstNew, firstOld } = hunkSpan(hunks[i])
    const first = side === 'RIGHT' ? firstNew : firstOld
    const count = side === 'RIGHT' ? hunks[i].newLines : hunks[i].oldLines
    if (line >= first && line < first + count) return { placement: 'hunk', hunkIndex: i }
  }
  const gaps = computeGaps(hunks, totalNewLines)
  for (let g = 0; g < gaps.length; g++) {
    const gap = gaps[g]
    const newLine = side === 'RIGHT' ? line : line + gap.offset
    if (newLine < gap.newStart) continue
    if (gap.newEnd !== null && newLine > gap.newEnd) continue
    if (newLine < 1) return { placement: 'beyond' }
    return { placement: 'gap', gapIndex: g, newLine }
  }
  return { placement: 'beyond' }
}

/**
 * Ranges to reveal so every anchor in hidden code shows up in place, with
 * `radius` lines of context around it. Anchors inside hunks need nothing.
 */
export function autoRevealRanges(
  hunks: readonly DiffHunk[],
  anchors: ReadonlyArray<{ line: number; lineEnd?: number; side: 'LEFT' | 'RIGHT' }>,
  totalNewLines: number | null,
  radius = AUTO_EXPAND_RADIUS,
): LineRange[] {
  const ranges: LineRange[] = []
  for (const anchor of anchors) {
    const placed = classifyAnchor(hunks, anchor.line, anchor.side, totalNewLines)
    if (placed.placement !== 'gap') continue
    const span = Math.max(0, (anchor.lineEnd ?? anchor.line) - anchor.line)
    ranges.push({
      start: Math.max(1, placed.newLine - radius),
      end: placed.newLine + span + radius,
    })
  }
  return mergeRanges(ranges)
}

/** The range one expander click reveals. */
export function expandRange(
  gap: Pick<HiddenGap, 'newStart' | 'newEnd'>,
  direction: 'up' | 'down' | 'all',
  step = EXPAND_STEP,
): LineRange {
  if (direction === 'down' || gap.newEnd === null) {
    return { start: gap.newStart, end: gap.newStart + step - 1 }
  }
  if (direction === 'up')
    return { start: Math.max(gap.newStart, gap.newEnd - step + 1), end: gap.newEnd }
  return { start: gap.newStart, end: gap.newEnd }
}

/**
 * The diff as an ordered list of sections: hunks, revealed context lines and
 * hidden gaps (each with what an expander needs). Without `headLines` nothing
 * can be revealed, so every non-empty gap stays hidden; the trailing gap's
 * size is unknown until then.
 */
export function buildDiffSections(
  hunks: readonly DiffHunk[],
  headLines: readonly string[] | null,
  revealed: readonly LineRange[],
): DiffSection[] {
  const total = headLines ? headLines.length : null
  const gaps = computeGaps(hunks, total)
  const ranges = headLines ? mergeRanges(revealed) : []
  const sections: DiffSection[] = []

  gaps.forEach((gap, g) => {
    const length = gapLength(gap)
    if (length !== 0) {
      let cursor = gap.newStart
      const end = gap.newEnd
      if (headLines && end !== null) {
        for (const range of ranges) {
          if (range.end < cursor || range.start > end) continue
          const from = Math.max(range.start, cursor)
          const to = Math.min(range.end, end)
          if (from > cursor) {
            sections.push({
              type: 'gap',
              key: `gap-${g}-${cursor}`,
              gap: { ...gap, newStart: cursor, newEnd: from - 1 },
            })
          }
          const lines: DiffLine[] = []
          for (let n = from; n <= to; n++) {
            lines.push({
              kind: 'context',
              oldNumber: n - gap.offset,
              newNumber: n,
              content: headLines[n - 1] ?? '',
            })
          }
          sections.push({ type: 'context', key: `ctx-${g}-${from}`, lines })
          cursor = to + 1
        }
      }
      if (end === null || cursor <= end) {
        sections.push({
          type: 'gap',
          key: `gap-${g}-${cursor}`,
          gap: { ...gap, newStart: cursor, newEnd: end },
        })
      }
    }
    if (g < hunks.length) {
      sections.push({ type: 'hunk', key: `hunk-${g}`, hunkIndex: g, hunk: hunks[g] })
    }
  })
  return sections
}
