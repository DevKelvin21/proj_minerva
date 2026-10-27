import { useEffect, useState } from 'react'
import { loadFileContent, type FileContentKey } from '../lib/file-content-cache'
import { splitFileLines } from '../lib/expand-context'
import { prKey } from '../../../shared/scm'

export type FileLinesState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; lines: string[] }
  /** Binary, over the size cap, or no text: nothing to show, and that is not an error. */
  | { status: 'unavailable'; reason: string }
  | { status: 'error'; error: string }

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Lines of a file at the PR's head or base (`scm:getFileContent`, through the
 * shared cache). `key = null` = not needed (yet): nothing is fetched.
 *
 * The answer is stored next to the id it belongs to and the state is derived
 * from it, so a key change never needs a synchronous setState in the effect.
 */
export function useFileLines(key: FileContentKey | null): FileLinesState {
  const id = key
    ? [prKey(key.repo, key.number), key.headSha, key.side, key.path].join('\u0000')
    : null
  const [result, setResult] = useState<{ id: string; state: FileLinesState } | null>(null)

  useEffect(() => {
    if (!key || !id) return
    let cancelled = false
    void (async () => {
      let state: FileLinesState
      try {
        const content = await loadFileContent(key)
        if (content.isBinary) state = { status: 'unavailable', reason: 'Binary file.' }
        else if (content.tooLarge)
          state = { status: 'unavailable', reason: 'File too large to show.' }
        else if (content.content === null) state = { status: 'unavailable', reason: 'No content.' }
        else state = { status: 'ready', lines: splitFileLines(content.content) }
      } catch (err: unknown) {
        state = { status: 'error', error: toErrorMessage(err) }
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
