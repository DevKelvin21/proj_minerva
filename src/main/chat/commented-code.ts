/**
 * The code as commented of the outdated threads a chat message carries
 * (`ChatThreadContext.origin`). The agent's working directory is the snapshot
 * at the PR head, where an outdated thread's lines may have moved or gone, so
 * main reads the file at the thread's origin commit and sends the lines around
 * it with the thread (`../ai/prompts/ask-chat.ts`, fenced as PR data).
 *
 * The read goes through the provider's `getFileContent({ commit })`, the same
 * path the review's "As commented" excerpt uses: the provider refuses a commit
 * that is not the PR's, so a renderer-supplied commit can never reach another
 * ref. A read that fails only drops that excerpt (the thread still goes, with
 * its line numbers); the dev log says so without the path or the content.
 */
import type { ChatContextItem, ChatThreadContext } from '../../shared/chat'
import type { FileContent } from '../../shared/scm'
import type { FileContentRequest, RepoRef } from '../../shared/types'
import type { CommentedCode } from '../ai/service'

/** Lines of context kept on each side of the thread's own lines. */
export const COMMENTED_CODE_CONTEXT_LINES = 5
/** Most lines one excerpt carries (a long range keeps its start). */
export const MAX_COMMENTED_CODE_LINES = 60
/** Longest line kept (the rest is cut with "…"). */
const MAX_LINE_LEN = 300
/** Characters all excerpts of one message carry together (later ones are dropped). */
export const MAX_COMMENTED_CODE_TOTAL = 12_000

type ThreadWithOrigin = ChatThreadContext & {
  path: string
  origin: NonNullable<ChatThreadContext['origin']>
}

function hasOrigin(item: ChatContextItem): item is ThreadWithOrigin {
  return item.kind === 'thread' && item.outdated && !!item.origin && item.path !== undefined
}

function clipLine(line: string): string {
  return line.length <= MAX_LINE_LEN ? line : line.slice(0, MAX_LINE_LEN - 1) + '…'
}

/**
 * The lines of `content` around `line`..`lineEnd` (1-based), or `null` when
 * the thread's first line is past the end of the file.
 */
export function commentedExcerpt(
  content: string,
  commit: string,
  path: string,
  line: number,
  lineEnd: number = line,
): CommentedCode | null {
  const all = content.replace(/\r\n?/g, '\n').split('\n')
  if (all.length > 0 && all[all.length - 1] === '') all.pop()
  if (line > all.length) return null
  const end = Math.min(Math.max(lineEnd, line), all.length)
  const firstLine = Math.max(1, line - COMMENTED_CODE_CONTEXT_LINES)
  const lastLine = Math.min(
    all.length,
    end + COMMENTED_CODE_CONTEXT_LINES,
    firstLine + MAX_COMMENTED_CODE_LINES - 1,
  )
  return {
    commit,
    path,
    firstLine,
    lines: all.slice(firstLine - 1, lastLine).map(clipLine),
    start: line,
    end: Math.min(end, lastLine),
  }
}

function excerptSize(code: CommentedCode): number {
  return code.lines.reduce((n, line) => n + line.length + 1, 0)
}

/**
 * Reads the code as commented of every outdated thread item with an origin,
 * by item id. Never throws: a failed or empty read leaves that item out.
 */
export async function readCommentedCode(
  repo: RepoRef,
  number: number,
  context: readonly ChatContextItem[],
  read: (req: FileContentRequest) => Promise<FileContent>,
): Promise<Record<string, CommentedCode>> {
  const threads = context.filter(hasOrigin)
  const excerpts = await Promise.all(
    threads.map(async (item) => {
      const path = item.origin.path ?? item.path
      try {
        const file = await read({
          repo,
          number,
          path,
          side: 'head',
          commit: item.origin.commit,
        })
        if (file.content === null || file.isBinary || file.tooLarge) return null
        return commentedExcerpt(
          file.content,
          item.origin.commit,
          path,
          item.origin.line,
          item.origin.lineEnd,
        )
      } catch {
        console.warn('[chat] could not read a thread as commented; it goes without its code')
        return null
      }
    }),
  )
  const result: Record<string, CommentedCode> = {}
  let left = MAX_COMMENTED_CODE_TOTAL
  threads.forEach((item, i) => {
    const code = excerpts[i]
    if (!code) return
    const size = excerptSize(code)
    if (size > left) return
    left -= size
    result[item.id] = code
  })
  return result
}
