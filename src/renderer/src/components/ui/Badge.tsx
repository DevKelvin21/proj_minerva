import type { ReactNode } from 'react'

type BadgeTone = 'neutral' | 'accent' | 'success' | 'danger' | 'warning'

const toneClasses: Record<BadgeTone, string> = {
  neutral: 'bg-border/60 text-muted',
  accent: 'bg-accent/15 text-accent',
  success: 'bg-success/15 text-success',
  danger: 'bg-danger/15 text-danger',
  warning: 'bg-warning/15 text-warning',
}

const sizeClasses = {
  sm: 'px-1.5 text-[10px] leading-4',
  md: 'px-2 py-0.5 text-xs',
}

interface BadgeProps {
  children: ReactNode
  tone?: BadgeTone
  icon?: ReactNode
  /** `sm` fits inside a chip or a dense row. */
  size?: keyof typeof sizeClasses
}

export function Badge({ children, tone = 'neutral', icon, size = 'md' }: BadgeProps): React.JSX.Element {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full font-medium ${sizeClasses[size]} ${toneClasses[tone]}`}
    >
      {icon}
      {children}
    </span>
  )
}
