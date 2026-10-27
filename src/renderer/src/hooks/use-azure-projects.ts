import { useCallback, useState } from 'react'
import { decodeScmErrorMessage } from '../../../shared/scm-errors'

interface UseAzureProjectsResult {
  /** `null` until a load succeeded for the current organization. */
  projects: string[] | null
  loading: boolean
  error: string | null
  load: (organization: string) => Promise<void>
}

/**
 * Project names of an Azure DevOps organization (`scm:listAzureProjects`),
 * loaded on demand for the Settings picker. Errors are shown, never thrown.
 */
export function useAzureProjects(): UseAzureProjectsResult {
  const [projects, setProjects] = useState<string[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (organization: string): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const result = await window.minerva.scm.listAzureProjects({ organization })
      setProjects(result.projects)
    } catch (err) {
      setProjects(null)
      setError(decodeScmErrorMessage(err instanceof Error ? err.message : String(err)).message)
    } finally {
      setLoading(false)
    }
  }, [])

  return { projects, loading, error, load }
}
