import { useEffect } from 'react'
import { useChatStore } from '../stores/chat-store'

/**
 * Follows main's `chatEvent` push (messages while they stream, conversation
 * summaries, deletions) into `chat-store`. Mounted ONCE, in the app shell:
 * the panel's components only read the store.
 */
export function useChatEvents(): void {
  useEffect(
    () => window.minerva.events.onChatEvent((event) => useChatStore.getState().applyEvent(event)),
    [],
  )
}
