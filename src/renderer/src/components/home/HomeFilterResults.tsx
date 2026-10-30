import { useState, type FormEvent } from 'react'
import { Bookmark, BookmarkPlus, Funnel, GitPullRequest, Trash2 } from 'lucide-react'
import { Trans, useTranslation } from 'react-i18next'
import { prKey, repoKey } from '../../../../shared/scm'
import type { PullRequestSummary } from '../../../../shared/types'
import { useLocale } from '../../i18n/use-locale'
import { isUnread, repoOwnerLabel, type ViewerIdentity } from '../../lib/dashboard'
import {
  bestWithoutHint,
  isStatusId,
  ME_KEY,
  personLabel,
  plainText,
  repoCount,
  sameFilter,
  suggestViewName,
  withoutCandidate,
  type DropCandidate,
  type FilterValue,
  type HomeFilter,
  type StatusId,
} from '../../lib/home-filter'
import { groupByRepo } from '../../lib/pr-filters'
import { formatRelativeTime } from '../../lib/relative-time'
import { reviewDecisionLabelKey } from '../../lib/scm-labels'
import { transText } from '../../lib/trans-text'
import { useHomeFilterStore } from '../../stores/home-filter-store'
import { Avatar } from '../ui/Avatar'
import { Badge, type BadgeTone } from '../ui/Badge'
import { Button } from '../ui/Button'
import { CiStatusIcon } from '../ui/CiStatusIcon'
import { Input } from '../ui/Input'
import { ScmProviderIcon } from '../ui/ScmProviderIcon'

function reviewTone(pr: PullRequestSummary): BadgeTone {
  switch (pr.reviewDecision) {
    case 'approved':
      return 'success'
    case 'changes_requested':
    case 'rejected':
      return 'warning'
    default:
      return 'neutral'
  }
}

