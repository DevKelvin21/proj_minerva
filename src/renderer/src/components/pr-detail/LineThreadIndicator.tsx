import { MessageSquare } from 'lucide-react'

interface LineThreadIndicatorProps {
  /** The line's threads are hidden (the user hid them from the card). */
  hidden: boolean
  count: number
  onClick: () => void
}

/**
 * Small icon in the gutter of a line that has comment threads. Threads show
 * under their line by default; the icon hides/shows them.
 */
export function LineThreadIndicator({
  hidden,
  count,
  onClick,
}: LineThreadIndicatorProps): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={hidden ? `Show comments on this line (${count})` : 'Hide comments on this line'}
      title={`${count} ${count === 1 ? 'comment' : 'comments'}`}
      className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded ${
        hidden ? 'text-muted hover:text-accent' : 'text-accent'
      }`}
    >
      <MessageSquare size={12} fill={hidden ? 'none' : 'currentColor'} />
    </button>
  )
}
