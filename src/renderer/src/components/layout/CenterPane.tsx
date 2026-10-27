import { useMemo, type ReactNode } from 'react'
import { ChevronRight, Home } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '../../stores/app-store'
import { usePullRequestDetail } from '../../hooks/use-pull-request-detail'
import { useCommentThreads } from '../../hooks/use-comment-threads'
import { usePullRequestFiles } from '../../hooks/use-pull-request-files'
import { ThreadActionsContext, type ThreadActions } from '../../hooks/thread-actions'
import { PrHeader } from '../pr-detail/PrHeader'
import { ConversationTab } from '../pr-detail/ConversationTab'
import { FilesTab } from '../pr-detail/FilesTab'
import { CommentsTab } from '../pr-detail/CommentsTab'
import { EmptyState } from '../ui/EmptyState'
import { ScmProviderIcon } from '../ui/ScmProviderIcon'
import { isThreadOpen, prKey, repoKey, type RepoRef } from '../../../../shared/scm'
import type { PullRequestDetail, PullRequestSummary } from '../../../../shared/types'
import { useDashboardStore } from '../../stores/dashboard-store'
import { useDashboard, useViewerIdentity } from '../../hooks/use-dashboard'
import { buildFeatureGroups } from '../../lib/dashboard'

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`border-b-2 px-3 py-2 text-sm font-medium transition-colors duration-150 ${
        active ? 'border-accent text-text' : 'border-transparent text-muted hover:text-text'
      }`}
    >
      {children}
    </button>
  )
}

/**
 * Slim "Home › repo/feature › #n" trail above the PR: the way back to the
 * dashboard page the PR was opened from (`homeRoute` is kept while the
 * review is on screen). The crumb for the page is only shown when the PR
 * belongs to it, so a PR picked from the sidebar does not claim a repo page
 * it never came from.
 */
function ReviewBreadcrumb({ pr }: { pr: PullRequestSummary }): React.JSX.Element {
  const { t } = useTranslation()
  const route = useAppStore((s) => s.homeRoute)
  const goHome = useAppStore((s) => s.goHome)
  const navigateHome = useAppStore((s) => s.navigateHome)
  const { pullRequests } = useDashboard()
  const featureNames = useDashboardStore((s) => s.featureNames)
  const identity = useViewerIdentity()

  let pageCrumb: { label: ReactNode; text: string; onClick: () => void } | null = null
  if (route.kind === 'repo' && route.repoKey === repoKey(pr.repo)) {
    pageCrumb = {
      label: (
        <span className="inline-flex min-w-0 items-center gap-1">
          <ScmProviderIcon provider={pr.repo.provider} size={11} />
          <span className="truncate">{pr.repo.fullName}</span>
        </span>
      ),
      text: pr.repo.fullName,
      onClick: () => navigateHome(route),
    }
  } else if (route.kind === 'feature') {
    const key = prKey(pr.repo, pr.number)
    const group = buildFeatureGroups(pullRequests ?? [], featureNames, identity).find(
      (item) =>
        item.key === route.featureKey &&
        item.repos.some((repo) => repo.pullRequests.some((p) => prKey(p.repo, p.number) === key)),
    )
    if (group) {
      const text = t('review.feature', { name: group.name })
      pageCrumb = { label: text, text, onClick: () => navigateHome(route) }
    }
  }

  return (
    <nav
      aria-label={t('review.breadcrumbAriaLabel')}
      data-testid="review-breadcrumb"
      className="flex min-w-0 shrink-0 items-center gap-1 border-b border-border bg-panel/60 px-3 py-1 text-xs"
    >
      <button
        type="button"
        onClick={goHome}
        title={t('review.backToHome')}
        className="inline-flex shrink-0 items-center gap-1 rounded px-1 py-0.5 text-muted transition-colors duration-150 hover:text-text"
      >
        <Home size={12} aria-hidden />
        {t('review.home')}
      </button>
      {pageCrumb && (
        <>
          <ChevronRight size={11} className="shrink-0 text-muted/60" aria-hidden />
          <button
            type="button"
            onClick={pageCrumb.onClick}
            title={pageCrumb.text}
            className="min-w-0 truncate rounded px-1 py-0.5 text-muted transition-colors duration-150 hover:text-text"
          >
            {pageCrumb.label}
          </button>
        </>
      )}
      <ChevronRight size={11} className="shrink-0 text-muted/60" aria-hidden />
      <span className="shrink-0 font-mono text-text/80" aria-current="page">
        #{pr.number}
      </span>
    </nav>
  )
}

