import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Spinner } from './Spinner'

interface EmptyStateProps {
  title: string
  hint?: string
  /** A muted icon above the title. */
  icon?: LucideIcon
  /** Shows a spinner in place of the icon: what goes here is on its way. */
  loading?: boolean
  /** One follow-up action (a Button), below the hint. */
  action?: ReactNode
  /** Smaller type and spacing, for a side panel instead of a whole pane. */
  compact?: boolean
}

/** What a pane says when it has nothing to show (yet). */
export function EmptyState({
  title,
  hint,
  icon: Icon,
  loading = false,
  action,
  compact = false,
}: EmptyStateProps): React.JSX.Element {
  const iconSize = compact ? 22 : 32
  return (
    <div
      className={`flex flex-col items-center justify-center gap-2 px-6 text-center ${
        compact ? 'min-h-0 flex-1 overflow-y-auto' : 'h-full'
      }`}
    >
      {loading ? (
        <Spinner size={iconSize} />
      ) : (
        Icon && <Icon size={iconSize} className="text-muted" aria-hidden />
      )}
      <p className={`font-medium text-text ${compact ? 'text-sm' : 'text-base'}`}>{title}</p>
      {hint && <p className={`max-w-xs text-muted ${compact ? 'text-xs' : 'text-sm'}`}>{hint}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}
