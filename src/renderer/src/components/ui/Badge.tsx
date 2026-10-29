import type { HTMLAttributes, ReactNode } from 'react'

export type BadgeTone =
  | 'neutral'
  | 'outline'
  | 'accent'
  | 'success'
  | 'danger'
  | 'warning'
  | 'info'
  | 'merged'

const toneClasses: Record<BadgeTone, string> = {
  neutral: 'bg-border/60 text-muted',
  // Quieter than neutral: a tag, a branch, a draft. An inset ring, so it keeps the same height.
  outline: 'text-muted ring-1 ring-inset ring-border',
  accent: 'bg-accent/15 text-accent',
  success: 'bg-success/15 text-success',
  danger: 'bg-danger/15 text-danger',
  warning: 'bg-warning/15 text-warning',
  info: 'bg-info/15 text-info',
  merged: 'bg-merged/15 text-merged',
}

const sizeClasses = {
  sm: 'px-1.5 text-[10px] leading-4',
  md: 'px-2 py-0.5 text-xs',
}

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  children: ReactNode
  tone?: BadgeTone
  icon?: ReactNode
  /** `sm` fits inside a chip or a dense row. */
  size?: keyof typeof sizeClasses
}

/** A status pill (draft, merged, orphaned…): static text, never a control. */
export function Badge({
  children,
  tone = 'neutral',
  icon,
  size = 'md',
  className = '',
  ...rest
}: BadgeProps): React.JSX.Element {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full font-medium ${sizeClasses[size]} ${toneClasses[tone]} ${className}`}
      {...rest}
    >
      {icon}
      {children}
    </span>
  )
}
