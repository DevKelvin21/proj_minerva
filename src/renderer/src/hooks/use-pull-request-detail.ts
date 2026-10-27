import { useEffect, useState } from 'react'
import type { PullRequestDetail, RepoRef } from '../../../shared/types'
import { repoKey } from '../../../shared/scm'
import { useAppStore } from '../stores/app-store'

interface UsePullRequestDetailResult {
  detail: PullRequestDetail | null
  loading: boolean
  error: string | null
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Detalle de un PR vía `scm:getPullRequestDetail`, para el `repo`+`number`
 * dados. La lógica va en una función async invocada de inmediato (ver nota en
 * `use-pull-requests.ts`) para no disparar `react-hooks/set-state-in-effect`.
 *
 * Also refetches when `scmDataVersion` is bumped (after a retarget). The
 * previous `detail` stays in place while that reload runs (stale while
 * revalidate): callers compare `detail`'s PR with the one they asked for
 * instead of blanking the pane on every `loading`.
 */
export function usePullRequestDetail(repo: RepoRef, number: number): UsePullRequestDetailResult {
  const repoIdentity = repoKey(repo)
  const [detail, setDetail] = useState<PullRequestDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const scmDataVersion = useAppStore((s) => s.scmDataVersion)

  useEffect(() => {
    let cancelled = false

    void (async () => {
      setLoading(true)
      setError(null)
      try {
        const result = await window.minerva.scm.getPullRequestDetail({ repo, number })
        if (!cancelled) setDetail(result)
      } catch (err: unknown) {
        if (!cancelled) setError(toErrorMessage(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- se depende de campos primitivos de `repo`, no de su identidad de objeto.
  }, [repoIdentity, number, scmDataVersion])

  return { detail, loading, error }
}
