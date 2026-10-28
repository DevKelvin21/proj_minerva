import { useEffect, useRef } from 'react'
import { Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useChatStore } from '../../stores/chat-store'
import { ChatMessageRow } from './ChatMessageRow'

const NO_IDS: string[] = []
/** Within this many px of the bottom, new content keeps the view pinned there. */
const NEAR_BOTTOM_PX = 48

interface ChatTranscriptProps {
  conversationId: string
  prKey: string
}

/**
 * The open conversation, oldest first, with "Load older" when main has
 * more. Rows select their own message, so this list re-renders only when a
 * message is added. New content (a new message or a streaming chunk) keeps
 * the view at the bottom only if the reviewer was already there; loading
 * older messages keeps what was on screen in place.
 *
 * Mounted with `key={conversationId}`: scroll state resets per conversation.
 */
export function ChatTranscript({ conversationId, prKey }: ChatTranscriptProps): React.JSX.Element {
  const { t } = useTranslation()
  const ids = useChatStore((s) => s.transcripts[conversationId]?.ids ?? NO_IDS)
  const hasMore = useChatStore((s) => s.transcripts[conversationId]?.hasMore ?? false)
  const loading = useChatStore((s) => s.transcripts[conversationId]?.loading ?? false)
  const loadingOlder = useChatStore((s) => s.transcripts[conversationId]?.loadingOlder ?? false)
  const error = useChatStore((s) => s.transcripts[conversationId]?.error ?? null)
  const loadConversation = useChatStore((s) => s.loadConversation)
  const loadOlder = useChatStore((s) => s.loadOlder)

  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const nearBottom = useRef(true)
  /** Distance from the bottom to keep while older messages are prepended. */
  const keepFromBottom = useRef<number | null>(null)

  useEffect(() => {
    void loadConversation(conversationId)
  }, [conversationId, loadConversation])

  // Follow the content's size, not React renders: a streaming row grows on
  // its own without this component re-rendering.
  useEffect(() => {
    const scroller = scrollRef.current
    const content = contentRef.current
    if (!scroller || !content) return
    const observer = new ResizeObserver(() => {
      if (keepFromBottom.current !== null) {
        scroller.scrollTop = scroller.scrollHeight - keepFromBottom.current
        return
      }
      if (nearBottom.current) scroller.scrollTop = scroller.scrollHeight
    })
    observer.observe(content)
    return () => observer.disconnect()
  }, [])

  function onScroll(): void {
    const el = scrollRef.current
    if (!el) return
    nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX
    if (!loadingOlder) keepFromBottom.current = null
  }

  function handleLoadOlder(): void {
    const el = scrollRef.current
    if (el) keepFromBottom.current = el.scrollHeight - el.scrollTop
    void loadOlder(conversationId)
  }

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      data-testid="chat-transcript"
      className="min-h-0 flex-1 overflow-y-auto"
    >
      <div ref={contentRef} className="flex min-w-0 flex-col gap-3 p-3">
        {hasMore && (
          <button
            type="button"
            onClick={handleLoadOlder}
            disabled={loadingOlder}
            className="self-center rounded-md border border-border px-2.5 py-0.5 text-xs text-muted hover:text-text disabled:opacity-50"
          >
            {loadingOlder ? t('chat.transcript.loadingOlder') : t('chat.transcript.loadOlder')}
          </button>
        )}
        {loading && ids.length === 0 && (
          <p role="status" className="flex items-center gap-1.5 text-xs text-muted">
            <Loader2 size={13} className="animate-spin motion-reduce:animate-none" />
            {t('chat.transcript.loading')}
          </p>
        )}
        {error && (
          <div role="alert" className="flex flex-col gap-1.5 text-xs text-danger">
            <p>{t('chat.transcript.loadError', { error })}</p>
            <button
              type="button"
              onClick={() => void loadConversation(conversationId, true)}
              className="w-fit rounded-md border border-border px-2 py-0.5 text-text hover:border-accent"
            >
              {t('common.retry')}
            </button>
          </div>
        )}
        {ids.map((id, i) => (
          <ChatMessageRow
            key={id}
            id={id}
            previousId={i > 0 ? ids[i - 1] : undefined}
            isLast={i === ids.length - 1}
            prKey={prKey}
          />
        ))}
      </div>
    </div>
  )
}
