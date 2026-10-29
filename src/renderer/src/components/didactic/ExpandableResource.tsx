import type { ReactNode } from 'react'
import { ExpandButton } from './ExpandButton'

interface ExpandableResourceProps {
  label: string
  onExpand: () => void
  children: ReactNode
}

/**
 * A Mermaid diagram with its expand control (`ExpandButton`, the same one as
 * sections and snippets) pinned to the top-right corner, always visible. It
 * opens the `ResourceViewer` (`./ResourceViewer.tsx`) with that resource.
 * Snippets carry their own button in their header (an overlay there would
 * cover "Copy").
 */
export function ExpandableResource({
  label,
  onExpand,
  children,
}: ExpandableResourceProps): React.JSX.Element {
  return (
    <div className="relative min-w-0">
      {children}
      <ExpandButton
        label={label}
        onExpand={onExpand}
        className="absolute top-1 right-1 bg-panel/85"
      />
    </div>
  )
}
