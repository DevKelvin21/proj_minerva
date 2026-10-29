import { useId, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import {
  Archive,
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
import { useRovingTabs } from '../../hooks/use-roving-tabs'
import { useLocale } from '../../i18n/use-locale'
import {
  fileName,
  focusAfterRemoval,
  groupActivity,
  INBOX_FILTERS,
  matchesActivityQuery,
  parseInboxFilter,
  visibleInboxItems,
  type ActivityGroup,
  type InboxFilter,
} from '../../lib/activity'
import { formatAbsoluteTime, formatRelativeTime } from '../../lib/relative-time'
import { useActivityInboxStore, type DismissNotice } from '../../stores/activity-inbox-store'
import { useAppStore } from '../../stores/app-store'
import { Avatar } from '../ui/Avatar'
import { Button } from '../ui/Button'
import { CountBadge } from '../ui/CountBadge'
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
 * `text-text/70` once read; `text-xs` meta; `aria-current` when the item's PR
 * is the one open in the review (its accent border is drawn by `ItemListRow`).
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
      className="flex min-w-0 flex-1 items-start gap-1.5 py-2 pl-3 pr-1 text-left"
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

/**
 * A row plus its Done button. The button shows on hover and while anything in
 * the row has focus, and is always in the Tab order (right after its row).
 */
function ItemListRow({
  item,
  current,
  onOpen,
  onDone,
}: {
  item: ActivityItem
  current: boolean
  onOpen: (item: ActivityItem) => void
  onDone: (item: ActivityItem) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <li
      className={`group/row flex min-w-0 items-start border-l-2 transition-colors duration-150 ${
        current ? 'border-accent bg-accent/10' : 'border-transparent hover:bg-bg/60'
      }`}
    >
      <ItemRow item={item} current={current} onOpen={onOpen} />
      <IconButton
        size="xs"
        onClick={() => onDone(item)}
        label={t('layout.inbox.done')}
        icon={<Archive size={13} aria-hidden />}
        data-inbox-done={item.id}
        className="mr-2 mt-2 opacity-0 focus-visible:opacity-100 group-hover/row:opacity-100 group-focus-within/row:opacity-100"
      />
    </li>
  )
}

function GroupSection({
  group,
  current,
  pending,
  onOpen,
  onMarkRead,
  onDone,
  onDoneGroup,
}: {
  group: ActivityGroup
  /** The group's PR is the one open in the review. */
  current: boolean
  pending: boolean
  onOpen: (item: ActivityItem) => void
  onMarkRead: (group: ActivityGroup) => void
  onDone: (item: ActivityItem) => void
  onDoneGroup: (group: ActivityGroup) => void
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
        <IconButton
          size="xs"
          onClick={() => onDoneGroup(group)}
          label={t('layout.inbox.donePr', { number: group.number })}
          icon={<Archive size={13} aria-hidden />}
        />
      </div>
      <ul>
        {group.items.map((item) => (
          <ItemListRow
            key={item.id}
            item={item}
            current={current}
            onOpen={onOpen}
            onDone={onDone}
          />
        ))}
      </ul>
    </section>
  )
}

const FILTER_KEY = 'minerva.inboxFilter'
const NOTHING: ReadonlySet<string> = new Set()

/** The remembered Unread / All choice (per machine). Unreadable storage = Unread. */
function readFilter(): InboxFilter {
  try {
    return parseInboxFilter(localStorage.getItem(FILTER_KEY))
  } catch {
    return 'unread'
  }
}

function writeFilter(filter: InboxFilter): void {
  try {
    localStorage.setItem(FILTER_KEY, filter)
  } catch {
    // Storage full or blocked: the switch still works for this session.
  }
}

/** What the Undo toast says. */
function useNoticeText(): (notice: DismissNotice) => string {
  const { t } = useTranslation()
  return (notice) =>
    notice.kind === 'item'
      ? t('layout.inbox.toast.item')
      : notice.kind === 'group'
        ? t('layout.inbox.toast.group', { number: notice.number, count: notice.count })
        : t('layout.inbox.toast.read', { count: notice.count })
}

/**
 * The sidebar's Inbox: what happened on your PRs (new comments, orphaned
 * stacks, votes, review requests), grouped by PR, newest first. Unread reads
 * like the PR list: the same dot and a stronger title; read rows drop to the
 * list's seen tone. A row opens the PR at its thread and marks it read. The
 * search field above filters it locally.
 *
 * Unread (the default, remembered per machine) lists unread items only; a
 * row read while the view is open stays, dimmed, until the user leaves the
 * view (`kept`, this component's state: switching to All, leaving the Inbox
 * or a reload drops it). Done (per row, per PR, or "Clear read" under All)
 * hides items at once with Undo; the store tells main when Undo expires.
 */
export function InboxView(): React.JSX.Element {
  const { t } = useTranslation()
  const searchQuery = useAppStore((s) => s.searchQuery)
  const { state, loadError, markError, load, markRead, retryMarkRead } = useActivity()
  const hiddenIds = useActivityInboxStore((s) => s.hiddenIds)
  const pendingDismiss = useActivityInboxStore((s) => s.pendingDismiss)
  const dismissError = useActivityInboxStore((s) => s.dismissError)
  const dismiss = useActivityInboxStore((s) => s.dismiss)
  const undoDismiss = useActivityInboxStore((s) => s.undoDismiss)
  const holdDismiss = useActivityInboxStore((s) => s.holdDismiss)
  const retryDismiss = useActivityInboxStore((s) => s.retryDismiss)
  const noticeText = useNoticeText()
  const { open, pendingKey, error: openError } = useOpenActivityItem()
  // The PR open in the review (not one only remembered behind the home dashboard).
  const currentKey = useAppStore((s) =>
    s.mainView === 'review' && s.selectedPr ? prKey(s.selectedPr.repo, s.selectedPr.number) : null,
  )
  const [filter, setFilter] = useState<InboxFilter>(readFilter)
  /** Read while this Unread view was open: they stay (dimmed) until the view is left. */
  const [kept, setKept] = useState<ReadonlySet<string>>(NOTHING)
  const rootRef = useRef<HTMLDivElement>(null)
  const idPrefix = useId()
  const tabId = (key: InboxFilter): string => idPrefix + '-inbox-' + key

  const changeFilter = (next: InboxFilter): void => {
    setFilter(next)
    writeFilter(next)
    setKept(NOTHING)
  }
  const tabs = useRovingTabs({ keys: INBOX_FILTERS, value: filter, onChange: changeFilter, tabId })

  const items = useMemo(() => state?.items ?? [], [state])
  // Everything main has that no pending "Done" hides.
  const present = useMemo(
    () => items.filter((item) => !hiddenIds.has(item.id)),
    [items, hiddenIds],
  )
  const groups = useMemo(
    () =>
      groupActivity(visibleInboxItems(items, filter, kept, hiddenIds)).filter((group) =>
        matchesActivityQuery(group, searchQuery),
      ),
    [items, filter, kept, hiddenIds, searchQuery],
  )
  const unreadIds = present.filter((item) => !item.read).map((item) => item.id)
  const readIds = present.filter((item) => item.read).map((item) => item.id)
  const unread = unreadIds.length
  // Unread is empty but read items exist: say where they went.
  const caughtUp =
    filter === 'unread' && groups.length === 0 && present.length > 0 && !searchQuery.trim()

  /** Under Unread, these stay listed once read. */
  const keep = (ids: readonly string[]): void => {
    if (filter === 'unread' && ids.length > 0) setKept((prev) => new Set([...prev, ...ids]))
  }

  const rowIds = (): string[] =>
    Array.from(
      rootRef.current?.querySelectorAll<HTMLElement>('[data-activity-item]') ?? [],
      (row) => row.dataset.activityItem ?? '',
    )
  const focusRow = (id: string): boolean => {
    const row = rootRef.current?.querySelector<HTMLElement>(
      '[data-activity-item="' + CSS.escape(id) + '"]',
    )
    if (!row) return false
    row.focus()
    return true
  }
  const focusTab = (key: InboxFilter): void => document.getElementById(tabId(key))?.focus()

  /** Done: hide now (Undo in the toast), focus the next row, else the switch. */
  const done = (ids: string[], notice: DismissNotice): void => {
    if (ids.length === 0) return
    const target = focusAfterRemoval(rowIds(), new Set(ids))
    flushSync(() => dismiss(ids, notice))
    if (target === null || !focusRow(target)) focusTab(filter)
  }

  const undo = (): void => {
    const restored = new Set(flushSync(() => undoDismiss()))
    const first = rowIds().find((id) => restored.has(id))
    if (first === undefined || !focusRow(first)) focusTab(filter)
  }

  const showAll = (): void => {
    flushSync(() => changeFilter('all'))
    focusTab('all')
  }

  return (
    <div
      ref={rootRef}
      data-testid="activity-inbox"
      className="flex flex-auto shrink-0 flex-col pb-2"
    >
      {/* No count (and no "All caught up") until main has answered. */}
      {state !== null && (
        <>
          <div className="shrink-0 px-2 pt-2">
            <div
              role="tablist"
              aria-label={t('layout.inbox.filter.label')}
              className="flex w-full rounded-md border border-border bg-bg p-0.5 text-xs"
            >
              {INBOX_FILTERS.map((key) => (
                <button
                  key={key}
                  type="button"
                  {...tabs.tabProps(key)}
                  // The badge is decorative: the name says the count in words.
                  aria-label={
                    key === 'unread' && unread > 0
                      ? t('layout.inbox.filter.unreadWithCount', { count: unread })
                      : undefined
                  }
                  className={`flex min-w-0 flex-1 items-center justify-center gap-1 rounded px-1 py-1 font-medium transition-colors duration-150 ${
                    filter === key ? 'bg-panel text-text shadow-sm' : 'text-muted hover:text-text'
                  }`}
                >
                  <span className="truncate">{t(`layout.inbox.filter.${key}`)}</span>
                  {key === 'unread' && unread > 0 && <CountBadge count={unread} />}
                </button>
              ))}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
            <span className="min-w-0 flex-1 truncate text-xs text-muted">
              {filter === 'all'
                ? t('layout.inbox.readKept')
                : unread > 0
                  ? t('layout.inbox.unread', { count: unread })
                  : caughtUp
                    ? null
                    : t('layout.inbox.allRead')}
            </span>
            {/* aria-disabled, not disabled: a click that empties the list keeps focus here. */}
            {filter === 'unread' ? (
              <Button
                variant="ghost"
                size="xs"
                onClick={() => {
                  if (unread === 0) return
                  keep(unreadIds)
                  void markRead({ all: true })
                }}
                aria-disabled={unread === 0 || undefined}
              >
                {t('layout.inbox.markAllRead')}
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="xs"
                onClick={() => {
                  if (readIds.length > 0) dismiss(readIds, { kind: 'read', count: readIds.length })
                }}
                aria-disabled={readIds.length === 0 || undefined}
                icon={<Archive size={12} aria-hidden />}
              >
                {t('layout.inbox.clearRead')}
              </Button>
            )}
          </div>
        </>
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
      {dismissError && (
        <InlineError
          className="px-3 pt-2"
          message={t('layout.inbox.dismissFailed', { error: dismissError.message })}
          onRetry={() => void retryDismiss()}
        />
      )}
      {openError && <InlineError className="px-3 pt-2" message={openError} />}
      {state === null && !loadError && (
        <p role="status" className="p-4 text-sm text-muted">
          {t('layout.inbox.loading')}
        </p>
      )}
      {caughtUp && (
        <div
          data-testid="inbox-caught-up"
          className="flex flex-col items-center gap-1 px-4 py-6 text-center"
        >
          <CheckCheck size={18} className="text-muted" aria-hidden />
          <p className="text-sm font-medium text-text">{t('layout.inbox.allRead')}</p>
          <p className="text-xs text-muted">
            <Trans
              i18nKey="layout.inbox.readUnderAll"
              components={{
                all: (
                  <button
                    type="button"
                    onClick={showAll}
                    className="rounded font-medium text-accent underline-offset-2 hover:underline"
                  />
                ),
              }}
            />
          </p>
        </div>
      )}
      {state !== null && groups.length === 0 && !caughtUp && (
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
          onOpen={(item) => {
            if (!item.read) keep([item.id])
            open(item)
          }}
          onMarkRead={(target) => {
            const ids = target.items.filter((item) => !item.read).map((item) => item.id)
            keep(ids)
            void markRead({ ids })
          }}
          onDone={(item) => done([item.id], { kind: 'item' })}
          onDoneGroup={(target) => {
            // Every item of the PR, the read ones Unread does not list included.
            const ids = present
              .filter((item) => item.prKey === target.prKey)
              .map((item) => item.id)
            done(ids, { kind: 'group', number: target.number, count: ids.length })
          }}
        />
      ))}
      {/* Always mounted, so the toast's text is announced when it appears. */}
      <div role="status" className="sticky bottom-2 mt-auto px-2 empty:hidden">
        {pendingDismiss && (
          <div
            data-testid="inbox-undo-toast"
            onMouseEnter={() => holdDismiss(true)}
            onMouseLeave={() => holdDismiss(false)}
            onFocus={() => holdDismiss(true)}
            onBlur={() => holdDismiss(false)}
            className="mt-2 flex min-w-0 items-center gap-2 rounded-md bg-text py-1.5 pl-3 pr-1.5 text-xs text-panel shadow-lg"
          >
            <Archive size={13} className="shrink-0" aria-hidden />
            <span className="min-w-0 flex-1">{noticeText(pendingDismiss.notice)}</span>
            <button
              type="button"
              onClick={undo}
              className="shrink-0 rounded border border-panel/40 px-2 py-0.5 font-medium transition-colors duration-150 hover:bg-panel/15"
            >
              {t('layout.inbox.undo')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
