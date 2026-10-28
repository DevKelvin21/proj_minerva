import { useMemo, useState } from 'react'
import { Eye, EyeOff, Layers, RefreshCw, TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useDashboard, useViewerIdentity } from '../../hooks/use-dashboard'
import { useScmSettings } from '../../hooks/use-scm-settings'
import { useStacks } from '../../hooks/use-stacks'
import { useLocale } from '../../i18n/use-locale'
import { buildFeatureGroups, summarizeRepos } from '../../lib/dashboard'
import { formatRelativeTime } from '../../lib/relative-time'
import { enabledProviders, isSignInError } from '../../lib/scm-connection'
import { countOrphans } from '../../lib/stacks'
import { useAppStore } from '../../stores/app-store'
import { useDashboardStore } from '../../stores/dashboard-store'
import { Button } from '../ui/Button'
import { IconButton } from '../ui/IconButton'
import { SignInHint } from '../layout/SignInHint'
import { RetargetNote } from '../stacks/RetargetNote'
import { FeatureCard } from './FeatureCard'
import { CardSkeleton, ContinueReviewButton, ProviderErrorList, SectionHeading } from './HomeShared'
import { RepoCard } from './RepoCard'
import { InlineError } from '../ui/InlineError'

function Total({
  value,
  label,
  tone = 'neutral',
  icon,
}: {
  value: number
  label: string
  tone?: 'neutral' | 'warning' | 'accent'
  icon?: React.ReactNode
}): React.JSX.Element | null {
  if (value === 0) return null
  const toneClass =
    tone === 'warning'
      ? 'border-warning/40 bg-warning/10 text-warning'
      : tone === 'accent'
        ? 'border-accent/40 bg-accent/10 text-accent'
        : 'border-border bg-panel text-text/80'
  return (
    <li
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium ${toneClass}`}
    >
      {icon}
      {label}
    </li>
  )
}

/**
 * First screen: totals, the cross-repo features (tags shared by PRs in
 * several repos) and one card per repository. Reads the shared dashboard
 * and stacks caches; nothing here fetches twice.
 */
export function HomeOverview(): React.JSX.Element {
  const { t } = useTranslation()
  const { locale } = useLocale()
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
      <div data-testid="home-no-providers" className="flex flex-col items-center gap-3 py-10 text-center">
        <p className="text-sm font-medium text-text">{t('home.overview.noProvidersTitle')}</p>
        <p className="max-w-sm text-xs text-muted">{t('home.overview.noProvidersHint')}</p>
        <Button variant="primary" onClick={openSettings}>
          {t('home.overview.openSettings')}
        </Button>
      </div>
    )
  } else if (needsLogin) {
    body = (
      <div
        data-testid="home-sign-in-needed"
        className="mx-auto flex w-full max-w-md flex-col items-center gap-4 py-10 text-center"
      >
        <span className="text-3xl" aria-hidden>
          🔒
        </span>
        <p className="text-sm font-medium text-text">{t('home.overview.signInTitle')}</p>
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
    )
  } else if (error && pullRequests === null) {
    body = (
      <InlineError message={t('home.overview.loadFailed', { error })} onRetry={refreshAll} />
    )
  } else if (pullRequests === null) {
    body = (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1 text-sm text-muted">
          <p>{t('home.overview.loading')}</p>
          <p className="text-xs">{t('home.overview.loadingHint')}</p>
        </div>
        <CardSkeleton count={6} />
      </div>
    )
  } else {
    body = (
      <>
        {error && (
          <InlineError message={t('home.overview.refreshFailed', { error })} onRetry={refreshAll} />
        )}
        <ProviderErrorList errors={otherErrors} />
        <RetargetNote className="rounded-md border border-border bg-panel px-3 py-2" />
        <section aria-label={t('home.overview.features.title')} className="flex flex-col gap-2">
          <SectionHeading
            title={t('home.overview.features.title')}
            hint={t('home.overview.features.hint')}
            trailing={
              hiddenGroups.length > 0 ? (
                <Button
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
            <p className="text-xs text-muted">{t('home.overview.features.empty')}</p>
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
            <div className="flex flex-col gap-1 py-6 text-center text-sm text-muted">
              <p>{t('home.overview.nothingOpen')}</p>
              <p className="text-xs">{t('home.overview.nothingOpenHint')}</p>
            </div>
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

  return (
    <div
      data-testid="home-overview"
      aria-label={t('home.overview.ariaLabel')}
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto"
    >
      <header className="flex shrink-0 flex-col gap-2 border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex min-w-0 flex-col">
            <h1 className="text-base font-semibold text-text">{t('home.overview.title')}</h1>
            <p className="truncate text-xs text-muted">{t('home.overview.subtitle')}</p>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <ContinueReviewButton />
            {fetchedAt && (
              <span className="hidden text-[11px] text-muted sm:inline" title={fetchedAt}>
                {t('home.overview.updatedAt', { time: formatRelativeTime(fetchedAt, locale) })}
              </span>
            )}
            <IconButton
              icon={<RefreshCw size={14} className={busy ? 'animate-spin motion-reduce:animate-none' : ''} />}
              label={t('home.overview.refresh')}
              onClick={refreshAll}
              disabled={busy}
            />
          </div>
        </div>
        {pullRequests !== null && !noProviders && !needsLogin && (
          <ul aria-label={t('home.overview.totals.ariaLabel')} className="flex flex-wrap items-center gap-1.5">
            <Total
              value={totals.needsReview}
              label={t('home.overview.totals.needsReview', { count: totals.needsReview })}
              tone="warning"
            />
            <Total
              value={totals.mine}
              label={t('home.overview.totals.mine', { count: totals.mine })}
              tone="accent"
            />
            <Total value={totals.open} label={t('home.overview.totals.open', { count: totals.open })} />
            <Total
              value={totals.stacks}
              label={t('home.overview.totals.stacks', { count: totals.stacks })}
              icon={<Layers size={12} className="text-accent" aria-hidden />}
            />
            <Total
              value={totals.orphans}
              label={t('home.overview.totals.orphans', { count: totals.orphans })}
              tone="warning"
              icon={<TriangleAlert size={12} aria-hidden />}
            />
          </ul>
        )}
      </header>
      <div className="flex min-w-0 flex-col gap-5 px-4 py-4">{body}</div>
    </div>
  )
}
