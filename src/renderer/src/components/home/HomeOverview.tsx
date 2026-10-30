import { useMemo, useState } from 'react'
import { Eye, EyeOff, LogIn, PlugZap } from 'lucide-react'
import { Trans, useTranslation } from 'react-i18next'
import { useDashboard, useViewerIdentity } from '../../hooks/use-dashboard'
import { useHomeFilter } from '../../hooks/use-home-filter'
import { useHomeOpenPr } from '../../hooks/use-home-open-pr'
import { useLayoutTier } from '../../hooks/use-layout-tier'
import { useScmSettings } from '../../hooks/use-scm-settings'
import { useStacks } from '../../hooks/use-stacks'
import { buildFeatureGroups, summarizeRepos } from '../../lib/dashboard'
import { enabledProviders, isSignInError } from '../../lib/scm-connection'
import { countOrphans } from '../../lib/stacks'
import { useAppStore } from '../../stores/app-store'
import { useDashboardStore } from '../../stores/dashboard-store'
import { Button } from '../ui/Button'
import { SignInHint } from '../layout/SignInHint'
import { FeatureCard } from './FeatureCard'
import { HomeFilterBar } from './HomeFilterBar'
import { HomeFilterResults } from './HomeFilterResults'
import { HomeSavedViews } from './HomeSavedViews'
import { HomePageHeader } from './HomePageHeader'
import { PageEmpty, PageSkeleton, ProviderErrorList, SectionEmpty, SectionHeading } from './HomeShared'
import { RepoCard } from './RepoCard'
import { InlineError } from '../ui/InlineError'

type TotalKey = 'needsReview' | 'mine' | 'open' | 'stacks' | 'orphans'

/** A total as a plain number and its label: read, not clicked. Zero hides it. */
function Total({
  value,
  i18nKey,
  tone = 'text-text',
}: {
  value: number
  i18nKey: TotalKey
  tone?: string
}): React.JSX.Element | null {
  if (value === 0) return null
  return (
    <li data-total={i18nKey} className="inline-flex items-baseline gap-1 text-xs text-muted">
      <Trans
        i18nKey={`home.overview.totals.${i18nKey}`}
        count={value}
        components={{ n: <span className={`text-base font-semibold tabular-nums ${tone}`} /> }}
      />
    </li>
  )
}

/**
 * First screen: totals, the saved views and the filter bar, then the
 * cross-repo features (tags shared by PRs in several repos) and one card
 * per repository. While a filter is active the matching PRs replace both
 * sections. Reads the shared dashboard and stacks caches; nothing here
 * fetches twice.
 */
