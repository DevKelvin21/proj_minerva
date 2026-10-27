import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation()
  const suggestion: SuggestionSource =
    side === 'RIGHT'
      ? { kind: 'lines', load: async () => [lineContent] }
      : {
          kind: 'disabled',
          reason: t('comments.line.suggestionOldSide'),
        }
  return (
    <div className="border-y border-border bg-bg px-2 py-2 font-sans">
      <CommentComposer
        autoFocus
        label={t('comments.line.commentOnLine', { line })}
        placeholder={
          side === 'LEFT'
            ? t('comments.line.placeholderOld', { line })
            : t('comments.line.placeholder', { line })
        }
        submitLabel={t('comments.line.submit')}
        suggestion={suggestion}
        onSubmit={onSubmit}
        onCancel={onCancel}
      />
    </div>
  )
}
