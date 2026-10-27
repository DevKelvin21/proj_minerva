import { useMemo, type ReactNode } from 'react'
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
import { isThreadOpen, prKey, type RepoRef } from '../../../../shared/scm'
import type { PullRequestDetail } from '../../../../shared/types'

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

export function CenterPane(): React.JSX.Element {
  const selectedPr = useAppStore((s) => s.selectedPr)

  if (!selectedPr) {
    return (
      <section className="flex flex-1 flex-col bg-bg">
        <EmptyState
          title="Elige un Pull Request"
          hint="Selecciona un PR de la lista de la izquierda para ver su conversación y sus archivos."
        />
      </section>
    )
  }

  // Remounted per PR: every per-PR hook starts clean, and nothing is asked of
  // main until there IS a PR (no placeholder repo, no "invalid payload").
  return (
    <PrDetailPane
      key={prKey(selectedPr.repo, selectedPr.number)}
      repo={selectedPr.repo}
      number={selectedPr.number}
    />
  )
}

function PrDetailPane({ repo, number }: { repo: RepoRef; number: number }): React.JSX.Element {
  const { detail, error } = usePullRequestDetail(repo, number)

  if (error) {
    return (
      <section className="flex flex-1 flex-col bg-bg">
        <EmptyState title="No se pudo cargar el PR" hint={error} />
      </section>
    )
  }

  // A reload of the SAME PR (after a retarget) keeps the old detail on screen;
  // only a detail of another PR (or none yet) shows the loading state.
  const detailIsCurrent =
    detail !== null && prKey(detail.repo, detail.number) === prKey(repo, number)
  if (!detail || !detailIsCurrent) {
    return (
      <section className="flex flex-1 flex-col bg-bg">
        <EmptyState title="Cargando PR…" hint={`${repo.fullName}#${number}`} />
      </section>
    )
  }

  // Keyed on the base: a retarget changes the diff, so threads and files refetch.
  return <PrDetailBody key={detail.baseRef} detail={detail} />
}

function PrDetailBody({ detail }: { detail: PullRequestDetail }): React.JSX.Element {
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

  const openThreads = threads.filter((t) => isThreadOpen(t.status)).length

  return (
    <ThreadActionsContext.Provider value={actions}>
      <section className="flex min-w-0 flex-1 flex-col overflow-hidden bg-bg">
        <PrHeader pr={detail} />
        <nav className="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-3">
          <TabButton
            active={centerTab === 'conversation'}
            onClick={() => setCenterTab('conversation')}
          >
            Conversación
          </TabButton>
          <TabButton active={centerTab === 'files'} onClick={() => setCenterTab('files')}>
            {detail.changedFiles === null ? 'Archivos' : `Archivos (${detail.changedFiles})`}
          </TabButton>
          <TabButton active={centerTab === 'comments'} onClick={() => setCenterTab('comments')}>
            <span title={`${openThreads} open ${openThreads === 1 ? 'thread' : 'threads'}`}>
              Comments{threadsLoading && threads.length === 0 ? '' : ` (${openThreads})`}
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
      </section>
    </ThreadActionsContext.Provider>
  )
}
