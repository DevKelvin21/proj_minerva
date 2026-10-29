import { useCallback, useEffect, useState } from 'react'
import { repoKey, type RepoRef } from '../../../shared/scm'
import type { MergeOptions } from '../../../shared/types'
import { useAppStore } from '../stores/app-store'
import { errorText } from '../lib/error-text'

interface UseMergeOptionsResult {
  options: MergeOptions | null
  loading: boolean
  error: string | null
  reload: () => void
}

/**
 * `scm:getMergeOptions` for one open PR: refetched when the head commit
 * changes, when `scmDataVersion` is bumped (after a merge, a retarget or a
 * stale write) and on `reload()` (the popover opening). The previous options
 * stay on screen while a reload runs.
 */
export function useMergeOptions(
  repo: RepoRef,
  number: number,
  headSha: string,
  enabled: boolean,
): UseMergeOptionsResult {
  const repoIdentity = repoKey(repo)
  const scmDataVersion = useAppStore((s) => s.scmDataVersion)
  const [options, setOptions] = useState<MergeOptions | null>(null)
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    void (async () => {
      setLoading(true)
      setError(null)
      try {
        const result = await window.minerva.scm.getMergeOptions({ repo, number })
        if (!cancelled) setOptions(result)
      } catch (err: unknown) {
        if (!cancelled) setError(errorText(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- depends on `repo`'s identity key, not its object identity.
  }, [repoIdentity, number, headSha, enabled, scmDataVersion, nonce])

  const reload = useCallback(() => setNonce((value) => value + 1), [])
  return { options, loading, error, reload }
}
