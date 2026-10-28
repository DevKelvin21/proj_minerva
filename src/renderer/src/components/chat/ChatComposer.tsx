import { ArrowUp, Square } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { MAX_CHAT_CONTEXT_ITEMS, MAX_CHAT_MESSAGE_LEN } from '../../../../shared/chat'
import type { RepoRef } from '../../../../shared/scm'
import { isConversationBusy, useChatDraft, useChatStore } from '../../stores/chat-store'
import { ContextChip } from './ContextChip'
import { IconButton } from '../ui/IconButton'
import { TextArea } from '../ui/TextArea'

interface ChatComposerProps {
  repo: RepoRef
  number: number
  prKey: string
  /** The open conversation (`null` = sending starts a new one). */
  conversationId: string | null
}

/**
 * Bottom of the Ask tab: the context gathered from the diff (stacked chips,
 * removable) and the question. Enter sends (Shift+Enter = new line;
 * Cmd/Ctrl+Enter sends too). While the conversation's answer is being
 * written the send button becomes Stop. The draft is per PR and survives
 * switching conversations or PRs for the session.
 */
export function ChatComposer({
  repo,
  number,
  prKey,
  conversationId,
}: ChatComposerProps): React.JSX.Element {
  const { t } = useTranslation()
  const draft = useChatDraft(prKey)
  const sending = useChatStore((s) => s.sending[prKey] ?? false)
  const busy = useChatStore((s) =>
    conversationId ? isConversationBusy(s, prKey, conversationId) : false,
  )
  const setDraftText = useChatStore((s) => s.setDraftText)
  const removeContextItem = useChatStore((s) => s.removeContextItem)
  const send = useChatStore((s) => s.send)
  const cancel = useChatStore((s) => s.cancel)

  const canSend = draft.text.trim().length > 0 && !sending && !busy

  function submit(): void {
    if (canSend) void send(repo, number)
  }

  return (
    <form
      data-testid="chat-composer"
      className="flex shrink-0 flex-col gap-1.5 border-t border-border p-2"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      {draft.items.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-[11px] text-muted">
            {t('chat.composer.contextCount', {
              count: draft.items.length,
              max: MAX_CHAT_CONTEXT_ITEMS,
            })}
          </span>
          <div className="flex max-h-40 flex-col gap-1 overflow-y-auto">
            {draft.items.map((item) => (
              <ContextChip
                key={item.id}
                item={item}
                onRemove={() => removeContextItem(prKey, item.id)}
              />
            ))}
          </div>
        </div>
      )}
      <div className="flex min-w-0 items-end gap-1.5 rounded-md border border-border bg-bg px-2 py-1.5 transition-colors duration-150 focus-within:border-accent focus-within:ring-1 focus-within:ring-accent/40">
        <TextArea
          bare
          autoGrow
          rows={2}
          value={draft.text}
          maxLength={MAX_CHAT_MESSAGE_LEN}
          onChange={(event) => setDraftText(prKey, event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
            if (event.shiftKey && !(event.metaKey || event.ctrlKey)) return
            event.preventDefault()
            submit()
          }}
          aria-label={t('chat.composer.label')}
          placeholder={
            conversationId ? t('chat.composer.followUpPlaceholder') : t('chat.composer.placeholder')
          }
          className="max-h-48 min-h-[2.5rem] flex-1 resize-none"
        />
        {busy && conversationId ? (
          <IconButton
            size="sm"
            onClick={() => void cancel(prKey, conversationId)}
            label={t('chat.composer.stop')}
            icon={<Square size={12} fill="currentColor" />}
          />
        ) : (
          <IconButton
            type="submit"
            size="sm"
            tone="primary"
            disabled={!canSend}
            label={t('chat.composer.send')}
            icon={<ArrowUp size={15} />}
          />
        )}
      </div>
      <p className="truncate text-[11px] text-muted">
        {busy ? t('chat.composer.busyHint') : t('chat.composer.hint')}
      </p>
    </form>
  )
}
