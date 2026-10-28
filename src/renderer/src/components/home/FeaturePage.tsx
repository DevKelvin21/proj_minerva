import { useCallback, useMemo, useState } from 'react'
import { Check, Eye, EyeOff, Pencil, RefreshCw, Tag, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { prKey } from '../../../../shared/scm'
import { useDashboard, useViewerIdentity } from '../../hooks/use-dashboard'
import { useHomeOpenPr } from '../../hooks/use-home-open-pr'
import {
  buildFeatureGroups,
  FEATURE_NAME_MAX_LENGTH,
  normalizeFeatureName,
  repoOwnerLabel,
  type FeatureGroup,
} from '../../lib/dashboard'
import { useAppStore } from '../../stores/app-store'
import { useDashboardStore } from '../../stores/dashboard-store'
import { IconButton } from '../ui/IconButton'
import { ScmProviderIcon } from '../ui/ScmProviderIcon'
import { ApprovalBar } from './FeatureCard'
import { useEscapeBack } from '../../hooks/use-escape-back'
import { HomeBreadcrumb } from './HomeBreadcrumb'
import { ContinueReviewButton, ProviderErrorList } from './HomeShared'
import { PrCard } from './PrCard'
import { InlineError } from '../ui/InlineError'

/**
 * The feature's name: shown as a heading with "Rename"; editing swaps in a
 * field with Save / Cancel and, when a custom name is set, "Use the tag
 * name". Enter saves, Esc cancels (and does not bubble to the page's back).
 */
function FeatureName({ group }: { group: FeatureGroup }): React.JSX.Element {
  const { t } = useTranslation()
  const setFeatureName = useDashboardStore((s) => s.setFeatureName)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(group.name)

  const startEditing = (): void => {
    setDraft(group.name)
    setEditing(true)
  }
  const save = (): void => {
    const name = normalizeFeatureName(draft)
    // Saving the tag itself (or blank) = back to the default.
    setFeatureName(group.key, name !== null && name !== group.tag ? name : null)
    setEditing(false)
  }
  const reset = (): void => {
    setFeatureName(group.key, null)
    setEditing(false)
  }

  if (!editing) {
    return (
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <h1 className="min-w-0 truncate text-base font-semibold text-text" title={group.name}>
          {group.name}
        </h1>
        <button
          type="button"
          data-testid="feature-rename"
          onClick={startEditing}
          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-xs text-muted transition-colors duration-150 hover:border-accent hover:text-text"
        >
          <Pencil size={12} aria-hidden />
          {t('home.featurePage.rename')}
        </button>
      </div>
    )
  }

  return (
    <form
      className="flex min-w-0 flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        save()
      }}
    >
      <input
        type="text"
        autoFocus
        value={draft}
        maxLength={FEATURE_NAME_MAX_LENGTH}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            setEditing(false)
          }
        }}
        aria-label={t('home.featurePage.nameLabel')}
        placeholder={t('home.featurePage.namePlaceholder')}
        className="min-w-[12rem] rounded-md border border-border bg-bg px-2 py-1 text-sm text-text placeholder:text-muted focus:border-accent"
      />
      <button
        type="submit"
        className="inline-flex items-center gap-1 rounded-md border border-accent/50 bg-accent/10 px-2 py-1 text-xs font-medium text-accent transition-colors duration-150 hover:bg-accent/20"
      >
        <Check size={12} aria-hidden />
        {t('home.featurePage.save')}
      </button>
      <button
        type="button"
        onClick={() => setEditing(false)}
        className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted transition-colors duration-150 hover:text-text"
      >
        <X size={12} aria-hidden />
        {t('home.featurePage.cancel')}
      </button>
      {group.renamed && (
        <button
          type="button"
          onClick={reset}
          className="text-xs text-muted underline decoration-dotted transition-colors duration-150 hover:text-text"
        >
          {t('home.featurePage.resetToTag')}
        </button>
      )}
    </form>
  )
}

/**
 * One cross-repo feature: editable name, its tag, approval progress and
 * the PRs grouped by repository (each repo header opens that repo's page).
 * Remounted per feature (`key` in `HomeView`).
 */
