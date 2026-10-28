import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Sparkles, X } from 'lucide-react'
import { MAX_CHAT_CONTEXT_ITEMS, MAX_CHAT_NOTE_LEN } from '../../../../shared/chat'
import type { LineSide } from '../../lib/line-threads'
import { Button } from '../ui/Button'
import { IconButton } from '../ui/IconButton'
import { Input } from '../ui/Input'

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
      className="border-y border-border bg-bg px-2 py-1.5 font-sans"
    >
      <form
        className="flex min-w-0 items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          add()
        }}
      >
        <Sparkles size={13} className="shrink-0 text-muted" aria-hidden />
        <Input
          autoFocus
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
          className="min-w-0 flex-1"
        />
        <Button type="submit" variant="primary" size="xs">
          {initialNote !== undefined ? t('chat.line.update') : t('chat.line.add')}
        </Button>
        <IconButton size="xs" onClick={onClose} label={t('common.close')} icon={<X size={13} />} />
      </form>
      {full && (
        <p role="alert" className="mt-1 text-xs text-danger">
          {t('chat.composer.full', { max: MAX_CHAT_CONTEXT_ITEMS })}
        </p>
      )}
    </div>
  )
}
