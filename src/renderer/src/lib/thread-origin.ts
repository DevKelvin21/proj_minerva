/**
 * Threads written on an earlier push (`CommentThread.origin`): whether the
 * excerpt offers "As commented / Latest", the lines it highlights in each
 * version, and what a removed file's group says. Pure.
 */
import type { CommentThread, ThreadOrigin } from '../../../shared/types'
import { threadLineRange, threadSide } from './line-threads'

/** Which version of the file an outdated thread's excerpt shows. */
export type ThreadCodeVersion = 'commented' | 'latest'

/** Whether the file exists at the PR head: `unknown` while it is being checked (or can't be). */
export type FileAtHead = 'present' | 'missing' | 'unknown'

/** A commit as people read it (7 hex characters). */
export function shortCommit(sha: string): string {
  return sha.slice(0, 7)
}

/**
 * True when the excerpt can show the code as commented: an outdated RIGHT-side
 * line thread whose provider said where it was written.
 */
export function hasCommentedVersion(
  thread: Pick<CommentThread, 'isOutdated' | 'origin' | 'path' | 'line' | 'side'>,
): thread is typeof thread & { origin: ThreadOrigin; path: string } {
  return Boolean(
    thread.isOutdated && thread.origin && thread.path && threadSide(thread) === 'RIGHT',
  )
}

/** Lines to highlight in `version`: the origin's lines as commented, the current ones on Latest. */
export function versionLineRange(
  thread: Pick<CommentThread, 'line' | 'lineEnd' | 'origin'>,
  version: ThreadCodeVersion,
): { start: number; end: number } | null {
  if (version === 'commented' && thread.origin) {
    return threadLineRange({ line: thread.origin.line, lineEnd: thread.origin.lineEnd })
  }
  return threadLineRange(thread)
}

/**
 * The push that removed the file, when only one can have: the one right after
 * the thread's push. `null` = some later push (or the provider has no pushes).
 */
export function removedInPush(origin: ThreadOrigin | undefined): number | null {
  const push = origin?.push
  return push && push.total === push.index + 1 ? push.total : null
}

/** How a file group of the thread lists is tagged. */
export type FileGroupTag = { kind: 'removed'; push: number | null } | { kind: 'notInDiff' } | null

/**
 * The tag of a file group: "removed" when the file is not at head and at
 * least one of its threads knows where it was written (with the push when
 * all of them agree on one), else "not in the diff" when the diff doesn't
 * list it, else nothing.
 */
export function fileGroupTag(
  threads: readonly Pick<CommentThread, 'origin'>[],
  inDiff: boolean,
  atHead: FileAtHead,
): FileGroupTag {
  const withOrigin = threads.filter((thread) => thread.origin)
  if (atHead === 'missing' && withOrigin.length > 0) {
    const pushes = new Set(withOrigin.map((thread) => removedInPush(thread.origin)))
    const [only] = pushes
    return { kind: 'removed', push: pushes.size === 1 ? (only ?? null) : null }
  }
  return inDiff ? null : { kind: 'notInDiff' }
}
