import { EyeOff, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { MAX_CHAT_CONTEXT_ITEMS } from '../../../../shared/chat'
import { prKey } from '../../../../shared/scm'
import type { CommentThread } from '../../../../shared/types'
import { useThreadActions } from '../../hooks/thread-actions'
import { threadContextItem } from '../../lib/chat-context'
import { useAppStore } from '../../stores/app-store'
import { useChatStore } from '../../stores/chat-store'
import { ThreadCard } from './ThreadCard'
import { IconButton } from '../ui/IconButton'

interface InlineThreadCardProps {
  thread: CommentThread
  highlighted: boolean
  /** Hides the threads of this line (the gutter icon shows them again); absent = no hide button. */
  onHide?: () => void
  /**
   * `line` (default): under its diff row, folded to its header.
   * `above`: in the list above the diff for threads no row can host, with
   * the code it points at, folded only when no longer open.
   */
  placement?: 'line' | 'above'
}

/**
 * A thread in the diff: under the row it belongs to (`SplitDiff`/`InlineDiff`)
 * or above the diff when no row can host it (`DiffView`). Carries the
 * `thread-<id>` anchor `DiffView` scrolls to when the user jumps here from
 * the Comments view, a `path:line` chip or the chat.
 *
 * Under a row, every thread starts folded to its one-line header (author,
 * first words, status) so the code reads as code; one click opens it. The
 * focused thread (jumped to, or just created) opens by itself (`highlighted`).
 *
 * The sparkle adds the thread to the side panel's chat draft as a chip (its
 * comments are the context), and removes it when clicked again. "Use as
 * reply" in the chat lands here as `replyRequest`: the thread opens and the
 * answer goes in its reply box, after anything already typed. Nothing is posted.
 */
export function InlineThreadCard({
  thread,
  highlighted,
  onHide,
  placement = 'line',
}: InlineThreadCardProps): React.JSX.Element {
  const { t } = useTranslation()
  const actions = useThreadActions()
  const key = prKey(actions.repo, actions.number)
  const pending = useChatStore(
    (s) =>
      s.drafts[key]?.items.some((item) => item.kind === 'thread' && item.threadId === thread.id) ??
      false,
  )
  const full = useChatStore(
    (s) => (s.drafts[key]?.items.length ?? 0) >= MAX_CHAT_CONTEXT_ITEMS,
  )
  const toggleThreadItem = useChatStore((s) => s.toggleThreadItem)
  const openAskPanel = useAppStore((s) => s.openAskPanel)
  const replyRequest = useAppStore((s) =>
    s.replyRequest?.threadId === thread.id ? s.replyRequest : null,
  )
  const consumeReplyRequest = useAppStore((s) => s.consumeReplyRequest)
  const canAdd = thread.path !== undefined && thread.comments.length > 0
  const blocked = full && !pending

  function toggleChat(): void {
    const item = threadContextItem(thread)
    if (!item) return
    if (toggleThreadItem(key, item) && !pending) openAskPanel(true)
  }

  return (
    <div
      id={`thread-${thread.id}`}
      className={placement === 'line' ? 'bg-bg px-2 py-1 font-sans' : ''}
    >
      <ThreadCard
        thread={thread}
        collapsedByDefault={placement === 'line' ? true : undefined}
        showPath={false}
        showExcerpt={placement === 'above'}
        highlighted={highlighted}
        replyRequest={replyRequest ?? undefined}
        onReplyRequestApplied={consumeReplyRequest}
        extraHeaderContent={
          <>
            {canAdd && (
              <IconButton
                size="xs"
                onClick={toggleChat}
                disabled={blocked}
                active={pending}
                label={pending ? t('chat.thread.buttonRemove') : t('chat.thread.button')}
                title={
                  pending
                    ? t('chat.thread.buttonTitlePending')
                    : blocked
                      ? t('chat.composer.full', { max: MAX_CHAT_CONTEXT_ITEMS })
                      : t('chat.thread.buttonTitle')
                }
                data-pending={pending || undefined}
                icon={<Sparkles size={12} />}
              />
            )}
            {onHide && (
              <IconButton
                size="xs"
                onClick={onHide}
                label={t('comments.line.hideComments')}
                title={t('comments.line.hideCommentsTitle')}
                icon={<EyeOff size={12} />}
              />
            )}
          </>
        }
      />
    </div>
  )
}
