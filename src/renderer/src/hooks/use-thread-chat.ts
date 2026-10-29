import { MAX_CHAT_CONTEXT_ITEMS } from '../../../shared/chat'
import { prKey } from '../../../shared/scm'
import type { CommentThread } from '../../../shared/types'
import { threadContextItem } from '../lib/chat-context'
import { useAppStore } from '../stores/app-store'
import { useChatStore } from '../stores/chat-store'
import { useThreadActions } from './thread-actions'

export interface ThreadChatState {
  /** The thread has something to send (at least one comment). */
  canAdd: boolean
  /** The thread is in this PR's chat draft. */
  inChat: boolean
  /** The draft is full and this thread is not in it: the toggle can't add it. */
  blocked: boolean
  /** Adds the thread (opening the Ask panel the first time) or removes it. */
  toggle: () => void
}

/**
 * The AI-chat toggle of one thread card, wherever it renders (diff,
 * Conversation, Comments): all of them read the same draft
 * (`useChatStore.drafts`), so a thread added from one view shows as added in
 * every other.
 */
export function useThreadChat(thread: CommentThread): ThreadChatState {
  const actions = useThreadActions()
  const key = prKey(actions.repo, actions.number)
  const inChat = useChatStore(
    (s) =>
      s.drafts[key]?.items.some((item) => item.kind === 'thread' && item.threadId === thread.id) ??
      false,
  )
  const full = useChatStore((s) => (s.drafts[key]?.items.length ?? 0) >= MAX_CHAT_CONTEXT_ITEMS)
  const toggleThreadItem = useChatStore((s) => s.toggleThreadItem)
  const openAskPanel = useAppStore((s) => s.openAskPanel)
  const blocked = full && !inChat

  function toggle(): void {
    if (blocked) return
    const item = threadContextItem(thread)
    if (!item) return
    if (toggleThreadItem(key, item) && !inChat) openAskPanel(true)
  }

  return { canAdd: thread.comments.length > 0, inChat, blocked, toggle }
}
