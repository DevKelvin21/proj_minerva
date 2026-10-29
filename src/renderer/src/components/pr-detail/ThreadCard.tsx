import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { Check, ChevronDown, ChevronRight, Link, Sparkles } from 'lucide-react'
import { MAX_CHAT_CONTEXT_ITEMS } from '../../../../shared/chat'
import { isThreadOpen } from '../../../../shared/scm'
import type { ThreadStatus } from '../../../../shared/scm'
import type { CommentThread } from '../../../../shared/types'
import { Avatar } from '../ui/Avatar'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { IconButton } from '../ui/IconButton'
import { providerOfWebUrl, SCM_PROVIDER_LABEL } from '../../lib/scm-labels'
import { formatAbsoluteTime, formatRelativeTime } from '../../lib/relative-time'
import { useLocale } from '../../i18n/use-locale'
import { hasSuggestion } from '../../lib/suggestions'
import { commentPreview } from '../../lib/comment-preview'
import { threadLineRange } from '../../lib/line-threads'
import { settableStatusesFor } from '../../lib/thread-groups'
import { hasCommentedVersion, versionLineRange } from '../../lib/thread-origin'
import {
  suggestionSourceFor,
  useThreadActions,
  useThreadFileLines,
} from '../../hooks/thread-actions'
import { useThreadChat } from '../../hooks/use-thread-chat'
import { useAppStore } from '../../stores/app-store'
import { CommentBody } from './CommentBody'
import { CommentComposer } from './CommentComposer'
import { ThreadCodeExcerpt } from './CodeExcerpt'
import { ThreadStatusPicker } from './ThreadStatusPicker'
import { errorText } from '../../lib/error-text'
import { InlineError } from '../ui/InlineError'

interface ThreadCardProps {
  thread: CommentThread
  /** Default: collapsed when the thread is no longer open (resolved, closed, won't fix…). */
  collapsedByDefault?: boolean
  /** Makes `path:line` a link (jump to the Files tab). */
  onNavigateToLine?: () => void
  /** Extra controls at the right of the header (e.g. "hide" in the diff). */
  extraHeaderContent?: React.ReactNode
  /** Show the code the thread points at above the comments (always on for outdated threads). */
  showExcerpt?: boolean
  /** In the diff the file is obvious: show only "Line 12". */
  showPath?: boolean
  /** Focused (jumped to from the Comments view). */
  highlighted?: boolean
}

function toErrorMessage(error: unknown): string {
  return errorText(error)
}

function lineSpan(thread: CommentThread): string | null {
  const range = threadLineRange(thread)
  if (!range) return null
  return range.end > range.start ? `${range.start}–${range.end}` : `${range.start}`
}

function positionLabel(thread: CommentThread, showPath: boolean, t: TFunction): string | null {
  if (!thread.path) return null
  const lines = lineSpan(thread)
  if (!showPath) {
    if (!lines) return t('comments.thread.fileComment')
    return lines.includes('–')
      ? t('comments.thread.lines', { lines })
      : t('comments.thread.line', { line: lines })
  }
  return lines ? `${thread.path}:${lines}` : thread.path
}

/**
 * `path:line` that gives way from the LEFT (`…/types/File.ts:14`): the folders
 * shrink first (ellipsis at their start), then the file name, also from its
 * start, so the line number always shows. The full text is the tooltip.
 * Plain text (untrusted).
 */
function PathLabel({ path, lines }: { path: string; lines: string | null }): React.JSX.Element {
  const slash = path.lastIndexOf('/')
  const folders = path.slice(0, slash + 1)
  const name = path.slice(slash + 1) + (lines ? ':' + lines : '')
  return (
    <span
      className="flex min-w-0"
      title={path + (lines ? ':' + lines : '')}
      data-testid="thread-path"
    >
      {folders && (
        // rtl puts the ellipsis on the left; <bdi> keeps the path itself left-to-right.
        <span dir="rtl" className="min-w-0 truncate">
          <bdi>{folders}</bdi>
        </span>
      )}
      {/* Too long even alone: it also gives way from the left, so the line stays. */}
      <span dir="rtl" className="max-w-full shrink-0 truncate">
        <bdi>{name}</bdi>
      </span>
    </span>
  )
}

/**
 * One comment thread: header (fold button, where it points as its own link,
 * how many comments, a plain-text preview when folded, status picker only
 * tinted when the thread is not simply open, Outdated badge), the comments (author, relative time with the
 * absolute one on hover, safe Markdown with suggestions as mini-diffs), the
 * code it points at when useful, and a reply box that starts as one line and
 * grows into the full composer when focused.
 *
 * Status changes are optimistic: the picker shows the new status at once and
 * rolls back with a visible error if the provider refuses. Threads that are
 * no longer open start collapsed (header only) so open discussions stand out.
 *
 * The sparkle adds the thread to the side panel's chat draft as a chip (its
 * comments are the context; a PR-level thread too), and removes it when
 * clicked again. It is the same toggle in the diff, the Conversation tab and
 * the Comments tab: while the thread is in the draft it is pressed and the
 * card is outlined in every view; with the draft full it can't add, and its
 * tooltip says why. "Use as reply" in the chat lands here as the app store's
 * `replyRequest`: the thread opens and the answer goes in its reply box,
 * after anything already typed. Nothing is posted.
 */
