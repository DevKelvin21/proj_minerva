import { useEffect, useState } from 'react'
import type { DiffFile, RepoRef } from '../../../shared/types'
import { repoKey } from '../../../shared/scm'

interface UsePullRequestFilesResult {
  files: DiffFile[]
  loading: boolean
  error: string | null
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Archivos cambiados de un PR vía `scm:getPullRequestFiles`. La lógica va
 * en una función async invocada de inmediato (ver nota en
 * `use-pull-requests.ts`) para no disparar `react-hooks/set-state-in-effect`.
 */
export function usePullRequestFiles(repo: RepoRef, number: number): UsePullRequestFilesResult {
  const repoIdentity = repoKey(repo)
  const [files, setFiles] = useState<DiffFile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    void (async () => {
      setLoading(true)
      setError(null)
      try {
        const result = await window.minerva.scm.getPullRequestFiles({ repo, number })
        if (!cancelled) setFiles(result)
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
  }, [repoIdentity, number])

  return { files, loading, error }
}
