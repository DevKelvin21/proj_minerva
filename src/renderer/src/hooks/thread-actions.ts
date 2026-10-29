import { createContext, useContext } from 'react'
import type { TFunction } from 'i18next'
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

/** Cache key of the file as it was when the thread was written (its `origin` commit). */
export function threadOriginKey(
  actions: ThreadActions,
  thread: Pick<CommentThread, 'path' | 'origin'>,
): FileContentKey | null {
  if (!thread.path || !thread.origin) return null
  return {
    repo: actions.repo,
    number: actions.number,
    headSha: actions.headSha,
    path: thread.origin.path ?? thread.path,
    side: 'head',
    commit: thread.origin.commit,
  }
}

/**
 * Lines of the file a thread is anchored to (`enabled = false` fetches
 * nothing): where it sits now, or as it was written (`at = 'origin'`).
 */
export function useThreadFileLines(
  thread: Pick<CommentThread, 'path' | 'side' | 'origin'>,
  enabled: boolean,
  at: 'current' | 'origin' = 'current',
): FileLinesState {
  const actions = useThreadActions()
  const key = at === 'origin' ? threadOriginKey(actions, thread) : threadFileKey(actions, thread)
  return useFileLines(enabled ? key : null)
}

/**
 * Where "Insert suggestion" gets its lines for a thread (or a new comment) at
 * `anchor`: the anchored line(s) of the HEAD file. Suggestions replace code in
 * the new version, so LEFT-side and PR-level comments can't carry one.
 */
export function suggestionSourceFor(
  actions: ThreadActions,
  anchor: Pick<CommentThread, 'path' | 'line' | 'lineEnd' | 'side'>,
  t: TFunction,
): SuggestionSource {
  const range = threadLineRange(anchor)
  if (!anchor.path || !range) {
    return { kind: 'disabled', reason: t('comments.suggestion.needsLine') }
  }
  if (threadSide(anchor) === 'LEFT') {
    return { kind: 'disabled', reason: t('comments.suggestion.oldSideComment') }
  }
  const key = threadFileKey(actions, anchor)
  return {
    kind: 'lines',
    load: async () => {
      if (!key) return []
      const content = await loadFileContent(key)
      if (content.content === null || content.isBinary)
        throw new Error(t('comments.suggestion.noText'))
      const lines = splitFileLines(content.content)
      if (range.start > lines.length)
        throw new Error(t('comments.suggestion.pastEnd', { line: range.start }))
      return lines.slice(range.start - 1, range.end)
    },
  }
}
