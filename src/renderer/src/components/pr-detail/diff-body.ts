/**
 * Pieces shared by `SplitDiff` and `InlineDiff` (kept out of the component
 * files so Fast Refresh keeps working).
 */
import type { DiffHunk, DiffLine, DiffLineKind } from '../../lib/diff-parser'
import type { DiffSection, HiddenGap } from '../../lib/expand-context'
import type { DiffThreadsModel } from '../../lib/diff-threads'
import type { HighlightToken } from '../../lib/highlighter'
import type { LineSide } from '../../lib/line-threads'

/** A diff line: its side and its number on that side. */
export interface LinePosition {
  side: LineSide
  line: number
}

/**
 * The new-comment composer of this file (`DiffView`, state in `app-store`
 * so the chat's "Use as comment" can open it with a draft).
 */
export interface LineComposerBinding {
  /** Where it is open in this file (`null` = closed, or open in another file). */
  target: (LinePosition & { draft?: string; token: number }) | null
  open: (side: LineSide, line: number) => void
  close: () => void
}

/**
 * "Add to chat" on this file's lines (`DiffView`): the sparkle and its
 * one-line note input. A row never shows the note input and the comment
 * composer at once: opening one closes the other on that row, and while
 * the composer is on a row (e.g. "Use as comment" from the chat) a note
 * input there is not drawn.
 */
export interface ChatLineBinding {
  /** `lineThreadKey`s of the lines with a chip in the chat draft: their sparkle stays lit. */
  pendingLines: ReadonlySet<string>
  /** The line whose note input is open. */
  noteTarget: LinePosition | null
  openNote: (side: LineSide, line: number) => void
  /** Closes the note input and gives focus back to its line's gutter sparkle. */
  closeNote: () => void
  /** The note of the line's chip, to edit it. */
  noteFor: (side: LineSide, line: number) => string | undefined
  /** Adds the line (content + note) to the chat draft; `false` when the draft is full. */
  addLine: (side: LineSide, line: number, code: string, note: string) => boolean
}

export interface DiffBodyProps {
  sections: DiffSection[]
  hunkCount: number
  wordWrap: boolean
  getTokens: (content: string) => HighlightToken[] | undefined
  threads: DiffThreadsModel
  /**
   * Position keys (`lineThreadKey`) of the lines the active walkthrough layer
   * covers in this file: those rows get a marker so the reviewer sees where
   * the layer lands. Empty when no layer is active.
   */
  layerKeys: ReadonlySet<string>
  expander: {
    loading: boolean
    error: string | null
    onExpand: (gap: HiddenGap, direction: 'up' | 'down' | 'all') => void
  }
  onCreateThread: (line: number, side: LineSide, bodyMarkdown: string) => Promise<void>
  composer: LineComposerBinding
  /** "Add to chat" on lines; absent = no sparkle. */
  chat?: ChatLineBinding
}

export const KIND_BG: Partial<Record<DiffLineKind, string>> = {
  add: 'bg-diff-add',
  del: 'bg-diff-del',
}

/** Gutter marker for rows inside a thread's range, and the focused thread's highlight. */
export function rangeClasses(inRange: boolean, focused: boolean): string {
  if (focused) return 'bg-accent/20 shadow-[inset_3px_0_0_var(--color-accent)]'
  if (inRange) return 'shadow-[inset_2px_0_0_var(--color-accent)]'
  return ''
}

/** Marker of a row inside the active walkthrough layer (distinct from the thread marks: `info`, not accent). */
export const LAYER_ROW_CLASS = 'shadow-[inset_3px_0_0_var(--color-info)]'

/** `position` is where `target` points. */
export function samePosition(
  target: LinePosition | null | undefined,
  position: LinePosition | undefined,
): boolean {
  return Boolean(target && position && target.side === position.side && target.line === position.line)
}

/** `target` points at one of a row's positions (inline: one; split: its two sides). */
export function onRow(
  target: LinePosition | null | undefined,
  positions: ReadonlyArray<LinePosition | undefined>,
): boolean {
  return positions.some((position) => samePosition(target, position))
}

/** A section's lines as a pseudo-hunk, for the row builders. */
export function asHunk(lines: DiffLine[]): DiffHunk {
  return { header: '', oldStart: 0, oldLines: 0, newStart: 0, newLines: 0, lines }
}
