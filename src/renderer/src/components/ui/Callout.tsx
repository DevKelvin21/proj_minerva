import type { HTMLAttributes, ReactNode } from 'react'
import { CircleAlert, Info, TriangleAlert, type LucideIcon } from 'lucide-react'

export type CalloutTone = 'warning' | 'danger' | 'info'

const toneClasses: Record<CalloutTone, { border: string; bg: string; icon: string }> = {
  warning: { border: 'border-warning/40', bg: 'bg-warning/10', icon: 'text-warning' },
  danger: { border: 'border-danger/40', bg: 'bg-danger/10', icon: 'text-danger' },
  info: { border: 'border-info/40', bg: 'bg-info/10', icon: 'text-info' },
}

const defaultIcons: Record<CalloutTone, LucideIcon> = {
  warning: TriangleAlert,
  danger: CircleAlert,
  info: Info,
}

interface CalloutProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  tone: CalloutTone
  /** Leading icon in the tone's color; `null` hides it. Defaults per tone. */
  icon?: LucideIcon | null
  /** The message. */
  children: ReactNode
  /** Trailing control, usually a `Button size="xs"`; wraps under the text when narrow. */
  action?: ReactNode
  /**
   * `strip` is an edge-to-edge band at the top or bottom of a pane: no
   * radius and no side borders (pass `border-b` or `border-t`).
   */
  variant?: 'box' | 'strip'
}

/**
 * A tinted notice: something is stale, partial or failed and the reviewer
 * may act on it. Pass `role="alert"` when it reports a failure and
 * `role="status"` when it appears live; a notice shown from the start needs
 * neither.
 */
export function Callout({
  tone,
  icon,
  children,
  action,
  variant = 'box',
  className = '',
  ...rest
}: CalloutProps): React.JSX.Element {
  const Icon = icon === undefined ? defaultIcons[tone] : icon
  const tones = toneClasses[tone]
  const shape = variant === 'strip' ? 'px-3 py-1.5' : `rounded-md border p-2.5 ${tones.border}`
  return (
    <div
      className={`flex min-w-0 items-start gap-2 text-xs text-text ${tones.bg} ${shape} ${className}`}
      {...rest}
    >
      {Icon && <Icon size={14} className={`mt-px shrink-0 ${tones.icon}`} aria-hidden />}
      <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <div className="min-w-0 flex-1 basis-48 break-words">{children}</div>
        {action && <div className="flex shrink-0 items-center gap-1.5">{action}</div>}
      </div>
    </div>
  )
}
