import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { FileCode, MessagesSquare } from 'lucide-react'
import type { DiffFile } from '../../../../shared/types'
import type { ThreadGroup } from '../../lib/thread-groups'
import { useAppStore } from '../../stores/app-store'
import { CountBadge } from '../ui/CountBadge'
import { ThreadCard } from './ThreadCard'

interface ThreadGroupListProps {
  groups: ThreadGroup[]
  /** Files of the PR (`null` while loading): a thread can only jump to a file the diff lists. */
  files: DiffFile[] | null
  /** The focused thread (opened and ringed), e.g. arriving from the activity inbox. */
  highlightedThreadId?: string | null
}

/**
 * Threads grouped by file ("General" first), each line thread with the code
 * it points at and a `path:line` link to that line in the Files tab. Shared
 * by the Conversation and Comments tabs so both read the same way.
 */
export function ThreadGroupList({
  groups,
  files,
  highlightedThreadId = null,
}: ThreadGroupListProps): React.JSX.Element {
  const { t } = useTranslation()
  const openLineThread = useAppStore((s) => s.openLineThread)
  const filePaths = useMemo(() => new Set(files?.map((f) => f.path) ?? []), [files])

  return (
    <>
      {groups.map((group) => {
        const inDiff = group.path !== null && filePaths.has(group.path)
        return (
          <section
            key={group.path ?? '(general)'}
            aria-label={group.path ?? t('comments.tab.general')}
            data-thread-group={group.path ?? 'general'}
            className="flex min-w-0 flex-col gap-2"
          >
            <h3 className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-muted">
              {group.path === null ? (
                <MessagesSquare size={13} className="shrink-0" aria-hidden />
              ) : (
                <FileCode size={13} className="shrink-0" aria-hidden />
              )}
              <span
                className={`truncate font-semibold text-text ${group.path === null ? '' : 'font-mono'}`}
                title={group.path ?? undefined}
              >
                {group.path ?? t('comments.tab.general')}
              </span>
              <CountBadge count={group.threads.length} tone="neutral" />
              {group.path !== null && files !== null && !inDiff && (
                <span className="shrink-0 text-warning" title={t('comments.tab.notInDiffTitle')}>
                  · {t('comments.tab.notInDiff')}
                </span>
              )}
            </h3>
            {group.threads.map((thread) => (
              <ThreadCard
                key={thread.id}
                thread={thread}
                showExcerpt
                highlighted={thread.id === highlightedThreadId}
                onNavigateToLine={
                  thread.path && inDiff
                    ? () => openLineThread(thread.path!, thread.line ?? 0, thread.id)
                    : undefined
                }
              />
            ))}
          </section>
        )
      })}
    </>
  )
}
