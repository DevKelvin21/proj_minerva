import { Icon } from '../ui/Icon'
import { icons } from '../ui/icons'
import { IconButton } from '../ui/IconButton'

interface ExpandButtonProps {
  /** Tooltip and accessible name ("Expand diagram", "Expand snippet", ...). */
  label: string
  onExpand: () => void
  /** Longer tooltip when the label alone does not say enough. */
  title?: string
  className?: string
}

/**
 * The one expand control of the analysis: same size and glyph on sections,
 * diagrams and snippets, always visible (it opens the `ResourceViewer`).
 */
export function ExpandButton({
  label,
  onExpand,
  title,
  className,
}: ExpandButtonProps): React.JSX.Element {
  return (
    <IconButton
      size="sm"
      onClick={onExpand}
      label={label}
      title={title ?? label}
      icon={<Icon icon={icons.expand} size="sm" />}
      className={className}
    />
  )
}
