import { useCallback } from 'react'
import type { PullRequestSummary } from '../../../shared/types'
import { tagKey } from '../lib/dashboard'
import { personKey, personLabel } from '../lib/home-filter'
import { useAppStore } from '../stores/app-store'
import { useHomeFilterStore } from '../stores/home-filter-store'

interface CardFilter {
  /** Adds "Author: <the PR's author>" to the Home filter and shows its results. */
  byAuthor: (pr: PullRequestSummary) => void
  /** Adds "Tag: <tag>" to the Home filter and shows its results. */
  byTag: (tag: string) => void
}

/**
 * What an author name or a tag on a Home card does: add that filter to the
 * Home filter bar (on top of whatever is already picked) and go to the
 * overview, where the results are.
 */
export function useCardFilter(): CardFilter {
  const navigateHome = useAppStore((s) => s.navigateHome)
  const addValue = useHomeFilterStore((s) => s.addValue)

  const byAuthor = useCallback(
    (pr: PullRequestSummary) => {
      addValue('author', { key: personKey(pr.repo.provider, pr.author), label: personLabel(pr.author) })
      navigateHome({ kind: 'overview' })
    },
    [addValue, navigateHome],
  )

  const byTag = useCallback(
    (tag: string) => {
      const key = tagKey(tag)
      if (!key) return
      addValue('tag', { key, label: tag.trim() })
      navigateHome({ kind: 'overview' })
    },
    [addValue, navigateHome],
  )

  return { byAuthor, byTag }
}
