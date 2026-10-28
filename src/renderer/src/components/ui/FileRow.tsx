import type { ReactNode } from 'react'
import { DiffStat } from './DiffStat'

interface FileRowProps {
  /** Leading status icon. */
  icon: ReactNode
  /** What the row shows: the full path in flat lists, the basename in a tree. */
  name: string
  /** The full path, as the tooltip (the name is cut with an ellipsis). */
  path: string
  additions: number
  deletions: number
  selected: boolean
  onSelect: () => void
  /** Left padding in px (tree depth). */
  indent?: number
}

/**
 * One changed file as a full-width row button: icon, name, `+n −n`. Used by
 * the Files tab's tree and list and by the layers navigator. The focus ring
 * is drawn inside the row so the scrolling column does not clip it.
 */
export function FileRow({
  icon,
  name,
  path,
  additions,
  deletions,
  selected,
  onSelect,
  indent = 8,
}: FileRowProps): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected}
      title={path}
      style={{ paddingLeft: indent }}
      className={`flex w-full min-w-0 items-center gap-1.5 py-1 pr-2 text-left text-sm transition-colors duration-100 focus-visible:outline-offset-[-2px] ${
        selected ? 'bg-accent/15 text-text' : 'text-muted hover:bg-border/40 hover:text-text'
      }`}
    >
      {icon}
      <span className="min-w-0 truncate font-mono text-xs">{name}</span>
      <DiffStat additions={additions} deletions={deletions} className="ml-auto" />
    </button>
  )
}
