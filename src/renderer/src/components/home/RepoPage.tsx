import { useCallback, useMemo, useState } from 'react'
import { FolderX, Search } from 'lucide-react'
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
  retargetNoteKey,
  stackOrder,
  stacksByRepo,
  summarizeRepos,
  VIEWER_FILTERS,
  visibleStacks,
  type ViewerFilter,
} from '../../lib/dashboard'
import { useAppStore } from '../../stores/app-store'
import { useStacksStore } from '../../stores/stacks-store'
import { Input } from '../ui/Input'
import { ScmProviderIcon } from '../ui/ScmProviderIcon'
import { RetargetNote } from '../stacks/RetargetNote'
import { useEscapeBack } from '../../hooks/use-escape-back'
import { HomePageHeader } from './HomePageHeader'
import {
  CardSkeleton,
  PageEmpty,
  PageSkeleton,
  ProviderErrorList,
  SectionEmpty,
  SectionHeading,
} from './HomeShared'
import { PrCard } from './PrCard'
import { StackBoard } from './StackBoard'
import { InlineError } from '../ui/InlineError'

const keyOf = (pr: PullRequestSummary): string => prKey(pr.repo, pr.number)

/**
 * "All · To review · Optional · Yours · Others" as one segmented control,
 * each segment with the count it would show; the long meaning is the
 * tooltip. Session-only (app store).
 */
function FilterSegments({
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
      className="inline-flex min-w-0 max-w-full shrink-0 items-center gap-0.5 overflow-x-auto rounded-md border border-border bg-bg p-0.5"
    >
      {VIEWER_FILTERS.map((filter) => {
        const active = value === filter
        return (
          <button
            key={filter}
            type="button"
            data-testid={'repo-filter-' + filter}
            aria-pressed={active}
            title={t(`home.filters.titles.${filter}`)}
            onClick={() => onChange(filter)}
            className={`inline-flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded px-2 text-xs font-medium transition-colors duration-150 ${
              active ? 'bg-accent/15 text-accent' : 'text-muted hover:bg-border/60 hover:text-text'
            }`}
          >
            {t(`home.filters.${filter}`)}
            <span className="tabular-nums text-[11px] opacity-80">{counts[filter]}</span>
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
  const { pullRequests, providerErrors, loading, error, fetchedAt, refresh } = useDashboard()
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
  const noteKey = useStacksStore((s) => retargetNoteKey(s.lastRetarget))
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
  // The retarget outcome sits under its stack (StackBoard). Once the PR has
  // left every stack on screen (a fixed orphan is no stack any more), it
  // sits with the PRs not in a stack, where that PR now is.
  const noteInBoard = useMemo(
    () =>
      noteKey !== null && boardVisible.some((stack) => stackOrder(stack).includes(noteKey)),
    [noteKey, boardVisible],
  )
  const noteWithLoose =
    noteKey !== null && !noteInBoard && repoPrs.some((pr) => keyOf(pr) === noteKey)

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
  const allProviderErrors = [...providerErrors, ...stackErrors]

  if (!summary) {
    const waiting = pullRequests === null && stacks === null
    return (
      <div data-testid="repo-page" className="flex min-h-0 min-w-0 flex-1 flex-col">
        <HomePageHeader
          crumbs={[homeCrumb]}
          onBack={goOverview}
          title={waiting ? null : t('home.repoPage.untitled')}
          fetchedAt={fetchedAt}
          busy={busy}
          onRefresh={refreshAll}
        />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
          {error && pullRequests === null ? (
            <InlineError message={t('home.overview.loadFailed', { error })} onRetry={refreshAll} />
          ) : waiting ? (
            <PageSkeleton />
          ) : (
            <>
              <ProviderErrorList errors={allProviderErrors} />
              <PageEmpty icon={FolderX} title={t('home.repoPage.notFound')} />
            </>
          )}
        </div>
      </div>
    )
  }

  const repo = summary.repo
  const owner = repoOwnerLabel(repo)
  const showStacksSection = board.stacks.length > 0 || stacks === null
  const meta = [
    t('home.repoCard.openCount', { count: filteredCounts.open }),
    ...(summary.stacks > 0 ? [t('home.repoCard.stacks', { count: summary.stacks })] : []),
  ].join(' · ')

  return (
    <div
      data-testid="repo-page"
      data-repo-key={repoKey}
      aria-label={t('home.repoPage.ariaLabel', { repo: repo.fullName })}
      className="flex min-h-0 min-w-0 flex-1 flex-col"
    >
      <HomePageHeader
        crumbs={[homeCrumb, { key: 'owner', label: owner, text: owner }]}
        onBack={goOverview}
        icon={<ScmProviderIcon provider={repo.provider} size={16} />}
        title={repo.name}
        titleText={repo.fullName}
        meta={meta}
        fetchedAt={fetchedAt}
        busy={busy}
        onRefresh={refreshAll}
      >
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <FilterSegments value={filter} counts={counts} onChange={setFilter} />
          <Input
            type="search"
            fieldSize="sm"
            icon={<Search size={13} />}
            containerClassName="min-w-[12rem] flex-1"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('home.repoPage.searchPlaceholder')}
            aria-label={t('home.repoPage.searchAriaLabel')}
          />
        </div>
        {hasUnknownRelation && filter !== 'all' && (
          <p className="text-[11px] text-muted">{t('home.filters.unknownRelationHint')}</p>
        )}
      </HomePageHeader>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-4">
        {error && (
          <InlineError message={t('home.overview.refreshFailed', { error })} onRetry={refreshAll} />
        )}
        {openError && <InlineError message={openError} />}
        <ProviderErrorList errors={allProviderErrors} />

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
                <>
                  <p role="status" className="sr-only">
                    {t('home.repoPage.loadingStacks')}
                  </p>
                  <CardSkeleton count={3} className="h-20" />
                </>
              )
            ) : (
              <StackBoard
                stacks={boardVisible}
                pullRequests={repoPrs}
                identity={identity}
                filter={filter}
                pendingKey={pendingKey}
                noteKey={noteInBoard ? noteKey : null}
                onOpenNode={openNode}
                onReviewStack={reviewStack}
              />
            )}
          </section>
        )}

        <section aria-label={t('home.repoPage.prsTitle')} className="flex min-w-0 flex-col gap-2">
          <SectionHeading
            title={
              board.stacks.length > 0
                ? t('home.repoPage.prsNotInStack')
                : t('home.repoPage.prsTitle')
            }
          />
          {noteWithLoose && noteKey !== null && (
            <RetargetNote
              onlyFor={noteKey}
              className="rounded-md border border-border bg-panel px-3 py-2"
            />
          )}
          {loosePrs.length === 0 ? (
            <SectionEmpty
              title={repoPrs.length === 0 ? t('home.repoPage.empty') : t('home.repoPage.noMatch')}
            />
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
