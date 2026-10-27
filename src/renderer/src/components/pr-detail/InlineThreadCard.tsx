import { EyeOff } from 'lucide-react'
import { useTranslation } from 'react-i18next'
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
 *
 * Every thread starts folded to its one-line header (author, first words,
 * status) so the code reads as code; one click opens it. The focused thread
 * (jumped to, or just created) opens by itself (`highlighted`).
 */
export function InlineThreadCard({
  thread,
  highlighted,
  onHide,
}: InlineThreadCardProps): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div id={`thread-${thread.id}`} className="bg-bg px-2 py-1 font-sans">
      <ThreadCard
        thread={thread}
        collapsedByDefault
        showPath={false}
        highlighted={highlighted}
        extraHeaderContent={
          <button
            type="button"
            onClick={onHide}
            aria-label={t('comments.line.hideComments')}
            title={t('comments.line.hideCommentsTitle')}
            className="inline-flex h-5 w-5 items-center justify-center rounded text-muted hover:text-text"
          >
            <EyeOff size={13} />
          </button>
        }
      />
    </div>
  )
}
