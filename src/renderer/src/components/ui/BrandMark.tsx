import { BRAND_MARK_SHAPES, BRAND_MARK_STROKE } from '../../../../shared/brand-mark'

/**
 * Minerva's mark (the merge owl), drawn in `currentColor` from the same
 * shapes as the app icon (`shared/brand-mark.ts`). Decorative: the app's name
 * sits next to it, so it is hidden from assistive tech.
 */
export function BrandMark({
  size = 16,
  className = '',
}: {
  size?: number
  className?: string
}): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={BRAND_MARK_STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      data-brand-mark=""
      className={'shrink-0 ' + className}
    >
      {BRAND_MARK_SHAPES.map((shape, index) =>
        shape.kind === 'path' ? (
          <path key={index} d={shape.d} />
        ) : (
          <circle
            key={index}
            cx={shape.cx}
            cy={shape.cy}
            r={shape.r}
            fill={shape.filled ? 'currentColor' : undefined}
            stroke={shape.filled ? 'none' : undefined}
          />
        ),
      )}
    </svg>
  )
}
