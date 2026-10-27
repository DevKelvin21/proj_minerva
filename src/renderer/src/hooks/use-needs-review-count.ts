import { useMemo } from 'react'
import { buildReviewQueue } from '../lib/review-queue'
import { useDashboard, useViewerIdentity } from './use-dashboard'

/** How many open PRs wait for the signed-in user's required review (Home's count too). */
export function useNeedsReviewCount(): number {
  const { pullRequests } = useDashboard()
  const identity = useViewerIdentity()
  return useMemo(
    () => buildReviewQueue(pullRequests ?? [], identity).needsReview.length,
    [pullRequests, identity],
  )
}
