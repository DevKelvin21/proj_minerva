import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { Check, ChevronDown, ChevronRight, Link } from 'lucide-react'
import { isThreadOpen } from '../../../../shared/scm'
import type { ThreadStatus } from '../../../../shared/scm'
import type { CommentThread } from '../../../../shared/types'
import { Avatar } from '../ui/Avatar'
import { Badge } from '../ui/Badge'
import { providerOfWebUrl, SCM_PROVIDER_LABEL } from '../../lib/scm-labels'
import { formatAbsoluteTime, formatRelativeTime } from '../../lib/relative-time'
import { useLocale } from '../../i18n/use-locale'
import { hasSuggestion } from '../../lib/suggestions'
import { threadLineRange } from '../../lib/line-threads'
import { settableStatusesFor } from '../../lib/thread-groups'
import {
  suggestionSourceFor,
  useThreadActions,
  useThreadFileLines,
} from '../../hooks/thread-actions'
import { CommentBody } from './CommentBody'
import { CommentComposer, type CommentComposerHandle } from './CommentComposer'
import { ThreadCodeExcerpt } from './CodeExcerpt'
import { ThreadStatusPicker } from './ThreadStatusPicker'
import { errorText } from '../../lib/error-text'

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
  /** Starting text of the reply box, focused (an AI answer the reviewer turns into a reply). */
  replyDraft?: string
  /** The reply box, while the thread is open (an AI answer is appended through it). */
  replyRef?: React.Ref<CommentComposerHandle>
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
 * One comment thread: header (where it points, how many comments, status
 * picker, Outdated badge), the comments (author, relative time with the
 * absolute one on hover, safe Markdown with suggestions as mini-diffs), the
 * code it points at when useful, and a reply composer.
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
  replyDraft,
  replyRef,
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

  return (
    <div
      data-thread-id={thread.id}
      data-collapsed={collapsed || undefined}
      className={`min-w-0 rounded-md border bg-panel ${
        highlighted ? 'border-accent ring-1 ring-accent/60' : 'border-border'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 px-3 py-1.5">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
          className="flex min-w-0 flex-1 items-center gap-2 text-left text-xs text-muted"
        >
          {collapsed ? (
            <ChevronRight size={13} className="shrink-0" />
          ) : (
            <ChevronDown size={13} className="shrink-0" />
          )}
          {label ? (
            onNavigateToLine ? (
              <span
                role="link"
                tabIndex={0}
                title={t('comments.thread.showLineInFiles')}
                onClick={(event) => {
                  event.stopPropagation()
                  onNavigateToLine()
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    event.stopPropagation()
                    onNavigateToLine()
                  }
                }}
                className={`${showPath ? 'min-w-[6rem] truncate' : 'shrink-0'} font-mono text-accent underline decoration-dotted hover:text-text`}
              >
                {label}
              </span>
            ) : (
              <span className={`${showPath ? 'min-w-[6rem] truncate' : 'shrink-0'} font-mono`}>
                {label}
              </span>
            )
          ) : (
            <span>{t('comments.thread.generalComment')}</span>
          )}
          <span className="shrink-0">· {t('comments.thread.commentCount', { count })}</span>
          {collapsed && first && (
            <span className="min-w-0 truncate text-muted/80">
              · {first.author.displayName ?? first.author.login}:{' '}
              {first.bodyMarkdown.replace(/\s+/g, ' ').slice(0, 120)}
            </span>
          )}
        </button>
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
        <p role="alert" className="border-t border-border px-3 py-1.5 text-xs text-danger">
          {statusError}
        </p>
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
                      <button
                        type="button"
                        onClick={() => void handleCopyUrl(comment.id, comment.htmlUrl!)}
                        title={copyLabel}
                        aria-label={copyLabel}
                        className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-muted transition-colors hover:bg-border/60 hover:text-text"
                      >
                        {copiedCommentId === comment.id ? (
                          <>
                            <Check size={12} className="text-success" />
                            {t('common.copied')}
                          </>
                        ) : (
                          <Link size={12} />
                        )}
                      </button>
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
            ref={replyRef}
            className="border-t border-border p-3"
            label={t('comments.thread.replyLabel')}
            placeholder={t('comments.thread.replyPlaceholder')}
            submitLabel={t('comments.thread.reply')}
            clearOnSubmit
            initialValue={replyDraft}
            autoFocus={replyDraft !== undefined}
            suggestion={suggestionSourceFor(actions, thread, t)}
            onSubmit={(bodyMarkdown) => actions.reply(thread.id, bodyMarkdown)}
          />
        </>
      )}
    </div>
  )
}
