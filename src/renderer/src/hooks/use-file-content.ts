import { useEffect, useState } from 'react'
import { fileContentKeyId, loadFileContent, type FileContentKey } from '../lib/file-content-cache'
import { splitFileLines } from '../lib/expand-context'
import { errorText } from '../lib/error-text'
import { scmErrorCodeOf } from '../../../shared/scm-errors'
import type { ScmErrorCode } from '../../../shared/scm'

/** Why a file has no lines to show; the component translates it (`prDetail.fileContent.*`). */
export type FileUnavailableReason = 'binary' | 'tooLarge' | 'noContent'

export type FileLinesState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; lines: string[] }
  /** Binary, over the size cap, or no text: nothing to show, and that is not an error. */
  | { status: 'unavailable'; reason: FileUnavailableReason }
  /**
   * `error` is one display line; `code` is the `[SCM:CODE]` it carried
   * (`NOT_FOUND` = the file does not exist at that version). `retry` asks
   * again (a failed read is never cached).
   */
  | { status: 'error'; error: string; code: ScmErrorCode | null; retry: () => void }

/**
 * Lines of a file at the PR's head or base, or at one of its commits
 * (`scm:getFileContent`, through the shared cache). `key = null` = not needed
 * (yet): nothing is fetched.
 *
 * The answer is stored next to the id it belongs to and the state is derived
 * from it, so a key change never needs a synchronous setState in the effect.
 * A retry bumps `attempt`, which is part of the id.
 */
export function useFileLines(key: FileContentKey | null): FileLinesState {
  const [attempt, setAttempt] = useState(0)
  const id = key ? fileContentKeyId(key) + '\u0000' + attempt : null
  const [result, setResult] = useState<{ id: string; state: FileLinesState } | null>(null)

  useEffect(() => {
    if (!key || !id) return
    let cancelled = false
    void (async () => {
      let state: FileLinesState
      try {
        const content = await loadFileContent(key)
        if (content.isBinary) state = { status: 'unavailable', reason: 'binary' }
        else if (content.tooLarge) state = { status: 'unavailable', reason: 'tooLarge' }
        else if (content.content === null) state = { status: 'unavailable', reason: 'noContent' }
        else state = { status: 'ready', lines: splitFileLines(content.content) }
      } catch (err: unknown) {
        state = {
          status: 'error',
          error: errorText(err),
          code: scmErrorCodeOf(err),
          retry: () => setAttempt((n) => n + 1),
        }
      }
      if (!cancelled) setResult({ id, state })
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `id` captures every field of `key`.
  }, [id])

  if (!id) return { status: 'idle' }
  if (result?.id !== id) return { status: 'loading' }
  return result.state
}
