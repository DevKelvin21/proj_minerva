import { useId, useMemo } from 'react'
import {
  CheckCheck,
  CircleCheck,
  CircleX,
  Eye,
  GitPullRequestArrow,
  MessageSquareWarning,
} from 'lucide-react'
import { Trans, useTranslation } from 'react-i18next'
import type { ActivityItem, ActivityReviewItem } from '../../../../shared/activity'
import { prKey } from '../../../../shared/scm'
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
import { Button } from '../ui/Button'
import { IconButton } from '../ui/IconButton'
import { InlineError } from '../ui/InlineError'
import { Spinner } from '../ui/Spinner'

/** The unread mark: the PR list's dot for unseen PRs; read rows keep its room so leads line up. */
function UnreadDot({ unread }: { unread: boolean }): React.JSX.Element {
  return (
    <span
      aria-hidden
      className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${unread ? 'bg-danger' : 'bg-transparent'}`}
    />
  )
}

/** Icon and tone of a vote: green approvals, warning for changes, danger for a rejection. */
function VoteIcon({ vote }: { vote: ActivityReviewItem['vote'] }): React.JSX.Element {
  if (vote === 'approved' || vote === 'approved_with_suggestions') {
    return <CircleCheck size={14} className="mt-0.5 shrink-0 text-success" aria-hidden />
  }
  if (vote === 'rejected') {
    return <CircleX size={14} className="mt-0.5 shrink-0 text-danger" aria-hidden />
  }
  return <MessageSquareWarning size={14} className="mt-0.5 shrink-0 text-warning" aria-hidden />
}

/** Relative time, the absolute one in the tooltip. */
function When({ at }: { at: string }): React.JSX.Element {
  const { locale } = useLocale()
  return (
    <span className="shrink-0" title={formatAbsoluteTime(at, locale)}>
      {formatRelativeTime(at, locale)}
    </span>
  )
}

interface RowShellProps {
  item: ActivityItem
  /** The item's PR is the one open in the review. */
  current: boolean
  lead: React.ReactNode
  title: React.ReactNode
  /** Before the time on the meta line (a comment's file and line). */
  meta?: React.ReactNode
  body?: React.ReactNode
  onOpen: (item: ActivityItem) => void
  /** A row that names itself (comments) says "Unread" there instead of in the title. */
  ariaLabel?: string
  ariaDescribedBy?: string
}

/**
 * The one row shell of every event kind, on the PR list's scale (`PrListItem`):
 * a `text-sm` title, `font-medium` in full colour while unread and
 * `text-text/70` once read; `text-xs` meta; the left accent border (and
 * `aria-current`) when the item's PR is the one open in the review.
 */
function RowShell({
  item,
  current,
  lead,
  title,
  meta,
  body,
  onOpen,
  ariaLabel,
  ariaDescribedBy,
}: RowShellProps): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      data-activity-item={item.id}
      data-read={item.read || undefined}
      aria-current={current || undefined}
      aria-label={ariaLabel}
      aria-describedby={ariaDescribedBy}
      className={`flex w-full items-start gap-1.5 border-l-2 px-3 py-2 text-left transition-colors duration-150 ${
        current ? 'border-accent bg-accent/10' : 'border-transparent hover:bg-bg/60'
      }`}
    >
      <UnreadDot unread={!item.read} />
      {lead}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          className={`break-words text-sm leading-snug ${
            item.read ? 'text-text/70' : 'font-medium text-text'
          }`}
        >
          {!item.read && !ariaLabel && (
            <span className="sr-only">{t('layout.inbox.unreadItem')} </span>
          )}
          {title}
        </span>
        <span className="flex min-w-0 items-baseline gap-2 text-xs text-muted">
          {meta}
          <When at={item.at} />
        </span>
        {body}
      </span>
    </button>
  )
}

function ItemRow({
  item,
  current,
  onOpen,
}: {
  item: ActivityItem
  current: boolean
  onOpen: (item: ActivityItem) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const excerptId = useId()
  const shell = { item, current, onOpen }

  if (item.kind === 'orphan') {
    return (
      <RowShell
        {...shell}
        lead={
          <GitPullRequestArrow size={14} className="mt-0.5 shrink-0 text-warning" aria-hidden />
        }
        title={
          // Branch names go in as components (plain text), never as values Trans would parse.
          <Trans
            i18nKey="layout.inbox.orphan"
            values={{ parent: item.parent.number }}
            components={{
              base: <span>{item.parent.mergedInto}</span>,
              target: <span>{item.suggestedBase}</span>,
              warn: <span className="text-warning" />,
            }}
          />
        }
      />
    )
  }
  if (item.kind === 'review') {
    return (
      <RowShell
        {...shell}
        lead={<VoteIcon vote={item.vote} />}
        title={t(`layout.inbox.vote.${item.vote}`, {
          reviewer: item.reviewer.displayName ?? item.reviewer.login,
        })}
      />
    )
  }
  if (item.kind === 'review_request') {
    return (
      <RowShell
        {...shell}
        lead={<Eye size={14} className="mt-0.5 shrink-0 text-accent" aria-hidden />}
        title={t(item.required ? 'layout.inbox.requested' : 'layout.inbox.requestedOptional')}
      />
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
    <RowShell
      {...shell}
      // The name says who and where (and whether it is unread); the excerpt is its description.
      ariaLabel={item.read ? label : t('layout.inbox.unreadLabel', { label })}
      ariaDescribedBy={excerptId}
      lead={<Avatar user={item.author} size={16} />}
      title={t(item.isReply ? 'layout.inbox.replied' : 'layout.inbox.commented', { author })}
      meta={
        <span className="min-w-0 truncate font-mono" title={item.path}>
          {where}
        </span>
      }
      body={
        // Plain text on purpose: main flattened it, and it is never Markdown here.
        <span id={excerptId} className="line-clamp-2 break-words text-xs text-muted">
          {item.excerpt}
        </span>
      }
    />
  )
}

function GroupSection({
  group,
  current,
  pending,
  onOpen,
  onMarkRead,
}: {
  group: ActivityGroup
  /** The group's PR is the one open in the review. */
  current: boolean
  pending: boolean
  onOpen: (item: ActivityItem) => void
  onMarkRead: (group: ActivityGroup) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const headingId = useId()
  return (
    <section
      data-testid="inbox-group"
      data-pr-key={group.prKey}
      aria-labelledby={headingId}
      className="border-b border-border/60 py-1"
    >
      <div className="flex min-w-0 items-start gap-1.5 px-3 pt-1.5">
        <span className="min-w-0 flex-1">
          <span
            id={headingId}
            className="block truncate text-sm font-medium text-text"
            title={group.prTitle}
          >
            {/* The title goes in as a component (plain text), never as a value Trans would parse. */}
            <Trans
              i18nKey="layout.inbox.groupLabel"
              values={{ number: group.number }}
              components={{
                num: <span className="text-muted" />,
                name: <span>{group.prTitle}</span>,
              }}
            />
          </span>
          <span className="block truncate text-xs text-muted">{group.repo.fullName}</span>
        </span>
        {pending && <Spinner size={13} className="mt-0.5" />}
        {/* Stays mounted once the group is read (quiet, aria-disabled), so focus is not lost. */}
        <IconButton
          size="xs"
          onClick={() => {
            if (group.unreadCount > 0) onMarkRead(group)
          }}
          aria-disabled={group.unreadCount === 0 || undefined}
          label={t('layout.inbox.markPrRead', { number: group.number })}
          icon={<CheckCheck size={13} aria-hidden />}
        />
      </div>
      <ul>
        {group.items.map((item) => (
          <li key={item.id}>
            <ItemRow item={item} current={current} onOpen={onOpen} />
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * The sidebar's Inbox: what happened on your PRs (new comments, orphaned
 * stacks, votes, review requests), grouped by PR, newest first. Unread reads
 * like the PR list: the same dot and a stronger title; read rows drop to the
 * list's seen tone. A row opens the PR at its thread and marks it read. The
 * search field above filters it locally.
 */
export function InboxView(): React.JSX.Element {
  const { t } = useTranslation()
  const searchQuery = useAppStore((s) => s.searchQuery)
  const { state, loadError, markError, load, markRead, retryMarkRead } = useActivity()
  const { open, pendingKey, error: openError } = useOpenActivityItem()
  // The PR open in the review (not one only remembered behind the home dashboard).
  const currentKey = useAppStore((s) =>
    s.mainView === 'review' && s.selectedPr ? prKey(s.selectedPr.repo, s.selectedPr.number) : null,
  )

  const groups = useMemo(
    () =>
      groupActivity(state?.items ?? []).filter((group) => matchesActivityQuery(group, searchQuery)),
    [state, searchQuery],
  )
  const unread = state?.unreadCount ?? 0

  return (
    <div data-testid="activity-inbox" className="flex min-h-0 flex-col pb-2">
      {/* No count (and no "All caught up") until main has answered. */}
      {state !== null && (
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
          <span className="min-w-0 flex-1 truncate text-xs text-muted">
            {unread > 0 ? t('layout.inbox.unread', { count: unread }) : t('layout.inbox.allRead')}
          </span>
          {/* aria-disabled, not disabled: a click that reads everything keeps focus here. */}
          <Button
            variant="ghost"
            size="xs"
            onClick={() => {
              if (unread > 0) void markRead({ all: true })
            }}
            aria-disabled={unread === 0 || undefined}
          >
            {t('layout.inbox.markAllRead')}
          </Button>
        </div>
      )}
      {state === null && loadError && (
        <InlineError
          className="px-3 pt-2"
          message={t('layout.inbox.loadFailed', { error: loadError })}
          onRetry={() => void load()}
        />
      )}
      {markError && (
        <InlineError
          className="px-3 pt-2"
          message={t('layout.inbox.markFailed', { error: markError.message })}
          onRetry={() => void retryMarkRead()}
        />
      )}
      {openError && <InlineError className="px-3 pt-2" message={openError} />}
      {state === null && !loadError && (
        <p role="status" className="p-4 text-sm text-muted">
          {t('layout.inbox.loading')}
        </p>
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
          current={group.prKey === currentKey}
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
