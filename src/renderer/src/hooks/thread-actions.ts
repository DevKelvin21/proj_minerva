import { createContext, useContext } from 'react'
import type { RepoRef, ThreadStatus } from '../../../shared/scm'
import type { CommentThread } from '../../../shared/types'
import { loadFileContent, type FileContentKey } from '../lib/file-content-cache'
import { splitFileLines } from '../lib/expand-context'
import { threadLineRange, threadSide } from '../lib/line-threads'
import type { SuggestionSource } from '../components/pr-detail/CommentComposer'
import { useFileLines, type FileLinesState } from './use-file-content'

/**
 * What every thread card needs from the PR it belongs to, wherever it renders
 * (Conversation, Files, Comments): who to ask for code and how to write. Set
 * once per PR in `CenterPane`, so the diff components don't have to thread
 * these through every row.
 */
export interface ThreadActions {
  repo: RepoRef
  number: number
  /** PR head SHA ('' when unknown), for the file-content cache key. */
  headSha: string
  /** Base-side path of a renamed file (base reads need the OLD path). */
  previousPathOf: (path: string) => string | undefined
  reply: (threadId: string, bodyMarkdown: string) => Promise<void>
  /** Answers the updated thread (already merged into the PR's thread list). */
  setStatus: (threadId: string, status: ThreadStatus) => Promise<CommentThread>
}

export const ThreadActionsContext = createContext<ThreadActions | null>(null)

export function useThreadActions(): ThreadActions {
  const actions = useContext(ThreadActionsContext)
  if (!actions) throw new Error('useThreadActions outside ThreadActionsContext')
  return actions
}

/** Cache key of the file a line thread points at, on the side its line numbers refer to. */
export function threadFileKey(
  actions: ThreadActions,
  thread: Pick<CommentThread, 'path' | 'side'>,
): FileContentKey | null {
  if (!thread.path) return null
  const side = threadSide(thread) === 'LEFT' ? 'base' : 'head'
  return {
    repo: actions.repo,
    number: actions.number,
    headSha: actions.headSha,
    path: side === 'base' ? (actions.previousPathOf(thread.path) ?? thread.path) : thread.path,
    side,
  }
}

/** Lines of the file a thread is anchored to (`enabled = false` fetches nothing). */
export function useThreadFileLines(
  thread: Pick<CommentThread, 'path' | 'side'>,
  enabled: boolean,
): FileLinesState {
  const actions = useThreadActions()
  return useFileLines(enabled ? threadFileKey(actions, thread) : null)
}

/**
 * Where "Insert suggestion" gets its lines for a thread (or a new comment) at
 * `anchor`: the anchored line(s) of the HEAD file. Suggestions replace code in
 * the new version, so LEFT-side and PR-level comments can't carry one.
 */
export function suggestionSourceFor(
  actions: ThreadActions,
  anchor: Pick<CommentThread, 'path' | 'line' | 'lineEnd' | 'side'>,
): SuggestionSource {
  const range = threadLineRange(anchor)
  if (!anchor.path || !range) {
    return {
      kind: 'disabled',
      reason: 'Suggestions need a line of code: comment on a line in the Files tab.',
    }
  }
  if (threadSide(anchor) === 'LEFT') {
    return {
      kind: 'disabled',
      reason: 'Suggestions change the new version of the file; this comment is on the old one.',
    }
  }
  const key = threadFileKey(actions, anchor)
  return {
    kind: 'lines',
    load: async () => {
      if (!key) return []
      const content = await loadFileContent(key)
      if (content.content === null || content.isBinary)
        throw new Error('The file has no text to suggest on.')
      const lines = splitFileLines(content.content)
      if (range.start > lines.length)
        throw new Error('Line ' + range.start + ' is past the end of the file.')
      return lines.slice(range.start - 1, range.end)
    },
  }
}
