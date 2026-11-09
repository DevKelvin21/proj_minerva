import { ICON_PX, ICON_STROKE, type IconGlyph, type IconSize } from './icons'

export type { IconSize }

interface IconProps {
  /** A glyph from `icons` (`./icons.ts`). */
  icon: IconGlyph
  size?: IconSize
  className?: string
  /** Fills the shape with `currentColor` (a solid stop square, a filled thread marker). */
  filled?: boolean
  /** Decorative by default; pass `aria-label` (and `role`) when the icon alone says something. */
  'aria-hidden'?: boolean
  'aria-label'?: string
  role?: string
}

/**
 * Every UI icon goes through here: one of four sizes, one stroke weight, and
 * `currentColor` (the color comes from the text around it or `className`).
 */
export function Icon({
  icon: Glyph,
  size = 'sm',
  className,
  filled = false,
  'aria-hidden': ariaHidden,
  'aria-label': ariaLabel,
  role,
}: IconProps): React.JSX.Element {
  const labelled = ariaLabel !== undefined
  return (
    <Glyph
      size={ICON_PX[size]}
      strokeWidth={ICON_STROKE}
      absoluteStrokeWidth
      fill={filled ? 'currentColor' : 'none'}
      className={className}
      aria-hidden={ariaHidden ?? !labelled}
      aria-label={ariaLabel}
      role={role ?? (labelled ? 'img' : undefined)}
    />
  )
}