export function ThreadCard({
  thread,
  collapsedByDefault,
  onNavigateToLine,
  extraHeaderContent,
  showExcerpt = false,
  showPath = true,
  highlighted = false,
}: ThreadCardProps): React.JSX.Element {
  const { t } = useTranslation()
  const { locale } = useLocale()
  const actions = useThreadActions()
  const chat = useThreadChat(thread)
  const replyRequest = useAppStore((s) =>
    s.replyRequest?.threadId === thread.id ? s.replyRequest : null,
  )
  const consumeReplyRequest = useAppStore((s) => s.consumeReplyRequest)
  const [collapsed, setCollapsed] = useState(
    highlighted ? false : (collapsedByDefault ?? !isThreadOpen(thread.status)),
  )
  const [pendingStatus, setPendingStatus] = useState<ThreadStatus | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [copiedCommentId, setCopiedCommentId] = useState<string | null>(null)

  // A reply request opens a folded thread (its reply box only exists open).
  if (replyRequest && collapsed) setCollapsed(false)

  const status = pendingStatus ?? thread.status
  const allowed = settableStatusesFor(actions.repo.provider, thread)
  const range = threadLineRange(thread)
  const label = positionLabel(thread, showPath, t)
  // Written on an earlier push and its provider says where: suggestions apply to THAT code.
  const asCommented = hasCommentedVersion(thread)
  const suggestionRange = asCommented ? versionLineRange(thread, 'commented') : range

  // Original lines for suggestion mini-diffs: only fetched when a comment has one.
  const wantsOriginal = useMemo(
    () => thread.line !== undefined && thread.comments.some((c) => hasSuggestion(c.bodyMarkdown)),
    [thread.line, thread.comments],
  )
  const fileLines = useThreadFileLines(
    thread,
    wantsOriginal && !collapsed,
    asCommented ? 'origin' : 'current',
  )
  const originalLines =
    suggestionRange &&
    fileLines.status === 'ready' &&
    suggestionRange.start <= fileLines.lines.length
      ? fileLines.lines.slice(suggestionRange.start - 1, suggestionRange.end)
      : null

  async function handleStatusChange(next: ThreadStatus): Promise<void> {
    if (next === status) return
    setPendingStatus(next)
    setStatusError(null)
    try {
      await actions.setStatus(thread.id, next)
    } catch (err: unknown) {
      setStatusError(t('comments.thread.statusError', { error: toErrorMessage(err) }))
    } finally {
      setPendingStatus(null)
    }
  }

  async function handleCopyUrl(commentId: string, htmlUrl: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(htmlUrl)
      setCopiedCommentId(commentId)
      setTimeout(
        () => setCopiedCommentId((current) => (current === commentId ? null : current)),
        1500,
      )
    } catch {
      // No clipboard permission in this context: nothing sensible to fall back to.
    }
  }

  const first = thread.comments[0]
  const count = thread.comments.length
  const preview = first ? commentPreview(first.bodyMarkdown) : ''
  const toggle = (): void => setCollapsed((c) => !c)

  return (
    <div
      data-thread-id={thread.id}
      data-collapsed={collapsed || undefined}
      data-in-chat={chat.inChat || undefined}
      // Focusable (not tabbable) while highlighted: arriving from the Inbox moves focus here.
      tabIndex={highlighted ? -1 : undefined}
      className={`min-w-0 rounded-md border bg-panel focus:outline-none ${
        highlighted
          ? 'border-accent ring-1 ring-accent/60'
          : chat.inChat
            ? 'border-accent/50'
            : 'border-border'
      }`}
    >
      {/*
        Header: the left group gives way first (preview, then the path from the
        left), the count never shrinks, and below ~14rem of room the right
        group wraps under it instead of being drawn over it. The right group
        (Outdated, status, `extraHeaderContent`) keeps its full width.
      */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 py-1.5 pr-3 pl-2">
        <div
          className="flex min-w-0 flex-1 basis-56 items-center gap-2 text-xs text-muted"
          data-thread-header-main
        >
          <span className="flex shrink-0">
            <IconButton
              size="xs"
              onClick={toggle}
              aria-expanded={!collapsed}
              label={collapsed ? t('comments.thread.unfold') : t('comments.thread.fold')}
              icon={collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
            />
          </span>
          {label ? (
            onNavigateToLine ? (
              <span
                role="link"
                tabIndex={0}
                aria-label={label}
                title={t('comments.thread.showLineInFiles')}
                onClick={onNavigateToLine}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    onNavigateToLine()
                  }
                }}
                className={`${showPath ? 'flex min-w-0' : 'shrink-0'} cursor-pointer rounded-sm font-mono text-text underline decoration-border decoration-dotted underline-offset-2 hover:decoration-text`}
              >
                {showPath && thread.path ? (
                  <PathLabel path={thread.path} lines={lineSpan(thread)} />
                ) : (
                  label
                )}
              </span>
            ) : (
              <span className={`${showPath ? 'flex min-w-0' : 'shrink-0'} font-mono text-text`}>
                {showPath && thread.path ? (
                  <PathLabel path={thread.path} lines={lineSpan(thread)} />
                ) : (
                  label
                )}
              </span>
            )
          ) : (
            <span className="shrink-0 text-text">{t('comments.thread.generalComment')}</span>
          )}
          {/* Mouse shortcut for the fold button (the keyboard path is the button itself). */}
          <span
            onClick={toggle}
            className="shrink-0 cursor-pointer whitespace-nowrap"
            data-testid="thread-comment-count"
          >
            · {t('comments.thread.commentCount', { count })}
          </span>
          <span
            onClick={toggle}
            className="flex min-w-0 flex-1 cursor-pointer items-center self-stretch"
          >
            {collapsed && preview && (
              <span className="min-w-0 truncate text-muted/80">
                · {first!.author.displayName ?? first!.author.login}: {preview}
              </span>
            )}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2" data-thread-header-actions>
          {thread.isOutdated && (
            <Badge tone="warning">
              <span data-testid="outdated-badge" title={t('comments.thread.outdatedTitle')}>
                {t('comments.thread.outdated')}
              </span>
            </Badge>
          )}
          <ThreadStatusPicker
            status={status}
            allowed={allowed}
            busy={pendingStatus !== null}
            onChange={(next) => void handleStatusChange(next)}
          />
          {chat.canAdd && (
            <IconButton
              size="xs"
              onClick={chat.toggle}
              aria-disabled={chat.blocked || undefined}
              active={chat.inChat}
              label={chat.inChat ? t('chat.thread.buttonRemove') : t('chat.thread.button')}
              title={
                chat.inChat
                  ? t('chat.thread.buttonTitlePending')
                  : chat.blocked
                    ? t('chat.composer.full', { max: MAX_CHAT_CONTEXT_ITEMS })
                    : t('chat.thread.buttonTitle')
              }
              data-pending={chat.inChat || undefined}
              data-testid="thread-chat-toggle"
              icon={<Sparkles size={12} />}
            />
          )}
          {extraHeaderContent}
        </div>
      </div>
      {statusError && (
        <InlineError className="border-t border-border px-3 py-1.5" message={statusError} />
      )}

      {!collapsed && (
        <>
          {(showExcerpt || thread.isOutdated) && range && (
            <div className="border-t border-border px-3 py-2">
              <ThreadCodeExcerpt thread={thread} />
            </div>
          )}
          <ul className="divide-y divide-border border-t border-border">
            {thread.comments.map((comment) => {
              const provider = comment.htmlUrl ? providerOfWebUrl(comment.htmlUrl) : null
              const copyLabel = provider
                ? t('comments.thread.copyLink', { provider: SCM_PROVIDER_LABEL[provider] })
                : ''
              return (
                <li key={comment.id} className="min-w-0 p-3">
                  <div className="mb-1 flex min-w-0 items-center gap-2 text-xs text-muted">
                    <Avatar user={comment.author} size={16} />
                    <span className="truncate font-medium text-text" title={comment.author.login}>
                      {comment.author.displayName ?? comment.author.login}
                    </span>
                    <time
                      dateTime={comment.createdAt}
                      title={formatAbsoluteTime(comment.createdAt, locale)}
                      className="shrink-0"
                    >
                      {formatRelativeTime(comment.createdAt, locale)}
                    </time>
                    {comment.htmlUrl && (
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => void handleCopyUrl(comment.id, comment.htmlUrl!)}
                        title={copyLabel}
                        aria-label={copyLabel}
                        className="ml-auto"
                        icon={
                          copiedCommentId === comment.id ? (
                            <Check size={12} className="text-success" aria-hidden />
                          ) : (
                            <Link size={12} aria-hidden />
                          )
                        }
                      >
                        {copiedCommentId === comment.id && t('common.copied')}
                      </Button>
                    )}
                  </div>
                  <CommentBody
                    body={comment.bodyMarkdown}
                    originalLines={originalLines}
                    outdated={thread.isOutdated && !asCommented}
                  />
                </li>
              )
            })}
          </ul>

          <CommentComposer
            collapsible
            className="border-t border-border p-3"
            label={t('comments.thread.replyLabel')}
            placeholder={t('comments.thread.replyPlaceholder')}
            submitLabel={t('comments.thread.reply')}
            clearOnSubmit
            appendRequest={replyRequest ?? undefined}
            onAppendApplied={consumeReplyRequest}
            suggestion={suggestionSourceFor(actions, thread, t)}
            onSubmit={(bodyMarkdown) => actions.reply(thread.id, bodyMarkdown)}
          />
        </>
      )}
    </div>
  )
}