/** One matching PR, like a sidebar row with its author, age and tags: opens the review. */
function ResultRow({
  pr,
  onOpen,
}: {
  pr: PullRequestSummary
  onOpen: (pr: PullRequestSummary) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const { locale } = useLocale()
  const unread = isUnread(pr)
  const labels = pr.labels ?? []
  return (
    <button
      type="button"
      data-testid="home-filter-row"
      data-pr-key={prKey(pr.repo, pr.number)}
      onClick={() => onOpen(pr)}
      title={'#' + pr.number + ' ' + pr.title}
      className="grid w-full min-w-0 grid-cols-[0.5rem_minmax(0,1fr)_auto] items-center gap-2.5 border-t border-border px-3 py-2 text-left transition-colors duration-150 hover:bg-bg/60"
    >
      {unread ? (
        <span
          role="img"
          aria-label={t('home.prCard.unread')}
          className="h-1.5 w-1.5 rounded-full bg-danger"
        />
      ) : (
        <span aria-hidden />
      )}
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className={`flex min-w-0 items-center gap-1.5 text-sm ${unread ? 'font-semibold text-text' : 'font-medium text-text/85'}`}>
          <GitPullRequest
            size={13}
            aria-hidden
            className={`shrink-0 ${pr.isDraft ? 'text-muted' : 'text-success'}`}
          />
          <span className="shrink-0 font-mono text-xs text-muted">#{pr.number}</span>
          <span className="min-w-0 truncate">{pr.title}</span>
        </span>
        <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-muted">
          <Avatar user={pr.author} size={14} />
          <span className="min-w-0 truncate">{personLabel(pr.author)}</span>
          <span aria-hidden>·</span>
          <span className="shrink-0" title={pr.updatedAt}>
            {formatRelativeTime(pr.updatedAt, locale)}
          </span>
          {labels.slice(0, 3).map((label) => (
            <Badge key={label.name} tone="outline" size="sm" className="max-w-[9rem]">
              <span className="min-w-0 truncate">{label.name}</span>
            </Badge>
          ))}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        {pr.isDraft && (
          <Badge tone="outline" size="sm">
            {t('home.prCard.draft')}
          </Badge>
        )}
        {pr.reviewDecision && (
          <Badge tone={reviewTone(pr)} size="sm" data-review={pr.reviewDecision}>
            {t(reviewDecisionLabelKey(pr.reviewDecision, pr.repo.provider))}
          </Badge>
        )}
        <CiStatusIcon status={pr.ciStatus} size={13} />
      </span>
    </button>
  )
}

/** "by Ada Lovelace · tagged checkout-v2 · “submit” · in 2 repositories". */
function useSummarySentence(filter: HomeFilter, matched: readonly PullRequestSummary[], statusLabel: (status: StatusId) => string): string {
  const { t } = useTranslation()
  const { locale } = useLocale()
  const or = new Intl.ListFormat(locale, { type: 'disjunction' })
  const names = (values: readonly FilterValue[]): string =>
    or.format(values.map((value) => (value.key === ME_KEY ? t('home.filterResults.meInSentence') : value.label)))
  const parts: string[] = []
  if (filter.author.length > 0) parts.push(t('home.filterResults.by', { names: names(filter.author) }))
  if (filter.tag.length > 0) parts.push(t('home.filterResults.tagged', { names: names(filter.tag) }))
  if (filter.repo.length > 0) parts.push(t('home.filterResults.inRepo', { names: names(filter.repo) }))
  if (filter.reviewer.length > 0) {
    parts.push(t('home.filterResults.reviewedBy', { names: names(filter.reviewer) }))
  }
  if (filter.status.length > 0) {
    parts.push(t('home.filterResults.status', { names: or.format(filter.status.map(statusLabel)) }))
  }
  const text = plainText(filter.text)
  if (text) parts.push(t('home.filterResults.text', { text }))
  if (matched.length > 0) parts.push(t('home.filterResults.inRepos', { count: repoCount(matched) }))
  return parts.join(' · ')
}

/** "Save view" / "Update view" / "Delete view", and the inline name field. */
function ViewActions({ statusLabel }: { statusLabel: (status: StatusId) => string }): React.JSX.Element {
  const { t } = useTranslation()
  const filter = useHomeFilterStore((s) => s.filter)
  const views = useHomeFilterStore((s) => s.views)
  const activeViewId = useHomeFilterStore((s) => s.activeViewId)
  const saveView = useHomeFilterStore((s) => s.saveView)
  const updateView = useHomeFilterStore((s) => s.updateView)
  const deleteView = useHomeFilterStore((s) => s.deleteView)
  const [name, setName] = useState<string | null>(null)
  const activeView = activeViewId !== null && Object.hasOwn(views, activeViewId) ? views[activeViewId] : null
  const changed = activeView !== null && !sameFilter(activeView.filter, filter)

  if (name !== null) {
    const submit = (event: FormEvent): void => {
      event.preventDefault()
      if (saveView(name) !== null) setName(null)
    }
    return (
      <form onSubmit={submit} className="flex min-w-0 items-center gap-1.5" data-testid="home-view-name-form">
        <Input
          autoFocus
          fieldSize="sm"
          value={name}
          maxLength={60}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              setName(null)
            }
          }}
          aria-label={t('home.savedViews.nameLabel')}
          placeholder={t('home.savedViews.namePlaceholder')}
          className="w-48 min-w-0"
        />
        <Button type="submit" variant="primary" size="sm" disabled={!name.trim()}>
          {t('home.savedViews.confirm')}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setName(null)}>
          {t('home.savedViews.cancel')}
        </Button>
      </form>
    )
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1.5">
      {activeView && changed && activeViewId !== null && (
        <Button
          size="sm"
          data-testid="home-view-update"
          icon={<Bookmark size={12} aria-hidden />}
          title={t('home.savedViews.updateTitle', { name: activeView.name })}
          onClick={() => updateView(activeViewId)}
        >
          {t('home.savedViews.update')}
        </Button>
      )}
      {(activeView === null || changed) && (
        <Button
          size="sm"
          variant={activeView ? 'ghost' : 'secondary'}
          data-testid="home-view-save"
          icon={<BookmarkPlus size={12} aria-hidden />}
          title={t('home.savedViews.saveTitle')}
          onClick={() => setName(suggestViewName(filter, statusLabel))}
        >
          {t('home.savedViews.save')}
        </Button>
      )}
      {activeView && activeViewId !== null && (
        <Button
          size="sm"
          variant="ghost"
          data-testid="home-view-delete"
          icon={<Trash2 size={12} aria-hidden />}
          title={t('home.savedViews.deleteTitle', { name: activeView.name })}
          onClick={() => deleteView(activeViewId)}
        >
          {t('home.savedViews.delete')}
        </Button>
      )}
    </div>
  )
}

