import { useMemo } from 'react'
import { CheckCheck, GitPullRequestArrow, LoaderCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ActivityItem } from '../../../../shared/activity'
import { useActivity, useOpenActivityItem } from '../../hooks/use-activity'
import { useLocale } from '../../i18n/use-locale'
import {
  fileName,
  groupActivity,
  matchesActivityQuery,
  type ActivityGroup,
} from '../../lib/activity'
import { formatAbsoluteTime, formatRelativeTime } from '../../lib/relative-time'
import { useAppStore } from '../../stores/app-store'
import { Avatar } from '../ui/Avatar'

/** The unread mark: a small dot, nothing louder. */
function UnreadDot({ unread }: { unread: boolean }): React.JSX.Element {
  return (
    <span
      aria-hidden
      className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${unread ? 'bg-accent' : 'bg-transparent'}`}
    />
  )
}

function ItemRow({
  item,
  onOpen,
}: {
  item: ActivityItem
  onOpen: (item: ActivityItem) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const { locale } = useLocale()
  const when = formatRelativeTime(item.at, locale)
  const tone = item.read ? 'opacity-60' : ''

  if (item.kind === 'orphan') {
    return (
      <button
        type="button"
        onClick={() => onOpen(item)}
        data-activity-item={item.id}
        data-read={item.read || undefined}
        className={`flex w-full items-start gap-1.5 px-3 py-1.5 text-left transition-colors duration-150 hover:bg-bg/60 ${tone}`}
      >
        <UnreadDot unread={!item.read} />
        <GitPullRequestArrow size={14} className="mt-0.5 shrink-0 text-warning" aria-hidden />
        <span className="min-w-0 flex-1 text-xs text-text">
          {t('layout.inbox.orphan', {
            parent: item.parent.number,
            base: item.parent.mergedInto,
          })}{' '}
          <span className="text-warning">
            {t('layout.inbox.retargetTo', { base: item.suggestedBase })}
          </span>
        </span>
      </button>
    )
  }

  const where =
    item.isLineThread && item.path
      ? fileName(item.path) + (item.line !== undefined ? ':' + item.line : '')
      : item.path
        ? fileName(item.path)
        : t('layout.inbox.conversation')
  const author = item.author.displayName ?? item.author.login
  const label = t(item.isReply ? 'layout.inbox.replyBy' : 'layout.inbox.commentBy', {
    author,
    where: item.path ?? t('layout.inbox.conversation'),
  })

  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      data-activity-item={item.id}
      data-read={item.read || undefined}
      aria-label={label}
      className={`flex w-full items-start gap-1.5 px-3 py-1.5 text-left transition-colors duration-150 hover:bg-bg/60 ${tone}`}
    >
      <UnreadDot unread={!item.read} />
      <Avatar user={item.author} size={16} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-baseline gap-1 text-[11px] text-muted">
          <span className="shrink-0 font-medium text-text">{author}</span>
          <span className="min-w-0 truncate font-mono" title={item.path}>
            {where}
          </span>
          <span className="ml-auto shrink-0" title={formatAbsoluteTime(item.at, locale)}>
            {when}
          </span>
        </span>
        {/* Plain text on purpose: main flattened it, and it is never Markdown here. */}
        <span className="line-clamp-2 break-words text-xs text-text">{item.excerpt}</span>
      </span>
    </button>
  )
}

function GroupSection({
  group,
  pending,
  onOpen,
  onMarkRead,
}: {
  group: ActivityGroup
  pending: boolean
  onOpen: (item: ActivityItem) => void
  onMarkRead: (group: ActivityGroup) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <section
      data-testid="inbox-group"
      data-pr-key={group.prKey}
      aria-label={t('layout.inbox.groupLabel', { number: group.number, title: group.prTitle })}
      className="border-b border-border/60 py-1"
    >
      <div className="flex min-w-0 items-start gap-1.5 px-3 pt-1.5">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium text-text" title={group.prTitle}>
            <span className="text-muted">#{group.number}</span> {group.prTitle}
          </span>
          <span className="block truncate text-[11px] text-muted">{group.repo.fullName}</span>
        </span>
        {pending && (
          <LoaderCircle size={13} className="mt-0.5 shrink-0 animate-spin text-muted" aria-hidden />
        )}
        {group.unreadCount > 0 && (
          <button
            type="button"
            onClick={() => onMarkRead(group)}
            aria-label={t('layout.inbox.markPrRead', { number: group.number })}
            title={t('layout.inbox.markPrRead', { number: group.number })}
            className="shrink-0 rounded p-0.5 text-muted transition-colors duration-150 hover:bg-border/60 hover:text-text"
          >
            <CheckCheck size={13} aria-hidden />
          </button>
        )}
      </div>
      <ul>
        {group.items.map((item) => (
          <li key={item.id}>
            <ItemRow item={item} onOpen={onOpen} />
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * The sidebar's Inbox: what happened on your PRs (new comments, orphaned
 * stacks), grouped by PR, newest first. Quiet on purpose: unread is a dot,
 * read rows fade. A row opens the PR at its thread and marks it read. The
 * search field above filters it locally.
 */
export function InboxView(): React.JSX.Element {
  const { t } = useTranslation()
  const searchQuery = useAppStore((s) => s.searchQuery)
  const { state, error, markRead } = useActivity()
  const { open, pendingKey, error: openError } = useOpenActivityItem()

  const groups = useMemo(
    () =>
      groupActivity(state?.items ?? []).filter((group) => matchesActivityQuery(group, searchQuery)),
    [state, searchQuery],
  )
  const unread = state?.unreadCount ?? 0

  return (
    <div data-testid="activity-inbox" className="flex min-h-0 flex-col pb-2">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <span className="min-w-0 flex-1 truncate text-xs text-muted">
          {unread > 0 ? t('layout.inbox.unread', { count: unread }) : t('layout.inbox.allRead')}
        </span>
        <button
          type="button"
          onClick={() => void markRead({ all: true })}
          disabled={unread === 0}
          className="shrink-0 rounded px-1.5 py-0.5 text-xs text-muted transition-colors duration-150 hover:text-text disabled:cursor-default disabled:opacity-50 disabled:hover:text-muted"
        >
          {t('layout.inbox.markAllRead')}
        </button>
      </div>
      {(error || openError) && (
        <p className="px-3 pt-2 text-xs text-danger">
          {openError ?? t('layout.inbox.loadFailed', { error })}
        </p>
      )}
      {state === null && !error && (
        <p className="p-4 text-sm text-muted">{t('layout.inbox.loading')}</p>
      )}
      {state !== null && groups.length === 0 && (
        <div className="flex flex-col gap-1 p-4">
          <p className="text-sm text-text">
            {searchQuery.trim()
              ? t('layout.inbox.noMatches', { query: searchQuery })
              : t('layout.inbox.emptyTitle')}
          </p>
          {!searchQuery.trim() && (
            <p className="text-xs text-muted">{t('layout.inbox.emptyHint')}</p>
          )}
        </div>
      )}
      {groups.map((group) => (
        <GroupSection
          key={group.prKey}
          group={group}
          pending={pendingKey === group.prKey}
          onOpen={open}
          onMarkRead={(target) =>
            void markRead({
              ids: target.items.filter((item) => !item.read).map((item) => item.id),
            })
          }
        />
      ))}
    </div>
  )
}
