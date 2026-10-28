import type { HTMLAttributes } from 'react'
import { formatCount } from '../../lib/format-count'

export type CountBadgeTone = 'accent' | 'warning' | 'neutral'

const toneClasses: Record<CountBadgeTone, string> = {
  accent: 'bg-accent text-accent-fg',
  warning: 'bg-warning text-bg',
  neutral: 'bg-border/60 text-muted',
}

interface CountBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  count: number
  tone?: CountBadgeTone
  /** Pinned to the top-right corner of a `relative` icon button (the rail). */
  overlay?: boolean
}

/**
 * A small count next to a tab, a section title or on an icon. Hidden from
 * screen readers by default: the control it sits on says the count in words
 * ("Inbox: 3 unread"), so the bare number would be read twice.
 */
export function CountBadge({
  count,
  tone = 'accent',
  overlay = false,
  className = '',
  ...rest
}: CountBadgeProps): React.JSX.Element {
  return (
    <span
      aria-hidden
      className={`inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-none tabular-nums ${toneClasses[tone]} ${
        overlay ? 'absolute right-0.5 top-0.5 ring-2 ring-panel' : ''
      } ${className}`}
      {...rest}
    >
      {formatCount(count)}
    </span>
  )
}