/** "No open pull requests match. Without Status: Checks failing there would be 3." */
function NoMatch({
  pullRequests,
  identity,
  statusLabel,
}: {
  pullRequests: readonly PullRequestSummary[]
  identity: ViewerIdentity
  statusLabel: (status: StatusId) => string
}): React.JSX.Element {
  const { t } = useTranslation()
  const filter = useHomeFilterStore((s) => s.filter)
  const setFilter = useHomeFilterStore((s) => s.setFilter)
  const clear = useHomeFilterStore((s) => s.clear)
  const hint = bestWithoutHint(pullRequests, filter, identity)
  const describe = (drop: DropCandidate): { what: string; value: string } => {
    if (drop.kind === 'text') {
      const text = t('home.filterResults.textWhat', { text: drop.text })
      return { what: text, value: text }
    }
    const value =
      drop.chip.facet === 'status' && isStatusId(drop.chip.key) ? statusLabel(drop.chip.key) : drop.chip.label
    return {
      what: t('home.filterResults.chipWhat', { facet: t(`home.filterBar.facets.${drop.chip.facet}`), value }),
      value,
    }
  }
  const described = hint ? describe(hint.drop) : null
  return (
    <div
      data-testid="home-filter-empty"
      className="flex flex-col items-center gap-2 rounded-lg border border-border bg-panel px-4 py-6 text-center"
    >
      <Funnel size={20} aria-hidden className="text-muted" />
      <p className="text-sm font-medium text-text">{t('home.filterResults.emptyTitle')}</p>
      <p className="text-xs text-muted" data-testid="home-filter-without">
        {hint && described ? (
          <Trans
            i18nKey="home.filterResults.without"
            count={hint.count}
            values={{ count: hint.count }}
            components={{ what: transText(described.what, 'font-semibold text-text') }}
          />
        ) : (
          t('home.filterResults.noSingleHint')
        )}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-1.5">
        {hint && described && (
          <Button
            size="sm"
            data-testid="home-filter-drop"
            onClick={() => setFilter(withoutCandidate(filter, hint.drop))}
          >
            {t('home.filterResults.remove', { what: described.value })}
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={clear}>
          {t('home.filterResults.clearFilters')}
        </Button>
      </div>
    </div>
  )
}

interface HomeFilterResultsProps {
  pullRequests: readonly PullRequestSummary[]
  matched: readonly PullRequestSummary[]
  identity: ViewerIdentity
  statusLabel: (status: StatusId) => string
  onOpen: (pr: PullRequestSummary) => void
}

/**
 * What Home shows while a filter is active, instead of Features and
 * Repositories: how many PRs match and why, the view actions, the matches
 * grouped by repository (rows open the review), or why nothing matches.
 */
export function HomeFilterResults({
  pullRequests,
  matched,
  identity,
  statusLabel,
  onOpen,
}: HomeFilterResultsProps): React.JSX.Element {
  const { t } = useTranslation()
  const filter = useHomeFilterStore((s) => s.filter)
  const clear = useHomeFilterStore((s) => s.clear)
  const sentence = useSummarySentence(filter, matched, statusLabel)
  const groups = groupByRepo([...matched])
  return (
    <section
      aria-label={t('home.filterResults.ariaLabel')}
      data-testid="home-filter-results"
      className="flex min-w-0 flex-col gap-2.5"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <h2 className="shrink-0 text-sm font-semibold text-text" data-testid="home-filter-count">
          {t('home.filterResults.count', { count: matched.length })}
        </h2>
        {sentence && (
          <p className="min-w-0 flex-1 basis-48 text-xs text-muted" data-testid="home-filter-sentence">
            {sentence}
          </p>
        )}
        <div className="ml-auto">
          <ViewActions statusLabel={statusLabel} />
        </div>
      </div>
      {matched.length === 0 ? (
        <NoMatch pullRequests={pullRequests} identity={identity} statusLabel={statusLabel} />
      ) : (
        groups.map((group) => {
          return (
            <section
              key={repoKey(group.repo)}
              aria-label={group.repo.fullName}
              data-testid="home-filter-group"
              data-repo={group.repo.name}
              className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-panel"
            >
              <div className="flex min-w-0 items-center gap-2 bg-border/30 px-3 py-1.5">
                <ScmProviderIcon provider={group.repo.provider} size={12} />
                <span className="min-w-0 truncate text-xs font-semibold text-text">{group.repo.name}</span>
                <span className="min-w-0 truncate text-[11px] text-muted">{repoOwnerLabel(group.repo)}</span>
                <span className="ml-auto shrink-0 tabular-nums text-[11px] text-muted">
                  {group.pullRequests.length}
                </span>
              </div>
              {group.pullRequests.map((pr) => (
                <ResultRow key={prKey(pr.repo, pr.number)} pr={pr} onOpen={onOpen} />
              ))}
            </section>
          )
        })
      )}
      <div className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2">
        <span className="min-w-0 flex-1 text-xs text-muted">{t('home.filterResults.hiddenNote')}</span>
        <Button variant="ghost" size="sm" data-testid="home-filter-clear-bottom" onClick={clear}>
          {t('home.filterResults.clearFilters')}
        </Button>
      </div>
    </section>
  )
}
