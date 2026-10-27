import { useCallback, useEffect, useState } from 'react'
import type { ScmSettingsInfo, SetProviderSettingsRequest } from '../../../shared/types'
import { useAppStore } from '../stores/app-store'
import { errorText } from '../lib/error-text'

function toErrorMessage(error: unknown): string {
  return errorText(error)
}

interface UseScmSettingsResult {
  /** `null` until the first `scm:getSettings` answers. */
  info: ScmSettingsInfo | null
  error: string | null
  /**
   * Picks the `gh` account to use, or `null` for gh's active account.
   * Persists via `scm:setGithubAccount` and ALSO refreshes the auth status in
   * the store, so TitleBar/Sidebar show the new identity right away instead
   * of waiting for the poll. `false` on failure (see `error`); the auth
   * refresh is best-effort and doesn't affect the result.
   */
  setGithubAccount: (login: string | null) => Promise<boolean>
  /**
   * Saves per-provider settings (enabled flags, Azure orgs/projects) via
   * `scm:setProviderSettings`, then refreshes the auth status so every
   * consumer (and `usePullRequests`, which refetches on auth changes) sees
   * the provider turn on/off. `false` on failure (see `error`).
   */
  saveProviderSettings: (req: SetProviderSettingsRequest) => Promise<boolean>
}

/** SCM settings (mock flag, GitHub account, per-provider settings), shared through the store. */
export function useScmSettings(): UseScmSettingsResult {
  const info = useAppStore((s) => s.scmSettings)
  const setInfo = useAppStore((s) => s.setScmSettings)
  const setScmAuth = useAppStore((s) => s.setScmAuth)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (useAppStore.getState().scmSettings !== null) return
    let cancelled = false
    void window.minerva.scm
      .getSettings()
      .then((result) => {
        if (!cancelled) setInfo(result)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(toErrorMessage(err))
      })
    return () => {
      cancelled = true
    }
  }, [setInfo])

  const setGithubAccount = useCallback(
    async (login: string | null): Promise<boolean> => {
      setError(null)
      try {
        setInfo(await window.minerva.scm.setGithubAccount({ login }))
        try {
          setScmAuth(await window.minerva.scm.getAuthStatus())
        } catch {
          // Best-effort: the declarative poll in `use-scm-auth.ts` recovers it.
        }
        return true
      } catch (err) {
        setError(toErrorMessage(err))
        return false
      }
    },
    [setInfo, setScmAuth],
  )

  const saveProviderSettings = useCallback(
    async (req: SetProviderSettingsRequest): Promise<boolean> => {
      setError(null)
      try {
        setInfo(await window.minerva.scm.setProviderSettings(req))
        try {
          setScmAuth(await window.minerva.scm.getAuthStatus())
        } catch {
          // Best-effort, same as above.
        }
        return true
      } catch (err) {
        setError(toErrorMessage(err))
        return false
      }
    },
    [setInfo, setScmAuth],
  )

  return { info, error, setGithubAccount, saveProviderSettings }
}
