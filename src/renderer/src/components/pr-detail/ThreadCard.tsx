import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { Check, ChevronDown, ChevronRight, Link } from 'lucide-react'
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
import {
  suggestionSourceFor,
  useThreadActions,
  useThreadFileLines,
} from '../../hooks/thread-actions'
import { CommentBody } from './CommentBody'
import { CommentComposer, type AppendRequest } from './CommentComposer'
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
  /**
   * Text to add to the reply box (an AI answer the reviewer turns into a
   * reply): the thread opens, the text goes after anything already typed,
   * the box is focused, then `onReplyRequestApplied(token)`.
   */
  replyRequest?: AppendRequest
  onReplyRequestApplied?: (token: number) => void
}

function toErrorMessage(error: unknown): string {
  return errorText(error)
}

function positionLabel(thread: CommentThread, showPath: boolean, t: TFunction): string | null {
  const range = threadLineRange(thread)
  if (!thread.path) return null
  const lines = range
    ? range.end > range.start
      ? `${range.start}–${range.end}`
      : `${range.start}`
    : null
  if (!showPath) {
    if (!lines) return t('comments.thread.fileComment')
    return range && range.end > range.start
      ? t('comments.thread.lines', { lines })
      : t('comments.thread.line', { line: lines })
  }
  return lines ? `${thread.path}:${lines}` : thread.path
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
 */
export function ThreadCard({
  thread,
  collapsedByDefault,
  onNavigateToLine,
  extraHeaderContent,
  showExcerpt = false,
  showPath = true,
  highlighted = false,
  replyRequest,
  onReplyRequestApplied,
}: ThreadCardProps): React.JSX.Element {
  const { t } = useTranslation()
  const { locale } = useLocale()
  const actions = useThreadActions()
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

  // Original lines for suggestion mini-diffs: only fetched when a comment has one.
  const wantsOriginal = useMemo(
    () => thread.line !== undefined && thread.comments.some((c) => hasSuggestion(c.bodyMarkdown)),
    [thread.line, thread.comments],
  )
  const fileLines = useThreadFileLines(thread, wantsOriginal && !collapsed)
  const originalLines =
    range && fileLines.status === 'ready' && range.start <= fileLines.lines.length
      ? fileLines.lines.slice(range.start - 1, range.end)
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
      // Focusable (not tabbable) while highlighted: arriving from the Inbox moves focus here.
      tabIndex={highlighted ? -1 : undefined}
      className={`min-w-0 rounded-md border bg-panel focus:outline-none ${
        highlighted ? 'border-accent ring-1 ring-accent/60' : 'border-border'
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 py-1.5 pr-3 pl-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 text-xs text-muted">
          <IconButton
            size="xs"
            onClick={toggle}
            aria-expanded={!collapsed}
            label={collapsed ? t('comments.thread.unfold') : t('comments.thread.fold')}
            icon={collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
          />
          {label ? (
            onNavigateToLine ? (
              <span
                role="link"
                tabIndex={0}
                title={t('comments.thread.showLineInFiles')}
                onClick={onNavigateToLine}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    onNavigateToLine()
                  }
                }}
                className={`${showPath ? 'min-w-[6rem] truncate' : 'shrink-0'} cursor-pointer rounded-sm font-mono text-text underline decoration-border decoration-dotted underline-offset-2 hover:decoration-text`}
              >
                {label}
              </span>
            ) : (
              <span
                className={`${showPath ? 'min-w-[6rem] truncate' : 'shrink-0'} font-mono text-text`}
              >
                {label}
              </span>
            )
          ) : (
            <span className="shrink-0 text-text">{t('comments.thread.generalComment')}</span>
          )}
          {/* Mouse shortcut for the fold button (the keyboard path is the button itself). */}
          <span
            onClick={toggle}
            className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 self-stretch"
          >
            <span className="shrink-0">· {t('comments.thread.commentCount', { count })}</span>
            {collapsed && preview && (
              <span className="min-w-0 truncate text-muted/80">
                · {first!.author.displayName ?? first!.author.login}: {preview}
              </span>
            )}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
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
                    outdated={thread.isOutdated}
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
            appendRequest={replyRequest}
            onAppendApplied={onReplyRequestApplied}
            suggestion={suggestionSourceFor(actions, thread, t)}
            onSubmit={(bodyMarkdown) => actions.reply(thread.id, bodyMarkdown)}
          />
        </>
      )}
    </div>
  )
}
