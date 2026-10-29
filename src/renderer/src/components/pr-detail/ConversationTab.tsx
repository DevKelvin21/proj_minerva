import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '../../stores/app-store'
import { useLayoutTier } from '../../hooks/use-layout-tier'
import type { CommentThread, DiffFile, PullRequestDetail } from '../../../../shared/types'
import { groupThreadsByFile } from '../../lib/thread-groups'
import { Avatar } from '../ui/Avatar'
import { InlineError } from '../ui/InlineError'
import { Markdown } from '../ui/Markdown'
import { Spinner } from '../ui/Spinner'
import { CommentComposer } from './CommentComposer'
import { ThreadGroupList } from './ThreadGroupList'

interface ConversationTabProps {
  pr: PullRequestDetail
  threads: CommentThread[]
  loading: boolean
  error: string | null
  /** Vuelve a pedir los hilos a `main`; se pide una sola vez en `CenterPane` y se comparte con `FilesTab`. */
  reload: () => Promise<CommentThread[]>
  /** Files of the PR (`null` while loading): a thread can only jump to a file the diff lists. */
  files: DiffFile[] | null
}

/**
 * The PR read top to bottom: its description, the general-comment composer
 * right under it (the same composer as a line comment: Cmd/Ctrl+Enter posts),
 * then every thread grouped like the Comments tab (General first, then one
 * group per file, each line thread with the code it points at).
 */
export function ConversationTab({
  pr,
  threads,
  loading,
  error,
  reload,
  files,
}: ConversationTabProps): React.JSX.Element {
  const { t } = useTranslation()
  const expandedThreadId = useAppStore((s) => s.expandedThreadId)
  const pendingFocus = useAppStore((s) => s.pendingConversationFocus)
  const clearPendingFocus = useAppStore((s) => s.clearPendingConversationFocus)
  const tier = useLayoutTier()
  const groups = useMemo(() => groupThreadsByFile(threads), [threads])

  // Arriving from the activity inbox: scroll to the thread once it is listed.
  // Until then wait: the threads may still be (re)loading, and the effect
  // re-runs when they land. Opening another PR drops the request.
  useEffect(() => {
    if (!pendingFocus || !threads.some((thread) => thread.id === pendingFocus)) return
    const card = document.querySelector<HTMLElement>(
      `[data-thread-id="${CSS.escape(pendingFocus)}"]`,
    )
    card?.scrollIntoView({ block: 'center' })
    // The highlighted card is focusable (tabIndex -1): keyboard and screen readers land on it.
    card?.focus({ preventScroll: true })
    clearPendingFocus()
  }, [pendingFocus, threads, clearPendingFocus])

  async function postGeneralComment(bodyMarkdown: string): Promise<void> {
    await window.minerva.scm.postComment({ repo: pr.repo, number: pr.number, bodyMarkdown })
    await reload()
  }

  const hasDescription = pr.bodyMarkdown.trim().length > 0

  return (
    // Columna de lectura centrada (F16/T87): sin el `max-w`, en una ventana
    // completa de 1920px los comentarios se estiraban a líneas de 1200px+.
    // El padding se achica en el tier más angosto, donde cada px cuenta.
    <div
      className={`mx-auto flex h-full w-full max-w-[900px] flex-col gap-3 overflow-y-auto ${
        tier.w === 'sm' ? 'p-2' : 'p-4'
      }`}
    >
      <article className="min-w-0 rounded-md border border-border bg-panel p-3">
        <div className="mb-2 flex min-w-0 items-center gap-2 text-xs text-muted">
          <Avatar user={pr.author} size={18} />
          <span className="truncate font-medium text-text">
            {pr.author.displayName ?? pr.author.login}
          </span>
          <span className="shrink-0">{t('comments.conversation.openedThisPr')}</span>
        </div>
        {hasDescription ? (
          <Markdown content={pr.bodyMarkdown} />
        ) : (
          <p className="text-sm text-muted italic">{t('comments.conversation.noDescription')}</p>
        )}
      </article>

      <CommentComposer
        collapsible
        label={t('comments.conversation.generalCommentLabel')}
        placeholder={t('comments.conversation.placeholder')}
        submitLabel={t('comments.conversation.submit')}
        clearOnSubmit
        onSubmit={postGeneralComment}
      />

      {error && (
        <InlineError
          message={t('comments.conversation.loadError', { error })}
          onRetry={() => void reload()}
        />
      )}
      {!error && loading && threads.length === 0 && (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Spinner />
          {t('comments.conversation.loading')}
        </p>
      )}
      {!error && !(loading && threads.length === 0) && threads.length === 0 && (
        <p className="text-sm text-muted">{t('comments.conversation.empty')}</p>
      )}

      <ThreadGroupList groups={groups} files={files} highlightedThreadId={expandedThreadId} />
    </div>
  )
}
