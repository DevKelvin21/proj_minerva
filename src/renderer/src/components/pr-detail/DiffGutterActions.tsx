import { useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Sparkles } from 'lucide-react'
import { rovingTarget } from '../../lib/roving-focus'
import { LineThreadIndicator } from './LineThreadIndicator'

/** "Add to chat" on this line (the sparkle). */
export interface GutterChat {
  /** The line has a chip in the chat draft (`aria-pressed`, stays lit). */
  pending: boolean
  /** Its note input is open under the row. */
  open: boolean
  onToggle: () => void
  /** `lineThreadKey` of the line: `DiffView` gives focus back here when the note input closes. */
  focusKey: string
}

interface DiffGutterActionsProps {
  /** The row's line on this side; absent = no action here (only the slots, so gutters line up). */
  line?: number
  /** The line has threads: their show/hide toggle takes the comment button's slot. */
  indicator?: { hidden: boolean; count: number; onClick: () => void }
  /** Opens the new-comment composer; absent = no comment button (threads, or no position). */
  onComment?: () => void
  /** Absent = no sparkle on this side. */
  chat?: GutterChat
  /** Reserve the sparkle's slot even without a button, so gutters line up. */
  chatSlot: boolean
}

const SLOT = 'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded'
/** Hidden until the row is hovered or the group holds focus. */
const REVEAL =
  'opacity-0 group-hover/row:opacity-100 group-focus-within/actions:opacity-100 focus:opacity-100'

/**
 * The gutter actions of one diff row (inline and split share it): the thread
 * toggle or "Comment", then "Add to chat". They show on the hovered or focused
 * row as one small group, and the group is ONE Tab stop: Left/Right (Home/End)
 * move between its buttons (WAI-ARIA toolbar pattern).
 */
export function DiffGutterActions({
  line,
  indicator,
  onComment,
  chat,
  chatSlot,
}: DiffGutterActionsProps): React.JSX.Element {
  const { t } = useTranslation()
  const [active, setActive] = useState(0)

  const buttons: Array<(tabIndex: 0 | -1, index: number) => React.ReactNode> = []
  if (indicator) {
    buttons.push((tabIndex, index) => (
      <LineThreadIndicator
        key="threads"
        hidden={indicator.hidden}
        count={indicator.count}
        onClick={indicator.onClick}
        tabIndex={tabIndex}
        onFocus={() => setActive(index)}
      />
    ))
  } else if (onComment && line !== undefined) {
    buttons.push((tabIndex, index) => (
      <button
        key="comment"
        type="button"
        onClick={onComment}
        tabIndex={tabIndex}
        onFocus={() => setActive(index)}
        aria-label={t('comments.line.addComment')}
        title={t('comments.line.addComment')}
        className={`${SLOT} ${REVEAL} text-muted hover:bg-border/60 hover:text-text`}
      >
        <Plus size={12} aria-hidden />
      </button>
    ))
  }
  const firstSlotFilled = buttons.length > 0
  if (chat && line !== undefined) {
    buttons.push((tabIndex, index) => (
      <button
        key="chat"
        type="button"
        onClick={chat.onToggle}
        tabIndex={tabIndex}
        onFocus={() => setActive(index)}
        aria-label={t('chat.line.button', { line })}
        title={chat.pending ? t('chat.line.buttonTitlePending') : t('chat.line.buttonTitle')}
        aria-pressed={chat.pending}
        aria-expanded={chat.open}
        data-pending={chat.pending || undefined}
        data-line-chat={chat.focusKey}
        className={`${SLOT} hover:bg-border/60 ${
          chat.pending
            ? 'text-accent'
            : chat.open
              ? 'text-text'
              : `${REVEAL} text-muted hover:text-text`
        }`}
      >
        <Sparkles size={11} aria-hidden />
      </button>
    ))
  }
  const current = Math.min(active, Math.max(buttons.length - 1, 0))

  function onKeyDown(event: KeyboardEvent<HTMLElement>): void {
    const target = rovingTarget(event.key, current, buttons.length, 'horizontal')
    if (target === null) return
    event.preventDefault()
    const next = event.currentTarget.querySelectorAll<HTMLElement>('button')[target]
    setActive(target)
    next?.focus()
  }

  const slots = (
    <>
      {firstSlotFilled ? null : <span className={SLOT} />}
      {buttons.map((render, index) => render(index === current ? 0 : -1, index))}
      {chatSlot && !(chat && line !== undefined) && <span className={SLOT} />}
    </>
  )

  // Transparent border at rest so the pill appears without moving the row.
  const frame =
    'inline-flex shrink-0 items-center gap-0.5 rounded border border-transparent transition-colors duration-100'
  if (line === undefined || buttons.length === 0) {
    return <span className={frame}>{slots}</span>
  }
  return (
    <span
      role="group"
      aria-label={t('prDetail.diff.lineActions', { line })}
      onKeyDown={onKeyDown}
      className={`group/actions ${frame} group-hover/row:border-border group-hover/row:bg-panel focus-within:border-border focus-within:bg-panel`}
    >
      {slots}
    </span>
  )
}
