import { EyeOff } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { CommentThread } from '../../../../shared/types'
import { ThreadCard } from './ThreadCard'
import { IconButton } from '../ui/IconButton'

interface InlineThreadCardProps {
  thread: CommentThread
  highlighted: boolean
  /** Hides the threads of this line (the gutter icon shows them again); absent = no hide button. */
  onHide?: () => void
  /**
   * `line` (default): under its diff row, folded to its header.
   * `above`: in the list above the diff for threads no row can host, with
   * the code it points at, folded only when no longer open.
   */
  placement?: 'line' | 'above'
}

/**
 * A thread in the diff: under the row it belongs to (`SplitDiff`/`InlineDiff`)
 * or above the diff when no row can host it (`DiffView`). Carries the
 * `thread-<id>` anchor `DiffView` scrolls to when the user jumps here from
 * the Comments view, a `path:line` chip or the chat.
 *
 * Under a row, every thread starts folded to its one-line header (author,
 * first words, status) so the code reads as code; one click opens it. The
 * focused thread (jumped to, or just created) opens by itself (`highlighted`).
 * The AI-chat toggle and "Use as reply" live in `ThreadCard` (every view has them).
 */
export function InlineThreadCard({
  thread,
  highlighted,
  onHide,
  placement = 'line',
}: InlineThreadCardProps): React.JSX.Element {
  const { t } = useTranslation()

  return (
    // Under a row its frame is the diff's `DiffInsertRow`.
    <div id={`thread-${thread.id}`}>
      <ThreadCard
        thread={thread}
        collapsedByDefault={placement === 'line' ? true : undefined}
        showPath={false}
        showExcerpt={placement === 'above'}
        highlighted={highlighted}
        extraHeaderContent={
          onHide && (
            <IconButton
              size="xs"
              onClick={onHide}
              label={t('comments.line.hideComments')}
              title={t('comments.line.hideCommentsTitle')}
              icon={<EyeOff size={12} />}
            />
          )
        }
      />
    </div>
  )
}
