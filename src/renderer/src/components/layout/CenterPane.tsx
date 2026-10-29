import { useEffect, useMemo, useState } from 'react'
import {
  CircleAlert,
  FileDiff,
  GitPullRequest,
  MessageSquare,
  MessagesSquare,
  type LucideIcon,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAppStore, type CenterTab } from '../../stores/app-store'
import { useRovingTabs, type RovingTabProps } from '../../hooks/use-roving-tabs'
import { usePullRequestDetail } from '../../hooks/use-pull-request-detail'
import { useCommentThreads } from '../../hooks/use-comment-threads'
import { usePullRequestFiles } from '../../hooks/use-pull-request-files'
import { ThreadActionsContext, type ThreadActions } from '../../hooks/thread-actions'
import { PrHeader } from '../pr-detail/PrHeader'
import { ConversationTab } from '../pr-detail/ConversationTab'
import { FilesTab } from '../pr-detail/FilesTab'
import { CommentsTab } from '../pr-detail/CommentsTab'
import { EmptyState } from '../ui/EmptyState'
import { isThreadOpen, prKey, type RepoRef } from '../../../../shared/scm'
import type { PullRequestDetail } from '../../../../shared/types'

const CENTER_TABS: readonly CenterTab[] = ['conversation', 'files', 'comments']

/**
 * One review tab: `useRovingTabs` gives it its role, selection and keys.
 * Compact (narrow bar): the icon and the count only; the full label stays the
 * accessible name and the tooltip.
 */
function ReviewTab({
  tabProps,
  icon: Icon,
  label,
  count,
  compact,
}: {
  tabProps: RovingTabProps
  icon: LucideIcon
  label: string
  count?: number | null
  compact: boolean
}): React.JSX.Element {
  const selected = tabProps['aria-selected']
  return (
    <button
      type="button"
      {...tabProps}
      aria-label={compact ? label : undefined}
      title={compact ? label : undefined}
      className={`flex h-full shrink-0 items-center gap-1.5 border-b-2 text-sm font-medium whitespace-nowrap transition-colors duration-150 ${
        compact ? 'px-2' : 'px-3'
      } ${selected ? 'border-accent text-text' : 'border-transparent text-muted hover:text-text'}`}
    >
      {compact ? (
        <>
          <Icon size={15} aria-hidden />
          {count !== undefined && count !== null && <span aria-hidden>{count}</span>}
        </>
      ) : (
        label
      )}
    </button>
  )
}

export function CenterPane(): React.JSX.Element {
  const { t } = useTranslation()
  const selectedPr = useAppStore((s) => s.selectedPr)

  if (!selectedPr) {
    return (
      <section className="flex flex-1 flex-col bg-bg">
        <EmptyState
          icon={GitPullRequest}
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
        <EmptyState icon={CircleAlert} title={t('layout.center.loadFailed')} hint={error} />
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
        <EmptyState
          loading
          title={t('layout.center.loading')}
          hint={`${repo.fullName}#${number}`}
        />
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
  const openWalkthroughFocus = useAppStore((s) => s.openWalkthroughFocus)
  const walkthroughFocus = useAppStore((s) => s.walkthroughFocus)

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

  // The activity inbox opened this PR again (`openPrAt`): a comment may have
  // arrived after the threads were fetched. The first value is the mount's
  // own fetch, so only a later change reloads.
  const threadsRefreshToken = useAppStore((s) => s.threadsRefreshToken)
  const [seenRefreshToken] = useState(threadsRefreshToken)
  useEffect(() => {
    if (threadsRefreshToken === seenRefreshToken) return
    void (async () => {
      await reloadThreads()
    })()
  }, [threadsRefreshToken, seenRefreshToken, reloadThreads])

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
  const tabs = useRovingTabs<CenterTab>({
    keys: CENTER_TABS,
    value: centerTab,
    onChange: setCenterTab,
    tabId: (key) => `review-tab-${key}`,
  })

  return (
    <ThreadActionsContext.Provider value={actions}>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {/* The full-screen walkthrough hides the PR bar: the title bar names the PR. */}
        {!walkthroughFocus && (
          <PrHeader
            pr={detail}
            onWalkthrough={openWalkthroughFocus}
            tabs={(compact) => (
              <div
                role="tablist"
                aria-label={t('layout.center.tabsLabel')}
                className="flex h-full gap-1"
              >
                <ReviewTab
                  tabProps={tabs.tabProps('conversation')}
                  icon={MessageSquare}
                  label={t('layout.center.tabs.conversation')}
                  compact={compact}
                />
                <ReviewTab
                  tabProps={tabs.tabProps('files')}
                  icon={FileDiff}
                  label={
                    detail.changedFiles === null
                      ? t('layout.center.tabs.files')
                      : t('layout.center.tabs.filesWithCount', { count: detail.changedFiles })
                  }
                  count={detail.changedFiles}
                  compact={compact}
                />
                <ReviewTab
                  tabProps={tabs.tabProps('comments')}
                  icon={MessagesSquare}
                  label={
                    threadsLoading && threads.length === 0
                      ? t('layout.center.tabs.comments')
                      : t('layout.center.tabs.commentsOpen', { count: openThreads })
                  }
                  count={threadsLoading && threads.length === 0 ? null : openThreads}
                  compact={compact}
                />
              </div>
            )}
          />
        )}
        <div
          // The tab's panel; the full-screen walkthrough hides the tabs, so then it is a plain box.
          {...(walkthroughFocus ? {} : tabs.panelProps(centerTab))}
          className="min-h-0 flex-1 overflow-hidden"
        >
          {centerTab === 'conversation' ? (
            <ConversationTab
              pr={detail}
              threads={threads}
              loading={threadsLoading}
              error={threadsError}
              reload={reloadThreads}
              files={filesLoading ? null : files}
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
              reload={reloadThreads}
            />
          )}
        </div>
      </div>
    </ThreadActionsContext.Provider>
  )
}
