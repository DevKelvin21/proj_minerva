import { useAppStore } from '../../stores/app-store'
import { FeaturePage } from './FeaturePage'
import { HomeOverview } from './HomeOverview'
import { RepoPage } from './RepoPage'

/**
 * The home dashboard in the center column (replaces the PR review while
 * `mainView === 'home'`). Pages are remounted per entity (`key`), so their
 * local state (text filter, name editor) starts clean on another repo or
 * feature.
 */
export function HomeView(): React.JSX.Element {
  const route = useAppStore((s) => s.homeRoute)
  return (
    <section className="flex min-w-0 flex-1 flex-col overflow-hidden bg-bg">
      {route.kind === 'repo' ? (
        <RepoPage key={route.repoKey} repoKey={route.repoKey} />
      ) : route.kind === 'feature' ? (
        <FeaturePage key={route.featureKey} featureKey={route.featureKey} />
      ) : (
        <HomeOverview />
      )}
    </section>
  )
}