export function CenterPane(): React.JSX.Element {
  const { t } = useTranslation()
  const selectedPr = useAppStore((s) => s.selectedPr)

  if (!selectedPr) {
    return (
      <section className="flex flex-1 flex-col bg-bg">
        <EmptyState
          title={t('layout.center.choosePrTitle')}
          hint={t('layout.center.choosePrHint')}
        />
      </section>
    )
  }

  // Remounted per PR: every per-PR hook starts clean, and nothing is asked of
  // main until there IS a PR (no placeholder repo, no "invalid payload").
  return (
    <section className="flex min-w-0 flex-1 flex-col overflow-hidden bg-bg">
      <ReviewBreadcrumb pr={selectedPr} />
      <PrDetailPane
        key={prKey(selectedPr.repo, selectedPr.number)}
        repo={selectedPr.repo}
        number={selectedPr.number}
      />
    </section>
  )
}

function PrDetailPane({ repo, number }: { repo: RepoRef; number: number }): React.JSX.Element {
  const { t } = useTranslation()
  const { detail, error } = usePullRequestDetail(repo, number)

  if (error) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <EmptyState title={t('layout.center.loadFailed')} hint={error} />
      </div>
    )
  }

  // A reload of the SAME PR (after a retarget) keeps the old detail on screen;
  // only a detail of another PR (or none yet) shows the loading state.
  const detailIsCurrent =
    detail !== null && prKey(detail.repo, detail.number) === prKey(repo, number)
  if (!detail || !detailIsCurrent) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <EmptyState title={t('layout.center.loading')} hint={`${repo.fullName}#${number}`} />
      </div>
    )
  }

  // Keyed on the base: a retarget changes the diff, so threads and files refetch.
  return <PrDetailBody key={detail.baseRef} detail={detail} />
}

function PrDetailBody({ detail }: { detail: PullRequestDetail }): React.JSX.Element {
  const { t } = useTranslation()
  const { repo, number } = detail
  const centerTab = useAppStore((s) => s.centerTab)
  const setCenterTab = useAppStore((s) => s.setCenterTab)

  // Threads and files of the PR: asked once here and shared by the
  // Conversation, Files and Comments tabs.
  const {
    threads,
    loading: threadsLoading,
    error: threadsError,
    reload: reloadThreads,
    applyThreadStatus,
  } = useCommentThreads(repo, number)
  const { files, loading: filesLoading, error: filesError } = usePullRequestFiles(repo, number)

  const headSha = detail.headSha
  const actions: ThreadActions = useMemo(() => {
    const previousPaths = new Map(
      files.filter((f) => f.previousPath).map((f) => [f.path, f.previousPath!] as const),
    )
    return {
      repo,
      number,
      headSha,
      previousPathOf: (path) => previousPaths.get(path),
      reply: async (threadId, bodyMarkdown) => {
        await window.minerva.scm.postComment({ repo, number, bodyMarkdown, threadId })
        await reloadThreads()
      },
      setStatus: async (threadId, status) => {
        const updated = await window.minerva.scm.setThreadStatus({ repo, number, threadId, status })
        applyThreadStatus(updated)
        return updated
      },
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `repo` is fixed for this mount (keyed by PR).
  }, [number, headSha, files, reloadThreads, applyThreadStatus])

  const openThreads = threads.filter((thread) => isThreadOpen(thread.status)).length

  return (
    <ThreadActionsContext.Provider value={actions}>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <PrHeader pr={detail} />
        <nav className="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-3">
          <TabButton
            active={centerTab === 'conversation'}
            onClick={() => setCenterTab('conversation')}
          >
            {t('layout.center.tabs.conversation')}
          </TabButton>
          <TabButton active={centerTab === 'files'} onClick={() => setCenterTab('files')}>
            {detail.changedFiles === null
              ? t('layout.center.tabs.files')
              : t('layout.center.tabs.filesWithCount', { count: detail.changedFiles })}
          </TabButton>
          <TabButton active={centerTab === 'comments'} onClick={() => setCenterTab('comments')}>
            <span title={t('layout.center.openThreads', { count: openThreads })}>
              {threadsLoading && threads.length === 0
                ? t('layout.center.tabs.comments')
                : t('layout.center.tabs.commentsWithCount', { count: openThreads })}
            </span>
          </TabButton>
        </nav>
        <div className="min-h-0 flex-1 overflow-hidden">
          {centerTab === 'conversation' ? (
            <ConversationTab
              pr={detail}
              threads={threads}
              loading={threadsLoading}
              error={threadsError}
              reload={reloadThreads}
            />
          ) : centerTab === 'files' ? (
            <FilesTab
              repo={detail.repo}
              number={detail.number}
              files={files}
              loading={filesLoading}
              error={filesError}
              filesTruncated={detail.filesTruncated === true}
              changedFiles={detail.changedFiles}
              threads={threads}
              reloadThreads={reloadThreads}
            />
          ) : (
            <CommentsTab
              threads={threads}
              loading={threadsLoading}
              error={threadsError}
              files={filesLoading ? null : files}
            />
          )}
        </div>
      </div>
    </ThreadActionsContext.Provider>
  )
}
