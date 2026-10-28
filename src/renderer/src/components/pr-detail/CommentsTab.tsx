import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CommentThread, DiffFile } from '../../../../shared/types'
import { useLayoutTier } from '../../hooks/use-layout-tier'
import { threadStatusLabel } from '../../lib/scm-labels'
import {
  countThreadsByFilter,
  filterThreads,
  groupThreadsByFile,
  THREAD_STATUS_ORDER,
  type ThreadFilter,
} from '../../lib/thread-groups'
import { Chip } from '../ui/Chip'
import { InlineError } from '../ui/InlineError'
import { Spinner } from '../ui/Spinner'
import { ThreadGroupList } from './ThreadGroupList'

interface CommentsTabProps {
  threads: CommentThread[]
  loading: boolean
  error: string | null
  /** Files of the PR (`null` while loading): a thread can only jump to a file the diff lists. */
  files: DiffFile[] | null
  /** Asks main for the threads again (Retry after a load error). */
  reload: () => Promise<CommentThread[]>
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
  reload,
}: CommentsTabProps): React.JSX.Element {
  const { t } = useTranslation()
  const [filter, setFilter] = useState<ThreadFilter>('open')
  const tier = useLayoutTier()

  const counts = useMemo(() => countThreadsByFilter(threads), [threads])
  const groups = useMemo(
    () => groupThreadsByFile(filterThreads(threads, filter)),
    [threads, filter],
  )

  const filters: Array<{ value: ThreadFilter; label: string }> = [
    { value: 'open', label: t('comments.tab.filterOpen') },
    { value: 'all', label: t('comments.tab.filterAll') },
    ...THREAD_STATUS_ORDER.filter((status) => counts[status] > 0).map((status) => ({
      value: status as ThreadFilter,
      label: threadStatusLabel(status, t),
    })),
  ]

  return (
    <div
      className={`mx-auto flex h-full w-full max-w-[960px] flex-col gap-3 overflow-y-auto ${
        tier.w === 'sm' ? 'p-2' : 'p-4'
      }`}
    >
      <div
        role="group"
        aria-label={t('comments.tab.filterGroup')}
        className="flex flex-wrap items-center gap-1.5"
      >
        {filters.map((option) => (
          <Chip
            key={option.value}
            selected={filter === option.value}
            data-filter={option.value}
            onClick={() => setFilter(option.value)}
            count={counts[option.value]}
            countTestId="filter-count"
          >
            {option.label}
          </Chip>
        ))}
      </div>

      {error && (
        <InlineError
          message={t('comments.tab.loadError', { error })}
          onRetry={() => void reload()}
        />
      )}
      {!error && loading && threads.length === 0 && (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Spinner />
          {t('comments.tab.loading')}
        </p>
      )}
      {!error && !loading && groups.length === 0 && (
        <p className="text-sm text-muted">
          {threads.length === 0 ? t('comments.tab.empty') : t('comments.tab.noMatch')}
        </p>
      )}

      <ThreadGroupList groups={groups} files={files} />
    </div>
  )
}
