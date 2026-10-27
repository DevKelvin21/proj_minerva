import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Lightbulb } from 'lucide-react'
import { buildSuggestionBlock, insertSuggestion } from '../../lib/suggestions'

/** How the composer gets the lines a suggestion starts from, or why it can't. */
export type SuggestionSource =
  { kind: 'lines'; load: () => Promise<string[]> } | { kind: 'disabled'; reason: string }

interface CommentComposerProps {
  onSubmit: (bodyMarkdown: string) => Promise<void>
  onCancel?: () => void
  placeholder: string
  submitLabel: string
  /** Accessible name of the textarea. */
  label: string
  suggestion?: SuggestionSource
  autoFocus?: boolean
  /** Clear the draft after a successful submit (replies); a new-thread composer is unmounted instead. */
  clearOnSubmit?: boolean
  className?: string
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Comment composer shared by thread replies and new line comments: Markdown
 * textarea, "Insert suggestion" (a ```suggestion block prefilled with the
 * commented lines of the head file), Cmd/Ctrl+Enter to submit, and visible
 * posting/error states.
 */
export function CommentComposer({
  onSubmit,
  onCancel,
  placeholder,
  submitLabel,
  label,
  suggestion,
  autoFocus = false,
  clearOnSubmit = false,
  className = '',
}: CommentComposerProps): React.JSX.Element {
  const { t } = useTranslation()
  const [draft, setDraft] = useState('')
  const [posting, setPosting] = useState(false)
  const [inserting, setInserting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  async function submit(): Promise<void> {
    const bodyMarkdown = draft.trim()
    if (!bodyMarkdown || posting) return
    setPosting(true)
    setError(null)
    try {
      await onSubmit(bodyMarkdown)
      if (clearOnSubmit) {
        setDraft('')
        setPosting(false)
      }
    } catch (err: unknown) {
      setError(t('comments.composer.postError', { error: toErrorMessage(err) }))
      setPosting(false)
    }
  }

  async function handleInsertSuggestion(): Promise<void> {
    if (suggestion?.kind !== 'lines' || inserting) return
    setInserting(true)
    setError(null)
    try {
      const lines = await suggestion.load()
      const textarea = textareaRef.current
      const start = textarea?.selectionStart ?? draft.length
      const end = textarea?.selectionEnd ?? draft.length
      const { text, caret } = insertSuggestion(draft, buildSuggestionBlock(lines), start, end)
      setDraft(text)
      requestAnimationFrame(() => {
        textareaRef.current?.focus()
        textareaRef.current?.setSelectionRange(caret, caret)
      })
    } catch (err: unknown) {
      setError(t('comments.composer.suggestionLoadError', { error: toErrorMessage(err) }))
    } finally {
      setInserting(false)
    }
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
      className={`flex flex-col gap-2 ${className}`}
    >
      <textarea
        ref={textareaRef}
        autoFocus={autoFocus}
        aria-label={label}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            void submit()
          }
        }}
        disabled={posting}
        rows={2}
        placeholder={placeholder}
        className="min-w-0 resize-y rounded-md border border-border bg-bg px-2 py-1.5 font-sans text-sm text-text placeholder:text-muted focus:border-accent"
      />
      {error && <p className="text-xs text-danger">{error}</p>}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {suggestion && (
          <button
            type="button"
            onClick={() => void handleInsertSuggestion()}
            disabled={posting || inserting || suggestion.kind === 'disabled'}
            title={
              suggestion.kind === 'disabled'
                ? suggestion.reason
                : t('comments.composer.insertSuggestionTitle')
            }
            className="mr-auto inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted transition-colors hover:text-text disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Lightbulb size={12} />
            {inserting ? t('comments.composer.loadingLines') : t('comments.composer.insertSuggestion')}
          </button>
        )}
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={posting}
            className="rounded-md px-2.5 py-1 text-xs text-muted hover:text-text"
          >
            {t('common.cancel')}
          </button>
        )}
        <button
          type="submit"
          disabled={posting || draft.trim().length === 0}
          className="rounded-md border border-border bg-accent/90 px-2.5 py-1 text-xs font-medium text-bg transition-colors duration-150 hover:bg-accent disabled:cursor-not-allowed disabled:bg-border/40 disabled:text-muted"
        >
          {posting ? t('comments.composer.posting') : submitLabel}
        </button>
      </div>
    </form>
  )
}
