import { Code2, MessageSquare, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ChatContextItem } from '../../../../shared/chat'
import { contextItemLocation, diffSide } from '../../lib/chat-context'
import { useAppStore } from '../../stores/app-store'
import { widthTier } from '../../lib/layout'

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
 * at and a one-line preview. Clicking the location jumps to that line or
 * thread in the Files tab; on the narrowest tier the panel (an overlay
 * there) closes so the diff shows.
 */
export function ContextChip({ item, onRemove }: ContextChipProps): React.JSX.Element {
  const { t } = useTranslation()
  const location = contextItemLocation(item)
  // The file name and lines fit a narrow panel; the full path is in the tooltip.
  const short = location.slice(item.path.lastIndexOf('/') + 1)
  const label =
    item.kind === 'line'
      ? item.side === 'old'
        ? t('chat.chip.lineOld', { location: short })
        : short
      : t('chat.chip.thread', { location: short })
  const text = preview(item)

  function jump(): void {
    const app = useAppStore.getState()
    if (item.kind === 'line') app.jumpToLine(item.path, diffSide(item.side), item.line)
    else app.openLineThread(item.path, item.startLine ?? 0, item.threadId)
    if (widthTier(window.innerWidth) === 'sm' && app.didacticPanelOpen) app.toggleDidacticPanel()
  }

  return (
    <div
      data-testid="chat-chip"
      data-kind={item.kind}
      className="flex min-w-0 items-center gap-1.5 rounded-md border border-border bg-bg px-2 py-1 text-xs"
    >
      {item.kind === 'line' ? (
        <Code2 size={12} className="shrink-0 text-accent" aria-hidden />
      ) : (
        <MessageSquare size={12} className="shrink-0 text-accent" aria-hidden />
      )}
      <button
        type="button"
        onClick={jump}
        title={t('chat.chip.jump', { location })}
        className="min-w-0 max-w-[75%] shrink-0 truncate font-mono text-text hover:text-accent hover:underline"
      >
        {label}
      </button>
      {item.kind === 'thread' && item.outdated && (
        <span className="shrink-0 rounded bg-warning/15 px-1 text-[10px] text-warning">
          {t('chat.chip.outdated')}
        </span>
      )}
      {text && (
        <span className="min-w-0 flex-1 truncate text-muted" title={text}>
          {text}
        </span>
      )}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={t('chat.chip.remove', { location })}
          title={t('chat.chip.remove', { location })}
          className="ml-auto inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted hover:bg-border/60 hover:text-text"
        >
          <X size={11} />
        </button>
      )}
    </div>
  )
}
