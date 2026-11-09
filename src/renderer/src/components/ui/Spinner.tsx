import { Icon, type IconSize } from './Icon'
import { icons } from './icons'

interface SpinnerProps {
  size?: IconSize
  /**
   * Makes it a live `role="status"` region with this accessible name. Leave
   * it out when text next to it already says what is loading.
   */
  label?: string
  className?: string
}

/** The one loading spinner: muted, and still under reduced motion. */
export function Spinner({ size = 'sm', label, className = '' }: SpinnerProps): React.JSX.Element {
  const classes = `shrink-0 animate-spin text-muted motion-reduce:animate-none ${className}`
  if (label) {
    return (
      <span role="status" aria-label={label} className="inline-flex shrink-0">
        <Icon icon={icons.loading} size={size} className={classes} />
      </span>
    )
  }
  return <Icon icon={icons.loading} size={size} className={classes} />
}
