import { MessageSquare } from 'lucide-react'
import { useTranslation } from 'react-i18next'

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
  const { t } = useTranslation()
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={
        hidden ? t('comments.line.showComments', { count }) : t('comments.line.hideComments')
      }
      title={t('comments.thread.commentCount', { count })}
      className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded ${
        hidden ? 'text-muted hover:text-accent' : 'text-accent'
      }`}
    >
      <MessageSquare size={12} fill={hidden ? 'none' : 'currentColor'} />
    </button>
  )
}
