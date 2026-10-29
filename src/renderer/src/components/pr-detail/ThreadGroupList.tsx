import { useTranslation } from 'react-i18next'
import { FileCode, MessagesSquare } from 'lucide-react'
import type { DiffFile } from '../../../../shared/types'
import type { ThreadGroup } from '../../lib/thread-groups'
import { fileGroupTag, type FileAtHead } from '../../lib/thread-origin'
import { useThreadActions } from '../../hooks/thread-actions'
import { useFileLines } from '../../hooks/use-file-content'
import { useAppStore } from '../../stores/app-store'
import { Badge } from '../ui/Badge'
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
  const openLineThread = useAppStore((s) => s.openLineThread)

  return (
    <>
      {groups.map((group) => {
        const inDiff = group.path !== null && Boolean(files?.some((f) => f.path === group.path))
        return (
          <ThreadGroupSection key={group.path ?? '(general)'} group={group} files={files}>
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
          </ThreadGroupSection>
        )
      })}
    </>
  )
}

/**
 * One group: its heading (path, count, and a tag when the file is not in the
 * diff: "removed in push N" / "removed in a later push" when it no longer
 * exists at head and a thread knows where it was written, else "not in the
 * diff") and its threads. A file outside the diff is looked up at head once
 * (shared file cache, the same read the excerpts' "Latest" uses).
 */
function ThreadGroupSection({
  group,
  files,
  children,
}: {
  group: ThreadGroup
  files: DiffFile[] | null
  children: React.ReactNode
}): React.JSX.Element {
  const { t } = useTranslation()
  const actions = useThreadActions()
  const diffFile = group.path !== null ? files?.find((f) => f.path === group.path) : undefined
  const inDiff = Boolean(diffFile)
  const probe =
    group.path !== null &&
    files !== null &&
    !inDiff &&
    group.threads.some((thread) => thread.origin)
  const head = useFileLines(
    probe && group.path !== null
      ? {
          repo: actions.repo,
          number: actions.number,
          headSha: actions.headSha,
          path: group.path,
          side: 'head',
        }
      : null,
  )
  const atHead: FileAtHead =
    diffFile?.status === 'removed'
      ? 'missing'
      : head.status === 'error'
        ? head.code === 'NOT_FOUND'
          ? 'missing'
          : 'unknown'
        : head.status === 'ready' || head.status === 'unavailable'
          ? 'present'
          : 'unknown'
  const checking = probe && (head.status === 'loading' || head.status === 'idle')
  const tag =
    group.path === null || files === null || checking
      ? null
      : fileGroupTag(group.threads, inDiff, atHead)

  return (
    <section
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
        {tag?.kind === 'removed' && (
          <Badge
            tone="outline"
            size="sm"
            className="shrink-0 whitespace-nowrap"
            title={t('comments.tab.removedTitle')}
            data-testid="group-removed"
          >
            {tag.push !== null
              ? t('comments.tab.removedInPush', { push: tag.push })
              : t('comments.tab.removed')}
          </Badge>
        )}
        {tag?.kind === 'notInDiff' && (
          <span className="shrink-0 text-warning" title={t('comments.tab.notInDiffTitle')}>
            · {t('comments.tab.notInDiff')}
          </span>
        )}
      </h3>
      {children}
    </section>
  )
}
