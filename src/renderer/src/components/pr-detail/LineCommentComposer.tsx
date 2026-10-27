import type { SuggestionSource } from './CommentComposer'
import { CommentComposer } from './CommentComposer'

interface LineCommentComposerProps {
  line: number
  side: 'LEFT' | 'RIGHT'
  /** Content of the line, for "Insert suggestion" (RIGHT side only). */
  lineContent: string
  onSubmit: (bodyMarkdown: string) => Promise<void>
  onCancel: () => void
}

/**
 * Composer for a NEW thread on one line of the diff (no `threadId`, unlike a
 * reply). Opens under the row from the gutter "+" button.
 */
export function LineCommentComposer({
  line,
  side,
  lineContent,
  onSubmit,
  onCancel,
}: LineCommentComposerProps): React.JSX.Element {
  const suggestion: SuggestionSource =
    side === 'RIGHT'
      ? { kind: 'lines', load: async () => [lineContent] }
      : {
          kind: 'disabled',
          reason: 'Suggestions change the new version of the file; this line is on the old one.',
        }
  return (
    <div className="border-y border-border bg-bg px-2 py-2 font-sans">
      <CommentComposer
        autoFocus
        label={`Comment on line ${line}`}
        placeholder={`Comment on line ${line}${side === 'LEFT' ? ' (old version)' : ''}…`}
        submitLabel="Comment"
        suggestion={suggestion}
        onSubmit={onSubmit}
        onCancel={onCancel}
      />
    </div>
  )
}
