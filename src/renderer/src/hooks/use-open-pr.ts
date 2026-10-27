import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { prKey, type RepoRef } from '../../../shared/scm'
import type { PullRequestSummary } from '../../../shared/types'
import { useAppStore } from '../stores/app-store'

interface UseOpenPrResult {
  /** Selects the PR: from `known` when listed there, else after fetching its detail. */
  open: (repo: RepoRef, number: number) => void
  /** `prKey` of the PR being fetched, for a spinner on that row. */
  pendingKey: string | null
  error: string | null
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Opens a PR referenced by a stack node. Stacks cover every open PR in scope,
 * not only the ones in the PR list, so a node may have no
 * `PullRequestSummary` at hand: then its detail (a superset of the summary)
 * is fetched and selected. Selection goes through `onSelect` (the Sidebar's
 * select + mark-seen path) or, by default, `selectPr` + `scm:markPrSeen`.
 */
export function useOpenPr(
  known: readonly PullRequestSummary[] = [],
  onSelect?: (pr: PullRequestSummary) => void,
): UseOpenPrResult {
  const { t } = useTranslation()
  const selectPr = useAppStore((s) => s.selectPr)
  const [pendingKey, setPendingKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const select = useCallback(
    (pr: PullRequestSummary) => {
      if (onSelect) {
        onSelect(pr)
        return
      }
      selectPr(pr)
      window.minerva.scm
        .markPrSeen({
          repo: pr.repo,
          number: pr.number,
          updatedAt: pr.updatedAt,
          commentCount: pr.commentCount,
        })
        .catch((err: unknown) => console.warn('Could not mark the PR as seen', err))
    },
    [onSelect, selectPr],
  )

  const open = useCallback(
    (repo: RepoRef, number: number) => {
      const key = prKey(repo, number)
      const listed = known.find((pr) => prKey(pr.repo, pr.number) === key)
      setError(null)
      if (listed) {
        select(listed)
        return
      }
      setPendingKey(key)
      window.minerva.scm
        .getPullRequestDetail({ repo, number })
        .then((detail) => select(detail))
        .catch((err: unknown) =>
          setError(t('errors.openPrFailed', { number, error: toErrorMessage(err) })),
        )
        .finally(() => setPendingKey((current) => (current === key ? null : current)))
    },
    [known, select, t],
  )

  return { open, pendingKey, error }
}
