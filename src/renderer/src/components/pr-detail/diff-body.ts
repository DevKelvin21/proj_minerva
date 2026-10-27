/**
 * Pieces shared by `SplitDiff` and `InlineDiff` (kept out of the component
 * files so Fast Refresh keeps working).
 */
import type { DiffHunk, DiffLine, DiffLineKind } from '../../lib/diff-parser'
import type { DiffSection, HiddenGap } from '../../lib/expand-context'
import type { DiffThreadsModel } from '../../lib/diff-threads'
import type { HighlightToken } from '../../lib/highlighter'
import type { LineSide } from '../../lib/line-threads'
import type { CommentThread } from '../../../../shared/types'
import type { AskRunner, AskSubject } from '../../stores/ask-ai-store'

/** "Ask AI" from a comment thread of this file (`DiffView`). */
export interface ThreadAskBinding {
  subject: (thread: CommentThread) => AskSubject
  /** Asks with the thread (and the earlier exchanges) as context. */
  run: (thread: CommentThread) => AskRunner
}

/** "Ask AI" in this file's diff (`DiffView`). */
export interface AskAiBinding {
  lineSubject: (line: number, side: LineSide) => AskSubject
  runLine: (line: number, side: LineSide) => AskRunner
  /** `lineThreadKey`s of the lines with a conversation: their button stays lit. */
  askedLines: ReadonlySet<string>
  thread: ThreadAskBinding
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
  /** "Ask AI" on lines and threads (`ai:askAboutLines`); absent = no "Ask AI" buttons. */
  askAi?: AskAiBinding
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

export interface OpenComposer {
  key: string
  side: LineSide
  line: number
  content: string
  /** A new comment (optionally prefilled with `draft`) or a question to the AI. */
  kind: 'comment' | 'ask'
  draft?: string
}

/** A section's lines as a pseudo-hunk, for the row builders. */
export function asHunk(lines: DiffLine[]): DiffHunk {
  return { header: '', oldStart: 0, oldLines: 0, newStart: 0, newLines: 0, lines }
}
