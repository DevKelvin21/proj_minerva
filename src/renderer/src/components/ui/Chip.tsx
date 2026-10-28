import type { ComponentPropsWithRef, ReactNode } from 'react'
import { CountBadge } from './CountBadge'

export type ChipSize = 'sm' | 'md'

const sizeClasses: Record<ChipSize, string> = {
  sm: 'gap-1 px-2 py-0.5 text-[11px]',
  md: 'gap-1.5 px-2.5 py-0.5 text-xs',
}

interface ChipProps extends ComponentPropsWithRef<'button'> {
  /**
   * Makes it a toggle (a filter, the picked file): `aria-pressed` follows it
   * and `true` paints the accent. Leave it out for a plain action chip.
   */
  selected?: boolean
  /** Leading icon; decorative (the text is the label). */
  icon?: ReactNode
  /**
   * Trailing count. Unlike a bare CountBadge it is part of the accessible
   * name ("Open 2"): the chip has no other place to say it.
   */
  count?: number
  /** `data-testid` of the count, for a test that reads it on its own. */
  countTestId?: string
  size?: ChipSize
}

/** Pill-shaped button for filters and pickable items in a row. */
export function Chip({
  selected,
  icon,
  count,
  countTestId,
  size = 'md',
  className = '',
  type = 'button',
  children,
  ...rest
}: ChipProps): React.JSX.Element {
  return (
    <button
      type={type}
      aria-pressed={selected}
      className={`inline-flex min-w-0 max-w-full items-center rounded-full border transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40 aria-disabled:cursor-not-allowed aria-disabled:opacity-40 ${sizeClasses[size]} ${
        selected
          ? 'border-accent/40 bg-accent/15 text-accent'
          : 'border-border bg-panel text-muted hover:border-accent/40 hover:text-text'
      } ${className}`}
      {...rest}
    >
      {icon}
      {children}
      {count !== undefined && (
        <CountBadge count={count} tone="neutral" aria-hidden={false} data-testid={countTestId} />
      )}
    </button>
  )
}
