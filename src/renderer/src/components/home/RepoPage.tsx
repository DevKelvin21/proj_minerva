import { useCallback, useMemo, useState } from 'react'
import { RefreshCw, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { prKey, type PrStack } from '../../../../shared/scm'
import type { PullRequestSummary } from '../../../../shared/types'
import { useDashboard, useViewerIdentity } from '../../hooks/use-dashboard'
import { useHomeOpenPr } from '../../hooks/use-home-open-pr'
import { useStacks } from '../../hooks/use-stacks'
import {
  boardStacks,
  countPullRequests,
  filterByViewer,
  filterPullRequestsByText,
  matchesViewerFilter,
  repoOwnerLabel,
  stackOrder,
  stacksByRepo,
  summarizeRepos,
  VIEWER_FILTERS,
  visibleStacks,
  type ViewerFilter,
} from '../../lib/dashboard'
import { useAppStore } from '../../stores/app-store'
import { IconButton } from '../ui/IconButton'
import { ScmProviderIcon } from '../ui/ScmProviderIcon'
import { RetargetNote } from '../stacks/RetargetNote'
import { useEscapeBack } from '../../hooks/use-escape-back'
import { HomeBreadcrumb } from './HomeBreadcrumb'
import { ContinueReviewButton, ProviderErrorList, SectionHeading } from './HomeShared'
import { PrCard } from './PrCard'
import { StackBoard } from './StackBoard'
import { InlineError } from '../ui/InlineError'

const keyOf = (pr: PullRequestSummary): string => prKey(pr.repo, pr.number)

/**
 * "All · Required reviewer · Optional reviewer · Mine · Not assigned to me",
 * each with the count it would show. Session-only (app store).
 */
function FilterChips({
  value,
  counts,
  onChange,
}: {
  value: ViewerFilter
  counts: Record<ViewerFilter, number>
  onChange: (filter: ViewerFilter) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div
      role="group"
      aria-label={t('home.filters.ariaLabel')}
      className="flex min-w-0 flex-wrap items-center gap-1"
    >
      {VIEWER_FILTERS.map((filter) => {
        const active = value === filter
        return (
          <button
            key={filter}
            type="button"
            data-testid={'repo-filter-' + filter}
            aria-pressed={active}
            onClick={() => onChange(filter)}
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium transition-colors duration-150 ${
              active
                ? 'border-accent/40 bg-accent/15 text-accent'
                : 'border-border text-muted hover:text-text'
            }`}
          >
            {t(`home.filters.${filter}`)}
            <span
              className={`rounded-full px-1 text-[10px] ${active ? 'bg-accent/20' : 'bg-border/60'}`}
            >
              {counts[filter]}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/** Stacks that keep at least one PR after the text filter (empty query = all). */
function stacksMatchingText(
  stacks: readonly PrStack[],
  matched: readonly PullRequestSummary[],
  query: string,
): PrStack[] {
  if (!query.trim()) return [...stacks]
  const keys = new Set(matched.map(keyOf))
  return stacks.filter((stack) => stackOrder(stack).some((key) => keys.has(key)))
}

/**
 * One repository: its stacks as a board (chains, not a list) and the PRs
 * outside any stack as cards, both under the viewer filter and a local text
 * filter. Remounted per repo (`key` in `HomeView`), so the text filter
 * starts empty on another repo.
 */
export function RepoPage({ repoKey }: { repoKey: string }): React.JSX.Element {
  const { t } = useTranslation()
  const { pullRequests, providerErrors, loading, error, refresh } = useDashboard()
  const {
    stacks,
    loading: stacksLoading,
    error: stacksError,
    providerErrors: stackErrors,
    refresh: refreshStacks,
  } = useStacks()
  const identity = useViewerIdentity()
  const filter = useAppStore((s) => s.repoFilter)
  const setFilter = useAppStore((s) => s.setRepoFilter)
  const navigateHome = useAppStore((s) => s.navigateHome)
  const [query, setQuery] = useState('')
  const { open, openNode, reviewStack, pendingKey, error: openError } = useHomeOpenPr()

  const goOverview = useCallback(() => navigateHome({ kind: 'overview' }), [navigateHome])
  useEscapeBack(goOverview)

  const summary = useMemo(
    () => summarizeRepos(pullRequests ?? [], stacks, identity).find((repo) => repo.key === repoKey),
    [pullRequests, stacks, identity, repoKey],
  )
  const repoPrs = useMemo(() => summary?.pullRequests ?? [], [summary])
  const repoStacks = useMemo(() => stacksByRepo(stacks).get(repoKey) ?? [], [stacks, repoKey])
  const board = useMemo(() => boardStacks(repoStacks), [repoStacks])

  const counts = useMemo(() => {
    const result = {} as Record<ViewerFilter, number>
    for (const item of VIEWER_FILTERS) result[item] = filterByViewer(repoPrs, item).length
    return result
  }, [repoPrs])
  const filteredCounts = useMemo(
    () => countPullRequests(filterByViewer(repoPrs, filter), identity),
    [repoPrs, filter, identity],
  )

  const textMatched = useMemo(() => filterPullRequestsByText(repoPrs, query), [repoPrs, query])
  const boardVisible = useMemo(
    () => stacksMatchingText(visibleStacks(board.stacks, repoPrs, filter), textMatched, query),
    [board.stacks, repoPrs, filter, textMatched, query],
  )
  const hiddenStacks = board.stacks.length - boardVisible.length
  const loosePrs = useMemo(
    () =>
      textMatched.filter(
        (pr) => !board.stackedKeys.has(keyOf(pr)) && matchesViewerFilter(pr, filter),
      ),
    [textMatched, board.stackedKeys, filter],
  )
  const hasUnknownRelation = repoPrs.some((pr) => !pr.viewer)

  const refreshAll = (): void => {
    refresh()
    refreshStacks()
  }
  const busy = loading || stacksLoading
  const homeCrumb = {
    key: 'home',
    label: t('home.breadcrumb.home'),
    text: t('home.breadcrumb.home'),
    onClick: goOverview,
  }

  if (!summary) {
    return (
      <div data-testid="repo-page" className="flex min-h-0 min-w-0 flex-1 flex-col">
        <HomeBreadcrumb
          crumbs={[homeCrumb, { key: 'repo', label: repoKey, text: repoKey }]}
          onBack={goOverview}
        />
        <p className="p-4 text-sm text-muted">
          {pullRequests === null && stacks === null
            ? t('home.overview.loading')
            : t('home.repoPage.notFound')}
        </p>
      </div>
    )
  }

  const repo = summary.repo
  const repoLabel = (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <ScmProviderIcon provider={repo.provider} size={12} />
      <span className="truncate">{repo.fullName}</span>
    </span>
  )
  const showStacksSection = board.stacks.length > 0 || stacks === null

  return (
    <div
      data-testid="repo-page"
      data-repo-key={repoKey}
      aria-label={t('home.repoPage.ariaLabel', { repo: repo.fullName })}
      className="flex min-h-0 min-w-0 flex-1 flex-col"
    >
      <HomeBreadcrumb
        crumbs={[homeCrumb, { key: 'repo', label: repoLabel, text: repo.fullName }]}
        onBack={goOverview}
        trailing={
          <>
            <ContinueReviewButton />
            <IconButton
              icon={<RefreshCw size={14} className={busy ? 'animate-spin motion-reduce:animate-none' : ''} />}
              label={t('home.overview.refresh')}
              onClick={refreshAll}
              disabled={busy}
            />
          </>
        }
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-3">
        <header className="flex min-w-0 flex-col gap-2">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="min-w-0 truncate text-base font-semibold text-text" title={repo.fullName}>
              {repo.name}
            </h1>
            <span className="text-xs text-muted">{repoOwnerLabel(repo)}</span>
            <span className="text-xs text-muted">
              {t('home.overview.totals.open', { count: filteredCounts.open })}
              {summary.stacks > 0 && ' · ' + t('home.repoCard.stacks', { count: summary.stacks })}
            </span>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <FilterChips value={filter} counts={counts} onChange={setFilter} />
            <div className="relative ml-auto min-w-[12rem] max-w-sm flex-1">
              <Search
                size={13}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"
              />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('home.repoPage.searchPlaceholder')}
                aria-label={t('home.repoPage.searchAriaLabel')}
                className="w-full rounded-md border border-border bg-bg py-1 pl-8 pr-2 text-xs text-text placeholder:text-muted transition-colors duration-150 focus:border-accent"
              />
            </div>
          </div>
          {hasUnknownRelation && filter !== 'all' && (
            <p className="text-[11px] text-muted">{t('home.filters.unknownRelationHint')}</p>
          )}
        </header>

        {error && (
          <InlineError message={t('home.overview.refreshFailed', { error })} onRetry={refreshAll} />
        )}
        {openError && <InlineError message={openError} />}
        <ProviderErrorList errors={[...providerErrors, ...stackErrors]} />
        <RetargetNote className="rounded-md border border-border bg-panel px-3 py-2" />

        {showStacksSection && (
          <section aria-label={t('home.repoPage.stacksTitle')} className="flex min-w-0 flex-col gap-2">
            <SectionHeading
              title={t('home.repoPage.stacksTitle')}
              hint={t('home.repoPage.stacksHint')}
              trailing={
                hiddenStacks > 0 ? (
                  <span className="text-[11px] text-muted">
                    {t('home.repoPage.stacksHidden', { count: hiddenStacks })}
                  </span>
                ) : undefined
              }
            />
            {stacks === null ? (
              stacksError ? (
                <InlineError
                  message={t('home.repoPage.stacksFailed', { error: stacksError })}
                  onRetry={refreshStacks}
                />
              ) : (
                <p className="text-xs text-muted">{t('home.repoPage.loadingStacks')}</p>
              )
            ) : (
              <StackBoard
                stacks={boardVisible}
                pullRequests={repoPrs}
                identity={identity}
                filter={filter}
                pendingKey={pendingKey}
                onOpenNode={openNode}
                onReviewStack={reviewStack}
              />
            )}
          </section>
        )}

        <section aria-label={t('home.repoPage.prsTitle')} className="flex min-w-0 flex-col gap-2">
          <SectionHeading
            title={t('home.repoPage.prsTitle')}
            hint={board.stacks.length > 0 ? t('home.repoPage.prsHint') : undefined}
          />
          {loosePrs.length === 0 ? (
            <p className="text-xs text-muted">
              {repoPrs.length === 0 ? t('home.repoPage.empty') : t('home.repoPage.noMatch')}
            </p>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3">
              {loosePrs.map((pr) => (
                <PrCard
                  key={keyOf(pr)}
                  pr={pr}
                  identity={identity}
                  pending={pendingKey === keyOf(pr)}
                  onOpen={(item) => open(item)}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
