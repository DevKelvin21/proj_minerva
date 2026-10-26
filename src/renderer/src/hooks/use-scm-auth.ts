import { useEffect, useState } from 'react'
import type { ScmAuthStatus, ScmProviderId } from '../../../shared/scm'
import { useAppStore } from '../stores/app-store'

const POLL_INTERVAL_MS = 3000

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** A provider that is configured but not ready yet: keep polling until it signs in. */
function isWaitingForSession(status: ScmAuthStatus | undefined): boolean {
  return status !== undefined && status.state !== 'signed_in' && status.state !== 'disabled'
}

/** Stable string of the states worth polling for, so the effect only re-runs when they change. */
function pollKey(statuses: Record<ScmProviderId, ScmAuthStatus> | null): string {
  if (statuses === null) return ''
  return Object.values(statuses)
    .filter(isWaitingForSession)
    .map((status) => status.provider + ':' + status.state)
    .join(',')
}

interface UseScmAuthResult {
  /** `null` until the first `scm:getAuthStatus` answers. */
  statuses: Record<ScmProviderId, ScmAuthStatus> | null
  error: string | null
}

/**
 * Per-provider SCM auth status via `scm:getAuthStatus`. Lives in the store
 * (`scmAuth`) because several consumers (TitleBar, Sidebar, Settings, data
 * hooks) must see the SAME transition — `usePullRequests` refetches when it
 * changes.
 *
 * Polling is declarative: while any configured provider is not signed in
 * (`gh` missing or without a session), an interval re-asks every
 * `POLL_INTERVAL_MS`, so running `gh auth login` in a terminal shows up on
 * its own (plus the 5s probe TTL in main). Account switches don't depend on
 * this: `useSettings().setGithubAccount` pushes a fresh status right away.
 */
export function useScmAuth(): UseScmAuthResult {
  const statuses = useAppStore((s) => s.scmAuth)
  const setStatuses = useAppStore((s) => s.setScmAuth)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.minerva.scm
      .getAuthStatus()
      .then((result) => {
        if (!cancelled) setStatuses(result)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(toErrorMessage(err))
      })
    return () => {
      cancelled = true
    }
  }, [setStatuses])

  const key = pollKey(statuses)
  useEffect(() => {
    if (key === '') return undefined
    const timer = setInterval(() => {
      void window.minerva.scm
        .getAuthStatus()
        .then((next) => setStatuses(next))
        .catch((err: unknown) => setError(toErrorMessage(err)))
    }, POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [key, setStatuses])

  return { statuses, error }
}
