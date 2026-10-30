import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { PullRequestSummary } from '../../../shared/types'
import type { ViewerIdentity } from '../lib/dashboard'
import {
  applyHomeFilter,
  FACETS,
  facetOptions,
  isFilterActive,
  STATUSES,
  type FacetId,
  type FacetOption,
  type HomeFilter,
  type OptionLabels,
  type OptionsByFacet,
  type StatusId,
} from '../lib/home-filter'
import { useHomeFilterStore } from '../stores/home-filter-store'

export interface HomeFilterData {
  filter: HomeFilter
  /** Something is picked or typed: Home shows results instead of the overview. */
  active: boolean
  /** Every facet's values among the open PRs (the pickers and the typed tokens). */
  options: OptionsByFacet
  /** The PRs the filter keeps (all of them while inactive). */
  matched: PullRequestSummary[]
  statusLabel: (status: StatusId) => string
}

/**
 * The Home filter over the dashboard answer that is already loaded: picker
 * options with counts and the matching PRs. Nothing here fetches.
 */
export function useHomeFilter(
  pullRequests: readonly PullRequestSummary[],
  identity: ViewerIdentity,
): HomeFilterData {
  const { t } = useTranslation()
  const filter = useHomeFilterStore((s) => s.filter)
  const labels = useMemo<OptionLabels>(() => {
    const status = {} as Record<StatusId, string>
    for (const id of STATUSES) status[id] = t(`home.filterBar.statuses.${id}`)
    return { me: t('home.filterBar.me'), status }
  }, [t])
  const options = useMemo(() => {
    const byFacet = {} as Record<FacetId, FacetOption[]>
    for (const facet of FACETS) byFacet[facet] = facetOptions(pullRequests, facet, identity, labels)
    return byFacet as OptionsByFacet
  }, [pullRequests, identity, labels])
  const matched = useMemo(
    () => applyHomeFilter(pullRequests, filter, identity),
    [pullRequests, filter, identity],
  )
  return {
    filter,
    active: isFilterActive(filter),
    options,
    matched,
    statusLabel: (status) => labels.status[status],
  }
}