export function HomeOverview(): React.JSX.Element {
  const { t } = useTranslation()
  const { pullRequests, providerErrors, loading, error, fetchedAt, refresh } = useDashboard()
  const { stacks, loading: stacksLoading, refresh: refreshStacks } = useStacks()
  const identity = useViewerIdentity()
  const featureNames = useDashboardStore((s) => s.featureNames)
  const hiddenFeatures = useDashboardStore((s) => s.hiddenFeatures)
  const setFeatureHidden = useDashboardStore((s) => s.setFeatureHidden)
  const [showHidden, setShowHidden] = useState(false)
  const navigateHome = useAppStore((s) => s.navigateHome)
  const openSettings = useAppStore((s) => s.openSettings)
  const scmAuth = useAppStore((s) => s.scmAuth)
  const scmSettings = useScmSettings().info
  const enabled = enabledProviders(scmSettings, scmAuth)
  const noProviders = enabled !== null && enabled.length === 0
  const githubAccount = scmSettings?.githubAccount ?? null
  const azureOrganization = scmSettings?.providers.azure.organizations[0]?.organization
  const homeFilter = useHomeFilter(pullRequests ?? [], identity)
  const { open: openPr, error: openError } = useHomeOpenPr()
  const folded = useLayoutTier().w === 'sm'

  const repos = useMemo(
    () => summarizeRepos(pullRequests ?? [], stacks, identity),
    [pullRequests, stacks, identity],
  )
  const hiddenKeys = useMemo(() => new Set(hiddenFeatures), [hiddenFeatures])
  const allFeatures = useMemo(
    () => buildFeatureGroups(pullRequests ?? [], featureNames, identity, hiddenKeys),
    [pullRequests, featureNames, identity, hiddenKeys],
  )
  const features = useMemo(() => allFeatures.filter((group) => !group.hidden), [allFeatures])
  const hiddenGroups = useMemo(() => allFeatures.filter((group) => group.hidden), [allFeatures])
  const totals = useMemo(
    () => ({
      needsReview: repos.reduce((sum, repo) => sum + repo.needsMyReview, 0),
      mine: repos.reduce((sum, repo) => sum + repo.mine, 0),
      open: pullRequests?.length ?? 0,
      stacks: repos.reduce((sum, repo) => sum + repo.stacks, 0),
      orphans: stacks ? countOrphans(stacks) : 0,
    }),
    [repos, pullRequests, stacks],
  )

  const signInErrors = providerErrors.filter(isSignInError)
  const needsLogin = signInErrors.length > 0 && (pullRequests?.length ?? 0) === 0
  const otherErrors = needsLogin ? providerErrors.filter((e) => !isSignInError(e)) : providerErrors
  const refreshAll = (): void => {
    refresh()
    refreshStacks()
  }
  const busy = loading || stacksLoading

  let body: React.JSX.Element
  if (noProviders) {
    body = (
      <PageEmpty
        data-testid="home-no-providers"
        icon={PlugZap}
        title={t('home.overview.noProvidersTitle')}
        hint={t('home.overview.noProvidersHint')}
        action={
          <Button variant="primary" onClick={openSettings}>
            {t('home.overview.openSettings')}
          </Button>
        }
      />
    )
  } else if (needsLogin) {
    body = (
      <PageEmpty
        data-testid="home-sign-in-needed"
        icon={LogIn}
        title={t('home.overview.signInTitle')}
        action={
          <div className="mx-auto flex w-full max-w-md flex-col items-center gap-4">
            {signInErrors.map((signInError) => (
              <SignInHint
                key={signInError.provider}
                error={signInError}
                githubAccount={githubAccount}
                azureOrganization={azureOrganization}
              />
            ))}
            <Button variant="primary" onClick={openSettings}>
              {t('home.overview.openSettings')}
            </Button>
            <ProviderErrorList errors={otherErrors} />
          </div>
        }
      />
    )
  } else if (error && pullRequests === null) {
    body = <InlineError message={t('home.overview.loadFailed', { error })} onRetry={refreshAll} />
  } else if (pullRequests === null) {
    body = <PageSkeleton hint={t('home.overview.loadingHint')} />
  } else if (homeFilter.active) {
    body = (
      <>
        {error && (
          <InlineError message={t('home.overview.refreshFailed', { error })} onRetry={refreshAll} />
        )}
        {openError && <InlineError message={openError} />}
        <ProviderErrorList errors={otherErrors} />
        <HomeFilterResults
          pullRequests={pullRequests}
          matched={homeFilter.matched}
          identity={identity}
          statusLabel={homeFilter.statusLabel}
          onOpen={(pr) => openPr(pr)}
        />
      </>
    )
  } else {
    body = (
      <>
        {error && (
          <InlineError message={t('home.overview.refreshFailed', { error })} onRetry={refreshAll} />
        )}
        <ProviderErrorList errors={otherErrors} />
        <section aria-label={t('home.overview.features.title')} className="flex flex-col gap-2">
          <SectionHeading
            title={t('home.overview.features.title')}
            hint={t('home.overview.features.hint')}
            trailing={
              hiddenGroups.length > 0 ? (
                <Button
                  variant="ghost"
                  size="xs"
                  data-testid="features-hidden-toggle"
                  aria-pressed={showHidden}
                  onClick={() => setShowHidden((value) => !value)}
                  icon={showHidden ? <EyeOff size={11} aria-hidden /> : <Eye size={11} aria-hidden />}
                >
                  {t('home.overview.features.hidden', { count: hiddenGroups.length })}
                  {' — '}
                  {showHidden
                    ? t('home.overview.features.hideAgain')
                    : t('home.overview.features.showHidden')}
                </Button>
              ) : undefined
            }
          />
          {features.length === 0 && !(showHidden && hiddenGroups.length > 0) ? (
            <SectionEmpty
              title={t('home.overview.features.emptyTitle')}
              hint={t('home.overview.features.empty')}
            />
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-3">
              {features.map((group) => (
                <FeatureCard
                  key={group.key}
                  group={group}
                  onOpen={(featureKey) => navigateHome({ kind: 'feature', featureKey })}
                />
              ))}
              {showHidden &&
                hiddenGroups.map((group) => (
                  <div
                    key={group.key}
                    data-testid="feature-card-hidden"
                    data-feature-key={group.key}
                    className="flex flex-col gap-1"
                  >
                    <div className="opacity-60">
                      <FeatureCard
                        group={group}
                        onOpen={(featureKey) => navigateHome({ kind: 'feature', featureKey })}
                      />
                    </div>
                    <Button
                      variant="link"
                      size="xs"
                      data-testid="feature-unhide"
                      onClick={() => setFeatureHidden(group.key, false)}
                      className="self-start"
                    >
                      {t('home.featureCard.unhide')}
                    </Button>
                  </div>
                ))}
            </div>
          )}
        </section>
        <section aria-label={t('home.overview.repositories.title')} className="flex flex-col gap-2">
          <SectionHeading
            title={t('home.overview.repositories.title')}
            hint={t('home.overview.totals.repos', { count: repos.length })}
          />
          {repos.length === 0 ? (
            <SectionEmpty
              title={t('home.overview.nothingOpen')}
              hint={t('home.overview.nothingOpenHint')}
            />
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-3">
              {repos.map((summary) => (
                <RepoCard
                  key={summary.key}
                  summary={summary}
                  onOpen={(repoKey) => navigateHome({ kind: 'repo', repoKey })}
                />
              ))}
            </div>
          )}
        </section>
      </>
    )
  }

  const showTotals = pullRequests !== null && !noProviders && !needsLogin

  return (
    <div
      data-testid="home-overview"
      aria-label={t('home.overview.ariaLabel')}
      className="flex min-h-0 min-w-0 flex-1 flex-col"
    >
      <HomePageHeader
        title={t('home.overview.title')}
        meta={t('home.overview.subtitle')}
        fetchedAt={fetchedAt}
        busy={busy}
        onRefresh={refreshAll}
      >
        {showTotals && (
          <ul
            data-testid="home-totals"
            aria-label={t('home.overview.totals.ariaLabel')}
            className="flex min-w-0 flex-wrap items-baseline gap-x-6 gap-y-1"
          >
            <Total value={totals.needsReview} i18nKey="needsReview" tone="text-warning" />
            <Total value={totals.mine} i18nKey="mine" />
            <Total value={totals.open} i18nKey="open" />
            <Total value={totals.stacks} i18nKey="stacks" />
            <Total value={totals.orphans} i18nKey="orphans" tone="text-warning" />
          </ul>
        )}
        {showTotals && <HomeSavedViews pullRequests={pullRequests ?? []} identity={identity} />}
        {showTotals && (
          <HomeFilterBar
            options={homeFilter.options}
            statusLabel={homeFilter.statusLabel}
            folded={folded}
          />
        )}
      </HomePageHeader>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-4">{body}</div>
    </div>
  )
}
