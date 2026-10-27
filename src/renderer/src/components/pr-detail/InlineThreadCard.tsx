import { EyeOff } from 'lucide-react'
import type { CommentThread } from '../../../../shared/types'
import { ThreadCard } from './ThreadCard'

interface InlineThreadCardProps {
  thread: CommentThread
  highlighted: boolean
  /** Hides the threads of this line (the gutter icon shows them again). */
  onHide: () => void
}

/**
 * A line thread under the diff row it belongs to (`SplitDiff`/`InlineDiff`).
 * Carries the `thread-<id>` anchor `DiffView` scrolls to when the user jumps
 * here from the Comments view or a `path:line` chip.
 */
export function InlineThreadCard({
  thread,
  highlighted,
  onHide,
}: InlineThreadCardProps): React.JSX.Element {
  return (
    <div id={`thread-${thread.id}`} className="border-y border-border bg-bg px-2 py-2 font-sans">
      <ThreadCard
        thread={thread}
        showPath={false}
        highlighted={highlighted}
        extraHeaderContent={
          <button
            type="button"
            onClick={onHide}
            aria-label="Hide comments on this line"
            title="Hide comments on this line (the gutter icon shows them again)"
            className="inline-flex h-5 w-5 items-center justify-center rounded text-muted hover:text-text"
          >
            <EyeOff size={13} />
          </button>
        }
      />
    </div>
  )
}
