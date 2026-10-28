interface SkeletonProps {
  /** Height (and any width or margin) of the block, e.g. `h-10`. */
  className?: string
}

/** One placeholder block for content that is on its way. Decorative. */
export function Skeleton({ className = '' }: SkeletonProps): React.JSX.Element {
  return (
    <div
      aria-hidden
      className={`animate-pulse rounded-md border border-border bg-border/20 motion-reduce:animate-none ${className}`}
    />
  )
}
