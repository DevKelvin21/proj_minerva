import { useCallback, useEffect, useState } from 'react'
import { prKey } from '../../../shared/scm'
import type { PrStateFilter, PullRequestSummary, ScmListError } from '../../../shared/types'
import { useAppStore } from '../stores/app-store'
import { errorText } from '../lib/error-text'

export interface PullRequestsQuery {
  /** Provider-side search (GitHub qualifiers such as `repo:owner/name` work). */
  search?: string
  state: PrStateFilter
  /** `false`: nothing is fetched (and nothing is watched) until it turns on. */
  enabled?: boolean
}

interface UsePullRequestsResult {
  /** The answer to the CURRENT query; `null` until it arrives (an older query's never shows). */
  pullRequests: PullRequestSummary[] | null
  /** Providers that failed this time (typed codes); the others' items are still listed. */
  providerErrors: ScmListError[]
  loading: boolean
  /** The whole call failed (IPC/main), not a single provider. Already `errorText`'d. */
  error: string | null
  /** Asks again right away, with the current query. */
  refetch: () => void
  /**
   * Seals "seen" for `pr` (T52, F10): fire-and-forget `scm:markPrSeen` (a
   * failure is a `console.warn`, it does not block the UI) plus an
   * optimistic clear of THAT item's `unread`, so its dot goes at once.
   */
  markSeen: (pr: PullRequestSummary) => void
}

interface Answer {
  key: string
  items: PullRequestSummary[]
  errors: ScmListError[]
}

const NO_ERRORS: ScmListError[] = []

/**
 * Lists PRs through `scm:listPullRequests` (fan-out over every enabled
 * provider, `unread` decorated in main): the path for closed and merged PRs,
 * which the dashboard (open only) does not carry. Used by the Home repo
 * page's Closed / All. Asks again when the query or `authState` (an opaque
 * auth signature: signing in must refetch) changes, after a retarget
 * (`scmDataVersion`), on `refetch()`, and on every `prListChanged` from
 * main's watcher.
 *
 * The async work (the first `setLoading(true)` included) runs inside a
 * nested function: direct `setState` calls in the effect body trip
 * `react-hooks/set-state-in-effect`.
 */
export function usePullRequests(
  { search, state, enabled = true }: PullRequestsQuery,
  authState = '',
): UsePullRequestsResult {
  const [answer, setAnswer] = useState<Answer | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refetchToken, setRefetchToken] = useState(0)
  // Bumped after a retarget: the list must show the new base.
  const scmDataVersion = useAppStore((s) => s.scmDataVersion)
  const trimmed = search?.trim() || undefined
  const key = (trimmed ?? '') + '\n' + state

  useEffect(() => {
    if (!enabled) return
    let cancelled = false

    void (async () => {
      setLoading(true)
      setError(null)
      try {
        const result = await window.minerva.scm.listPullRequests({ search: trimmed, state })
        if (!cancelled) setAnswer({ key, items: result.items, errors: result.errors })
      } catch (err: unknown) {
        if (!cancelled) setError(errorText(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [enabled, key, trimmed, state, authState, refetchToken, scmDataVersion])

  const refetch = useCallback(() => {
    setRefetchToken((token) => token + 1)
  }, [])

  // Main's watcher (T50/T51, F10): any change it sees (new, closed or merged
  // PR, comments, updates) refreshes the current query.
  useEffect(() => {
    if (!enabled) return
    return window.minerva.events.onPrListChanged(() => refetch())
  }, [enabled, refetch])

  const markSeen = useCallback((pr: PullRequestSummary) => {
    window.minerva.scm
      .markPrSeen({
        repo: pr.repo,
        number: pr.number,
        updatedAt: pr.updatedAt,
        commentCount: pr.commentCount,
      })
      .catch((err: unknown) => {
        console.warn('Could not mark the PR as seen', err)
      })

    const seen = prKey(pr.repo, pr.number)
    setAnswer((prev) =>
      prev
        ? {
            ...prev,
            items: prev.items.map((item) =>
              prKey(item.repo, item.number) === seen
                ? { ...item, unread: { isNew: false, hasUpdates: false, hasNewComments: false } }
                : item,
            ),
          }
        : prev,
    )
  }, [])

  const current = answer !== null && answer.key === key ? answer : null
  return {
    pullRequests: enabled && current ? current.items : null,
    providerErrors: enabled && current ? current.errors : NO_ERRORS,
    loading: enabled && loading,
    error: enabled ? error : null,
    refetch,
    markSeen,
  }
}
