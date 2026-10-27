/**
 * What the diff body needs to draw threads on rows: threads per position,
 * which positions the user hid, and which rows a thread range covers (thin
 * marker) or the focused thread covers (highlight). Pure builders here; the
 * state lives in `DiffView`.
 */
import type { CommentThread } from '../../../shared/types'
import type { DiffLine } from './diff-parser'
import { lineThreadKey, threadLineRange, threadSide } from './line-threads'

export interface DiffThreadsModel {
  byPosition: ReadonlyMap<string, CommentThread[]>
  hiddenKeys: ReadonlySet<string>
  toggleHidden: (key: string) => void
  focusedThreadId: string | null
  /** Positions inside some thread's `line..lineEnd`. */
  rangeKeys: ReadonlySet<string>
  /** Positions inside the focused thread's range. */
  focusedKeys: ReadonlySet<string>
}

/** Longest range marked per thread: a bogus anchor must not mark a whole file. */
const MAX_RANGE_LINES = 500

export function threadRangeKeys(threads: readonly CommentThread[]): Set<string> {
  const keys = new Set<string>()
  for (const thread of threads) {
    const range = threadLineRange(thread)
    if (!range) continue
    const side = threadSide(thread)
    const end = Math.min(range.end, range.start + MAX_RANGE_LINES)
    for (let n = range.start; n <= end; n++) keys.add(lineThreadKey(n, side))
  }
  return keys
}

/** Positions a diff line occupies: deletions on LEFT, additions on RIGHT, context on both. */
export function linePositions(line: Pick<DiffLine, 'kind' | 'oldNumber' | 'newNumber'>): string[] {
  const keys: string[] = []
  if (line.kind !== 'add' && line.oldNumber !== undefined) {
    keys.push(lineThreadKey(line.oldNumber, 'LEFT'))
  }
  if (line.kind !== 'del' && line.newNumber !== undefined) {
    keys.push(lineThreadKey(line.newNumber, 'RIGHT'))
  }
  return keys
}

/** Threads of the file that no visible row can host (they render above the diff instead). */
export function unplacedThreads(
  threads: readonly CommentThread[],
  visibleKeys: ReadonlySet<string>,
): CommentThread[] {
  return threads.filter((thread) => {
    if (thread.line === undefined) return true
    return !visibleKeys.has(lineThreadKey(thread.line, threadSide(thread)))
  })
}
