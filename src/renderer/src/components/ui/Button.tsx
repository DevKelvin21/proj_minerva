import type { ComponentPropsWithRef, ReactNode } from 'react'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'warning' | 'link'
export type ButtonSize = 'xs' | 'sm' | 'md'

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-fg hover:bg-accent/90',
  secondary: 'border border-border bg-panel text-text hover:bg-border/60',
  ghost: 'text-muted hover:bg-border/60 hover:text-text',
  danger: 'bg-danger/15 text-danger hover:bg-danger/25',
  warning: 'border border-warning/50 bg-warning/15 text-text hover:bg-warning/25',
  link: 'text-accent underline-offset-2 hover:underline',
}

const sizeClasses: Record<ButtonSize, string> = {
  xs: 'h-6 gap-1 px-2 text-xs',
  sm: 'h-7 gap-1.5 px-2.5 text-xs',
  md: 'h-8 gap-1.5 px-3 text-sm',
}

// A link has no box: it sits in a line of text, so it takes no height or padding.
const linkSizeClasses: Record<ButtonSize, string> = {
  xs: 'gap-1 text-xs',
  sm: 'gap-1 text-xs',
  md: 'gap-1.5 text-sm',
}

interface ButtonProps extends ComponentPropsWithRef<'button'> {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Leading icon; decorative (the text is the label). */
  icon?: ReactNode
}

/**
 * Text button in one of six roles. Primary is the one action of a surface
 * (Send, Add to chat); secondary sits beside it; ghost is for quiet actions
 * in a list or toolbar; danger confirms something destructive; warning is an
 * action a notice asks for (Update a stale analysis); link is a
 * small secondary action inside or under a line of text (Reset, Restart now).
 */
export function Button({
  variant = 'secondary',
  size = 'sm',
  icon,
  className = '',
  type = 'button',
  children,
  ...rest
}: ButtonProps): React.JSX.Element {
  return (
    <button
      type={type}
      className={`inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-md font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40 aria-disabled:cursor-not-allowed aria-disabled:opacity-40 ${variantClasses[variant]} ${variant === 'link' ? linkSizeClasses[size] : sizeClasses[size]} ${className}`}
      {...rest}
    >
      {icon}
      {children}
    </button>
  )
}
