/**
 * Pieces shared by `SplitDiff` and `InlineDiff` (kept out of the component
 * files so Fast Refresh keeps working).
 */
import type { DiffHunk, DiffLine, DiffLineKind } from '../../lib/diff-parser'
import type { DiffSection, HiddenGap } from '../../lib/expand-context'
import type { DiffThreadsModel } from '../../lib/diff-threads'
import type { HighlightToken } from '../../lib/highlighter'
import type { LineSide } from '../../lib/line-threads'

export interface DiffBodyProps {
  sections: DiffSection[]
  hunkCount: number
  wordWrap: boolean
  getTokens: (content: string) => HighlightToken[] | undefined
  threads: DiffThreadsModel
  expander: {
    loading: boolean
    error: string | null
    onExpand: (gap: HiddenGap, direction: 'up' | 'down' | 'all') => void
  }
  onCreateThread: (line: number, side: LineSide, bodyMarkdown: string) => Promise<void>
}

export const KIND_BG: Partial<Record<DiffLineKind, string>> = {
  add: 'bg-[#1d3a28]',
  del: 'bg-[#3f1d24]',
}

/** Gutter marker for rows inside a thread's range, and the focused thread's highlight. */
export function rangeClasses(inRange: boolean, focused: boolean): string {
  if (focused) return 'bg-accent/20 shadow-[inset_3px_0_0_var(--color-accent)]'
  if (inRange) return 'shadow-[inset_2px_0_0_var(--color-accent)]'
  return ''
}

export interface OpenComposer {
  key: string
  side: LineSide
  line: number
  content: string
}

/** A section's lines as a pseudo-hunk, for the row builders. */
export function asHunk(lines: DiffLine[]): DiffHunk {
  return { header: '', oldStart: 0, oldLines: 0, newStart: 0, newLines: 0, lines }
}
