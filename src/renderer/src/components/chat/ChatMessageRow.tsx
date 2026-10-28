import { Loader2, RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ChatContextItem, ChatMessage } from '../../../../shared/chat'
import { useChatStore } from '../../stores/chat-store'
import { HarnessActivityLog } from '../didactic/HarnessActivityLog'
import { Markdown } from '../ui/Markdown'
import { AnswerActions } from './AnswerActions'
import { ContextChip } from './ContextChip'
import { Button } from '../ui/Button'

const NO_CONTEXT: ChatContextItem[] = []

interface ChatMessageRowProps {
  id: string
  /** The message before it (an answer's question: where "Use as…" can post). */
  previousId?: string
  /** Last of the conversation: only its failed answer can be retried. */
  isLast: boolean
  prKey: string
}

/**
 * One message of the transcript, selected by id: a streaming answer
 * re-renders only its own row.
 */
export function ChatMessageRow({
  id,
  previousId,
  isLast,
  prKey,
}: ChatMessageRowProps): React.JSX.Element | null {
  const message = useChatStore((s) => s.messages[id])
  if (!message) return null
  return message.role === 'user' ? (
    <UserMessage message={message} />
  ) : (
    <AssistantMessage message={message} previousId={previousId} isLast={isLast} prKey={prKey} />
  )
}

function UserMessage({ message }: { message: ChatMessage }): React.JSX.Element {
  return (
    <div
      data-testid="chat-message"
      data-role="user"
      className="flex max-w-[92%] flex-col gap-1.5 self-end rounded-lg border border-border bg-code-bg px-3 py-2"
    >
      {message.context.length > 0 && (
        <div className="flex flex-col gap-1">
          {message.context.map((item) => (
            <ContextChip key={item.id} item={item} />
          ))}
        </div>
      )}
      <p className="whitespace-pre-wrap break-words text-sm text-text">{message.text}</p>
    </div>
  )
}

function AssistantMessage({
  message,
  previousId,
  isLast,
  prKey,
}: {
  message: ChatMessage
  previousId?: string
  isLast: boolean
  prKey: string
}): React.JSX.Element {
  const { t } = useTranslation()
  const activity = useChatStore((s) => s.activity[message.id])
  const context = useChatStore((s) =>
    previousId ? (s.messages[previousId]?.context ?? NO_CONTEXT) : NO_CONTEXT,
  )
  const retry = useChatStore((s) => s.retry)
  const streaming = message.status === 'streaming'
  const settledWithoutAnswer =
    message.status === 'failed' || message.status === 'cancelled' || message.status === 'interrupted'

  return (
    <div
      data-testid="chat-message"
      data-role="assistant"
      data-status={message.status}
      className="flex min-w-0 flex-col gap-2"
    >
      {message.text ? (
        <div className="min-w-0 text-sm">
          <Markdown content={message.text} images={false} />
          {streaming && (
            <span
              aria-hidden
              className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-accent align-middle motion-reduce:animate-none"
            />
          )}
        </div>
      ) : (
        streaming && (
          <span role="status" className="flex items-center gap-1.5 text-xs text-muted">
            <Loader2 size={13} className="animate-spin text-accent motion-reduce:animate-none" />
            {t('chat.message.thinking')}
          </span>
        )
      )}
      {streaming && activity && <HarnessActivityLog items={activity} />}

      {settledWithoutAnswer && (
        <div className="flex flex-col gap-1.5">
          <p
            role={message.status === 'failed' ? 'alert' : undefined}
            className={`text-xs ${message.status === 'failed' ? 'text-danger' : 'text-muted'}`}
          >
            {message.status === 'failed'
              ? t('chat.message.failed', { error: message.error ?? t('common.unknownError') })
              : message.status === 'cancelled'
                ? t('chat.message.cancelled')
                : t('chat.message.interrupted')}
          </p>
          {isLast && (
            <Button
              size="xs"
              className="w-fit"
              icon={<RotateCcw size={12} aria-hidden />}
              onClick={() => void retry(prKey, message.conversationId)}
            >
              {t('chat.message.retry')}
            </Button>
          )}
        </div>
      )}

      {message.status === 'done' && message.text && (
        <AnswerActions text={message.text} context={context} />
      )}
    </div>
  )
}