export function FeaturePage({ featureKey }: { featureKey: string }): React.JSX.Element {
  const { t } = useTranslation()
  const { pullRequests, providerErrors, loading, error, refresh } = useDashboard()
  const identity = useViewerIdentity()
  const featureNames = useDashboardStore((s) => s.featureNames)
  const hiddenFeatures = useDashboardStore((s) => s.hiddenFeatures)
  const setFeatureHidden = useDashboardStore((s) => s.setFeatureHidden)
  const navigateHome = useAppStore((s) => s.navigateHome)
  const { open, pendingKey, error: openError } = useHomeOpenPr()

  const goOverview = useCallback(() => navigateHome({ kind: 'overview' }), [navigateHome])
  useEscapeBack(goOverview)

  const group = useMemo(
    () =>
      buildFeatureGroups(pullRequests ?? [], featureNames, identity, new Set(hiddenFeatures)).find(
        (item) => item.key === featureKey,
      ),
    [pullRequests, featureNames, identity, hiddenFeatures, featureKey],
  )
  const homeCrumb = {
    key: 'home',
    label: t('home.breadcrumb.home'),
    text: t('home.breadcrumb.home'),
    onClick: goOverview,
  }

  if (!group) {
    return (
      <div data-testid="feature-page" className="flex min-h-0 min-w-0 flex-1 flex-col">
        <HomeBreadcrumb
          crumbs={[homeCrumb, { key: 'feature', label: featureKey, text: featureKey }]}
          onBack={goOverview}
        />
        <p className="p-4 text-sm text-muted">
          {pullRequests === null ? t('home.overview.loading') : t('home.featurePage.notFound')}
        </p>
      </div>
    )
  }

  return (
    <div
      data-testid="feature-page"
      data-feature-key={group.key}
      aria-label={t('home.featurePage.ariaLabel', { name: group.name })}
      className="flex min-h-0 min-w-0 flex-1 flex-col"
    >
      <HomeBreadcrumb
        crumbs={[homeCrumb, { key: 'feature', label: group.name, text: group.name }]}
        onBack={goOverview}
        trailing={
          <>
            <ContinueReviewButton />
            <IconButton
              icon={<RefreshCw size={14} className={loading ? 'animate-spin motion-reduce:animate-none' : ''} />}
              label={t('home.overview.refresh')}
              onClick={refresh}
              disabled={loading}
            />
          </>
        }
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-3">
        <header className="flex min-w-0 flex-col gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <FeatureName key={group.name + '\n' + String(group.renamed)} group={group} />
            <button
              type="button"
              data-testid="feature-hide"
              aria-pressed={group.hidden}
              onClick={() => setFeatureHidden(group.key, !group.hidden)}
              className="ml-auto inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-xs text-muted transition-colors duration-150 hover:border-accent hover:text-text"
            >
              {group.hidden ? <Eye size={12} aria-hidden /> : <EyeOff size={12} aria-hidden />}
              {group.hidden ? t('home.featurePage.unhide') : t('home.featurePage.hide')}
            </button>
          </div>
          {group.hidden && (
            <p className="text-[11px] text-muted">{t('home.featurePage.hiddenHint')}</p>
          )}
          <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted">
            <span
              data-testid="feature-tag"
              className="inline-flex max-w-full items-center gap-1 rounded-full bg-border/60 px-2 py-0.5 text-[11px] font-medium text-muted"
            >
              <Tag size={11} aria-hidden />
              <span className="truncate">{group.tag}</span>
            </span>
            <span>
              {group.renamed
                ? t('home.featurePage.renamedHint', { tag: group.tag })
                : t('home.featurePage.tagHint', { tag: group.tag, count: group.repos.length })}
            </span>
          </div>
          <div className="flex max-w-md flex-col gap-1">
            <ApprovalBar
              approved={group.approved}
              total={group.prCount}
              label={t('home.featurePage.progressAriaLabel')}
            />
            <span className="flex flex-wrap gap-x-3 text-[11px] text-muted">
              <span>
                {t('home.featurePage.approvedSummary', {
                  approved: group.approved,
                  total: group.prCount,
                })}
              </span>
              {group.needsMyReview > 0 && (
                <span className="text-warning">
                  {t('home.featurePage.needsReview', { count: group.needsMyReview })}
                </span>
              )}
            </span>
          </div>
        </header>

        {error && (
          <InlineError message={t('home.overview.refreshFailed', { error })} onRetry={refresh} />
        )}
        {openError && <InlineError message={openError} />}
        <ProviderErrorList errors={providerErrors} />

        <div className="grid grid-cols-[repeat(auto-fit,minmax(16rem,1fr))] gap-4">
          {group.repos.map((featureRepo) => (
            <section
              key={featureRepo.key}
              data-feature-repo={featureRepo.key}
              aria-label={featureRepo.repo.fullName}
              className="flex min-w-0 flex-col gap-2"
            >
              <button
                type="button"
                onClick={() => navigateHome({ kind: 'repo', repoKey: featureRepo.key })}
                title={t('home.featurePage.openRepo', { repo: featureRepo.repo.fullName })}
                className="flex min-w-0 items-center gap-1.5 rounded-md px-1 py-0.5 text-left transition-colors duration-150 hover:bg-panel"
              >
                <ScmProviderIcon provider={featureRepo.repo.provider} size={12} />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-text">
                  {featureRepo.repo.name}
                </span>
                <span className="truncate text-[11px] text-muted">
                  {repoOwnerLabel(featureRepo.repo)}
                </span>
                <span className="shrink-0 rounded-full bg-border/60 px-1.5 text-[10px] text-muted">
                  {t('home.featurePage.prsInRepo', { count: featureRepo.pullRequests.length })}
                </span>
              </button>
              <div className="flex flex-col gap-2">
                {featureRepo.pullRequests.map((pr) => (
                  <PrCard
                    key={prKey(pr.repo, pr.number)}
                    pr={pr}
                    identity={identity}
                    pending={pendingKey === prKey(pr.repo, pr.number)}
                    onOpen={(item) => open(item)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
