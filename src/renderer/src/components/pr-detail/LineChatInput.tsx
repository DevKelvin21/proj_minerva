import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Sparkles, X } from 'lucide-react'
import { MAX_CHAT_CONTEXT_ITEMS, MAX_CHAT_NOTE_LEN } from '../../../../shared/chat'
import type { LineSide } from '../../lib/line-threads'

interface LineChatInputProps {
  line: number
  side: LineSide
  /** The note of the line's chip, when it already has one (editing it). */
  initialNote?: string
  /** Adds the line with `note` to the chat draft; `false` when the draft is full. */
  onAdd: (note: string) => boolean
  onClose: () => void
}

/**
 * One-line input under a diff line (its gutter sparkle): an optional note for
 * the AI, then Enter (or "Add to chat") puts the line in the side panel's
 * chat draft as a chip and closes. Nothing is asked yet: the reviewer can
 * gather several lines and threads, then ask once from the panel. Esc closes.
 */
export function LineChatInput({
  line,
  side,
  initialNote,
  onAdd,
  onClose,
}: LineChatInputProps): React.JSX.Element {
  const { t } = useTranslation()
  const [note, setNote] = useState(initialNote ?? '')
  const [full, setFull] = useState(false)

  function add(): void {
    if (!onAdd(note)) setFull(true)
  }

  const label =
    side === 'LEFT' ? t('chat.line.inputLabelOld', { line }) : t('chat.line.inputLabel', { line })

  return (
    <div
      data-testid="line-chat-input"
      className="border-y border-accent/30 bg-bg px-2 py-1.5 font-sans"
    >
      <form
        className="flex min-w-0 items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          add()
        }}
      >
        <Sparkles size={13} className="shrink-0 text-accent" aria-hidden />
        <input
          autoFocus
          type="text"
          value={note}
          maxLength={MAX_CHAT_NOTE_LEN}
          onChange={(event) => {
            setNote(event.target.value)
            setFull(false)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              onClose()
            }
          }}
          aria-label={label}
          placeholder={t('chat.line.placeholder')}
          className="min-w-0 flex-1 rounded-md border border-border bg-panel px-2 py-1 text-sm text-text placeholder:text-muted focus:border-accent"
        />
        <button
          type="submit"
          className="shrink-0 rounded-md bg-accent px-2.5 py-1 text-xs font-semibold text-accent-fg"
        >
          {initialNote !== undefined ? t('chat.line.update') : t('chat.line.add')}
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('common.close')}
          title={t('common.close')}
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted hover:bg-border/60 hover:text-text"
        >
          <X size={14} />
        </button>
      </form>
      {full && (
        <p role="alert" className="mt-1 text-xs text-danger">
          {t('chat.composer.full', { max: MAX_CHAT_CONTEXT_ITEMS })}
        </p>
      )}
    </div>
  )
}
