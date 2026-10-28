import { Loader2 } from 'lucide-react'

interface SpinnerProps {
  size?: number
  /**
   * Makes it a live `role="status"` region with this accessible name. Leave
   * it out when text next to it already says what is loading.
   */
  label?: string
  className?: string
}

/** The one loading spinner: muted, and still under reduced motion. */
export function Spinner({ size = 14, label, className = '' }: SpinnerProps): React.JSX.Element {
  const classes = `shrink-0 animate-spin text-muted motion-reduce:animate-none ${className}`
  if (label) {
    return (
      <span role="status" aria-label={label} className="inline-flex shrink-0">
        <Loader2 size={size} className={classes} aria-hidden />
      </span>
    )
  }
  return <Loader2 size={size} className={classes} aria-hidden />
}
