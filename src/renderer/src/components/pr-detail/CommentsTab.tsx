import { useMemo, useState } from 'react'
import { FileCode, MessagesSquare } from 'lucide-react'
import type { CommentThread, DiffFile } from '../../../../shared/types'
import { useAppStore } from '../../stores/app-store'
import { useLayoutTier } from '../../hooks/use-layout-tier'
import { THREAD_STATUS_LABEL } from '../../lib/scm-labels'
import {
  countThreadsByFilter,
  filterThreads,
  groupThreadsByFile,
  THREAD_STATUS_ORDER,
  type ThreadFilter,
} from '../../lib/thread-groups'
import { ThreadCard } from './ThreadCard'

interface CommentsTabProps {
  threads: CommentThread[]
  loading: boolean
  error: string | null
  /** Files of the PR (`null` while loading): a thread can only jump to a file the diff lists. */
  files: DiffFile[] | null
}

/**
 * Every thread of the PR in one place, grouped by file ("General" first) and
 * filtered by status ("Open" by default). Each line thread shows the code it
 * points at, and its `path:line` jumps to that line in the Files tab
 * (revealing hidden lines when needed). Outdated and general threads are
 * included.
 */
export function CommentsTab({
  threads,
  loading,
  error,
  files,
}: CommentsTabProps): React.JSX.Element {
  const [filter, setFilter] = useState<ThreadFilter>('open')
  const openLineThread = useAppStore((s) => s.openLineThread)
  const tier = useLayoutTier()

  const counts = useMemo(() => countThreadsByFilter(threads), [threads])
  const groups = useMemo(
    () => groupThreadsByFile(filterThreads(threads, filter)),
    [threads, filter],
  )
  const filePaths = useMemo(() => new Set(files?.map((f) => f.path) ?? []), [files])

  const filters: Array<{ value: ThreadFilter; label: string }> = [
    { value: 'open', label: 'Open' },
    { value: 'all', label: 'All' },
    ...THREAD_STATUS_ORDER.filter((status) => counts[status] > 0).map((status) => ({
      value: status as ThreadFilter,
      label: THREAD_STATUS_LABEL[status],
    })),
  ]

  return (
    <div
      className={`mx-auto flex h-full w-full max-w-[960px] flex-col gap-3 overflow-y-auto ${
        tier.w === 'sm' ? 'p-2' : 'p-4'
      }`}
    >
      <div role="group" aria-label="Filter threads" className="flex flex-wrap items-center gap-1.5">
        {filters.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={filter === option.value}
            data-filter={option.value}
            onClick={() => setFilter(option.value)}
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
              filter === option.value
                ? 'border-accent bg-accent/15 text-text'
                : 'border-border text-muted hover:text-text'
            }`}
          >
            {option.label}
            <span data-testid="filter-count" className="tabular-nums text-muted">
              {counts[option.value]}
            </span>
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-danger">Could not load the comments: {error}</p>}
      {!error && loading && threads.length === 0 && (
        <p className="text-sm text-muted">Loading comments…</p>
      )}
      {!error && !loading && groups.length === 0 && (
        <p className="text-sm text-muted">
          {threads.length === 0
            ? 'No comments on this pull request yet.'
            : 'No threads match this filter.'}
        </p>
      )}

      {groups.map((group) => {
        const inDiff = group.path !== null && filePaths.has(group.path)
        return (
          <section
            key={group.path ?? '(general)'}
            aria-label={group.path ?? 'General'}
            data-thread-group={group.path ?? 'general'}
            className="flex min-w-0 flex-col gap-2"
          >
            <h3 className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-muted">
              {group.path === null ? (
                <MessagesSquare size={13} className="shrink-0" />
              ) : (
                <FileCode size={13} className="shrink-0" />
              )}
              <span className="truncate font-mono text-text" title={group.path ?? undefined}>
                {group.path ?? 'General'}
              </span>
              <span className="shrink-0 tabular-nums">({group.threads.length})</span>
              {group.path !== null && files !== null && !inDiff && (
                <span
                  className="shrink-0 text-warning"
                  title="The file is not in this pull request's file list (it may be capped or from an older push)"
                >
                  · not in the diff
                </span>
              )}
            </h3>
            {group.threads.map((thread) => (
              <ThreadCard
                key={thread.id}
                thread={thread}
                showExcerpt
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
    </div>
  )
}
