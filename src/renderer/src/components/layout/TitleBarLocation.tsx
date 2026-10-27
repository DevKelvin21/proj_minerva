import { ChevronDown, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { prKey, repoKey } from '../../../../shared/scm'
import type { PullRequestSummary } from '../../../../shared/types'
import { useAppStore } from '../../stores/app-store'
import { useDashboard, useViewerIdentity } from '../../hooks/use-dashboard'
import { useDashboardStore } from '../../stores/dashboard-store'
import { buildFeatureGroups } from '../../lib/dashboard'
import { ScmProviderIcon } from '../ui/ScmProviderIcon'

const STATE_TONE: Record<'open' | 'draft' | 'merged' | 'closed', string> = {
  open: 'bg-success/15 text-success',
  draft: 'bg-border/60 text-muted',
  merged: 'bg-merged/15 text-merged',
  closed: 'bg-danger/15 text-danger',
}

/** Last segment of a repo's full name: "orders-api" for "contoso/Platform/orders-api". */
function shortRepoName(fullName: string): string {
  return fullName.slice(fullName.lastIndexOf('/') + 1)
}

/**
 * "Where you are" in the title bar. On the review: "repo › #n Title [state]";
 * the first crumb goes back to the dashboard page the PR belongs to (the
 * feature page when the PR was opened from one of its groups, else its repo
 * page), and the title opens the command palette to switch PR. On home: the
 * app's name (the home pages carry their own trail under the bar).
 */
export function TitleBarLocation({ compact }: { compact: boolean }): React.JSX.Element {
  const mainView = useAppStore((s) => s.mainView)
  const selectedPr = useAppStore((s) => s.selectedPr)
  if (mainView === 'review' && selectedPr) {
    return <ReviewLocation pr={selectedPr} compact={compact} />
  }
  return (
    <span className="flex shrink-0 items-center gap-1.5 px-1 text-sm font-semibold text-text">
      <span aria-hidden>🦉</span>
      {!compact && 'Minerva'}
    </span>
  )
}

function ReviewLocation({
  pr,
  compact,
}: {
  pr: PullRequestSummary
  compact: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const route = useAppStore((s) => s.homeRoute)
  const navigateHome = useAppStore((s) => s.navigateHome)
  const openPalette = useAppStore((s) => s.openCommandPalette)
  const { pullRequests } = useDashboard()
  const featureNames = useDashboardStore((s) => s.featureNames)
  const identity = useViewerIdentity()

  let pageCrumb: { label: React.ReactNode; text: string; onClick: () => void }
  const feature =
    route.kind === 'feature'
      ? buildFeatureGroups(pullRequests ?? [], featureNames, identity).find(
          (item) =>
            item.key === route.featureKey &&
            item.repos.some((repo) =>
              repo.pullRequests.some((p) => prKey(p.repo, p.number) === prKey(pr.repo, pr.number)),
            ),
        )
      : undefined
  if (feature) {
    const text = t('review.feature', { name: feature.name })
    pageCrumb = { label: text, text, onClick: () => navigateHome(route) }
  } else {
    pageCrumb = {
      label: (
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <ScmProviderIcon provider={pr.repo.provider} size={12} />
          <span className="truncate">{shortRepoName(pr.repo.fullName)}</span>
        </span>
      ),
      text: pr.repo.fullName,
      onClick: () => navigateHome({ kind: 'repo', repoKey: repoKey(pr.repo) }),
    }
  }

  const state = pr.state === 'open' && pr.isDraft ? 'draft' : pr.state

  return (
    <nav
      aria-label={t('review.breadcrumbAriaLabel')}
      data-testid="review-breadcrumb"
      className="flex min-w-0 items-center gap-1 text-sm"
    >
      {!compact && (
        <>
          <button
            type="button"
            onClick={pageCrumb.onClick}
            title={pageCrumb.text}
            className="min-w-0 max-w-[220px] shrink truncate rounded-md px-1.5 py-1 text-muted transition-colors duration-150 hover:bg-border/60 hover:text-text"
          >
            {pageCrumb.label}
          </button>
          <ChevronRight size={14} className="shrink-0 text-muted/60" aria-hidden />
        </>
      )}
      <button
        type="button"
        onClick={openPalette}
        title={t('layout.titleBar.switchPr', { title: pr.title })}
        aria-current="page"
        className="flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-text transition-colors duration-150 hover:bg-border/60"
      >
        <span className="shrink-0 font-mono text-muted">#{pr.number}</span>
        <span className="min-w-0 truncate font-semibold">{pr.title}</span>
        {!compact && (
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold leading-none ${STATE_TONE[state]}`}
          >
            {t(`prList.state.${state}`)}
          </span>
        )}
        <ChevronDown size={14} className="shrink-0 text-muted" aria-hidden />
      </button>
    </nav>
  )
}
