import type { ReactNode } from 'react'
import { Icon } from './Icon'
import type { IconGlyph } from './icons'
import { Spinner } from './Spinner'

interface EmptyStateProps {
  title: string
  hint?: string
  /** A muted icon above the title (from `icons`). */
  icon?: IconGlyph
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
  icon,
  loading = false,
  action,
  compact = false,
}: EmptyStateProps): React.JSX.Element {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-2 px-6 text-center ${
        compact ? 'min-h-0 flex-1 overflow-y-auto' : 'h-full'
      }`}
    >
      {loading ? (
        <Spinner size="lg" />
      ) : (
        icon && <Icon icon={icon} size="lg" className="text-muted" />
      )}
      <p className={`font-medium text-text ${compact ? 'text-sm' : 'text-base'}`}>{title}</p>
      {hint && <p className={`max-w-xs text-muted ${compact ? 'text-xs' : 'text-sm'}`}>{hint}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}
