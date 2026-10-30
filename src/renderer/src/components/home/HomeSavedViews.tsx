import { useMemo } from 'react'
import { Bookmark } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { PullRequestSummary } from '../../../../shared/types'
import type { ViewerIdentity } from '../../lib/dashboard'
import { applyHomeFilter } from '../../lib/home-filter'
import { useHomeFilterStore } from '../../stores/home-filter-store'
import { Chip } from '../ui/Chip'

/**
 * The user's saved views above the filter bar, each with how many open PRs
 * it matches right now (a stale view, whose author has no open PR any more,
 * just says 0). Clicking one applies it; clicking the active one clears it.
 * Renders nothing until a view is saved.
 */
export function HomeSavedViews({
  pullRequests,
  identity,
}: {
  pullRequests: readonly PullRequestSummary[]
  identity: ViewerIdentity
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const views = useHomeFilterStore((s) => s.views)
  const activeViewId = useHomeFilterStore((s) => s.activeViewId)
  const applyView = useHomeFilterStore((s) => s.applyView)
  const entries = useMemo(
    () =>
      Object.keys(views).map((id) => ({
        id,
        name: views[id].name,
        count: applyHomeFilter(pullRequests, views[id].filter, identity).length,
      })),
    [views, pullRequests, identity],
  )
  if (entries.length === 0) return null
  return (
    <div
      role="group"
      aria-label={t('home.savedViews.ariaLabel')}
      data-testid="home-saved-views"
      className="flex min-w-0 flex-wrap items-center gap-1.5"
    >
      <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-muted">
        <Bookmark size={12} aria-hidden />
        {t('home.savedViews.label')}
      </span>
      {entries.map((entry) => {
        const activeView = entry.id === activeViewId
        return (
          <Chip
            key={entry.id}
            size="sm"
            data-testid="home-saved-view"
            data-view-id={entry.id}
            selected={activeView}
            count={entry.count}
            onClick={() => applyView(entry.id)}
            title={
              activeView
                ? t('home.savedViews.activeTitle', { name: entry.name })
                : t('home.savedViews.applyTitle', { name: entry.name })
            }
          >
            <span className="min-w-0 truncate">{entry.name}</span>
          </Chip>
        )
      })}
    </div>
  )
}
