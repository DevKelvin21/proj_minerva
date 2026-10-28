import type { ComponentPropsWithRef, ReactNode } from 'react'

export type IconButtonSize = 'xs' | 'sm' | 'md'

const sizeClasses: Record<IconButtonSize, string> = {
  xs: 'h-5 w-5',
  sm: 'h-7 w-7',
  md: 'h-8 w-8',
}

interface IconButtonProps extends ComponentPropsWithRef<'button'> {
  icon: ReactNode
  label: string
  /**
   * Makes it a toggle: `aria-pressed` follows it and `true` paints the
   * accent. Leave it out for a plain action (close, copy, delete).
   */
  active?: boolean
  size?: IconButtonSize
  /** `primary` fills it with the accent: the one action of a surface (Send). */
  tone?: 'default' | 'primary'
}

/** Square icon button; `label` is its tooltip and accessible name. */
export function IconButton({
  icon,
  label,
  active,
  size = 'md',
  tone = 'default',
  className = '',
  ...rest
}: IconButtonProps): React.JSX.Element {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={`inline-flex shrink-0 items-center justify-center rounded-md border transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40 aria-disabled:cursor-not-allowed aria-disabled:opacity-40 ${sizeClasses[size]} ${
        tone === 'primary'
          ? 'border-transparent bg-accent text-accent-fg hover:bg-accent/90'
          : active
            ? 'border-accent/40 bg-accent/15 text-accent'
            : 'border-transparent text-muted hover:bg-border/60 hover:text-text'
      } ${className}`}
      {...rest}
    >
      {icon}
    </button>
  )
}
