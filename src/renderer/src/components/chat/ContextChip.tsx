import { Code2, MessageSquare, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ChatContextItem } from '../../../../shared/chat'
import { contextItemAuthor, contextItemLocation, diffSide } from '../../lib/chat-context'
import { useAppStore } from '../../stores/app-store'
import { widthTier } from '../../lib/layout'
import { Badge } from '../ui/Badge'
import { IconButton } from '../ui/IconButton'

interface ContextChipProps {
  item: ChatContextItem
  /** Composer chips can be removed; a sent message's cannot. */
  onRemove?: () => void
}

/** One line of preview: the note of a line (else its code), the first comment of a thread. */
function preview(item: ChatContextItem): string {
  const text = item.kind === 'line' ? item.note || item.code : (item.comments[0]?.body ?? '')
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * A context item as a chip (composer and sent user messages): what it points
 * at and a one-line preview. A PR-level thread reads "General comment ·
 * author". Clicking the location jumps to that line or thread (Files tab; a
 * general comment in the Conversation tab); on the narrowest tier the panel
 * (an overlay there) closes so the review shows.
 */
export function ContextChip({ item, onRemove }: ContextChipProps): React.JSX.Element {
  const { t } = useTranslation()
  const location =
    contextItemLocation(item) ??
    t('chat.chip.general', { author: item.kind === 'thread' ? contextItemAuthor(item) : '' })
  // The file name and lines fit a narrow panel; the full path is in the tooltip.
  const short = item.path === undefined ? location : location.slice(item.path.lastIndexOf('/') + 1)
  const label =
    item.kind === 'line'
      ? item.side === 'old'
        ? t('chat.chip.lineOld', { location: short })
        : short
      : item.path === undefined
        ? location
        : t('chat.chip.thread', { location: short })
  const text = preview(item)

  function jump(): void {
    const app = useAppStore.getState()
    if (item.kind === 'line') app.jumpToLine(item.path, diffSide(item.side), item.line)
    else if (item.path === undefined) app.openConversationThread(item.threadId)
    else app.openLineThread(item.path, item.startLine ?? 0, item.threadId)
    if (widthTier(window.innerWidth) === 'sm' && app.didacticPanelOpen) app.toggleDidacticPanel()
  }

  return (
    <div
      data-testid="chat-chip"
      data-kind={item.kind === 'thread' && item.path === undefined ? 'general' : item.kind}
      className="flex min-w-0 items-center gap-1.5 rounded-md border border-border bg-bg px-2 py-1 text-xs"
    >
      {item.kind === 'line' ? (
        <Code2 size={12} className="shrink-0 text-muted" aria-hidden />
      ) : (
        <MessageSquare size={12} className="shrink-0 text-muted" aria-hidden />
      )}
      <button
        type="button"
        onClick={jump}
        title={t('chat.chip.jump', { location })}
        className={`min-w-0 max-w-[75%] shrink-0 truncate text-text hover:underline ${
          item.path === undefined ? '' : 'font-mono'
        }`}
      >
        {label}
      </button>
      {item.kind === 'thread' && item.outdated && (
        <Badge tone="warning" size="sm">
          {t('chat.chip.outdated')}
        </Badge>
      )}
      {text && (
        <span className="min-w-0 flex-1 truncate text-muted" title={text}>
          {text}
        </span>
      )}
      {onRemove && (
        <IconButton
          size="xs"
          onClick={onRemove}
          label={t('chat.chip.remove', { location })}
          icon={<X size={12} />}
          className="ml-auto"
        />
      )}
    </div>
  )
}
