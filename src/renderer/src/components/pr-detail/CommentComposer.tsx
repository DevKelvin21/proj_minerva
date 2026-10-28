import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Lightbulb } from 'lucide-react'
import { buildSuggestionBlock, insertSuggestion } from '../../lib/suggestions'
import { errorText } from '../../lib/error-text'
import { Button } from '../ui/Button'
import { TextArea } from '../ui/TextArea'

/** How the composer gets the lines a suggestion starts from, or why it can't. */
export type SuggestionSource =
  { kind: 'lines'; load: () => Promise<string[]> } | { kind: 'disabled'; reason: string }

/**
 * Text to add to the draft (an AI answer) without losing what was typed:
 * appended after the current draft (or filling an empty one), then the box
 * is focused. `token` tells one request from the next.
 */
export interface AppendRequest {
  text: string
  token: number
}

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
  /** Starting text (an AI answer the reviewer turns into a comment): the box grows to show it. */
  initialValue?: string
  appendRequest?: AppendRequest
  /** Called once `appendRequest` is in the box (the parent drops it). */
  onAppendApplied?: (token: number) => void
  className?: string
}

function toErrorMessage(error: unknown): string {
  return errorText(error)
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
  initialValue = '',
  appendRequest,
  onAppendApplied,
}: CommentComposerProps): React.JSX.Element {
  const { t } = useTranslation()
  const [draft, setDraft] = useState(initialValue)
  const [posting, setPosting] = useState(false)
  const [inserting, setInserting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  // A prefilled draft (an AI answer) is shown whole, not hidden in two rows.
  const [rows, setRows] = useState(() => draftRows(initialValue))

  // An appended answer goes in while rendering (no extra pass); the caret
  // and the hand-back to the parent wait for the commit.
  const [appliedToken, setAppliedToken] = useState<number | null>(null)
  if (appendRequest && appendRequest.token !== appliedToken) {
    const next = draft.trim() ? draft.trimEnd() + '\n\n' + appendRequest.text : appendRequest.text
    setAppliedToken(appendRequest.token)
    setDraft(next)
    setRows((current) => Math.max(current, draftRows(next)))
  }
  const appendToken = appendRequest?.token
  useEffect(() => {
    if (appendToken === undefined) return
    const textarea = textareaRef.current
    if (textarea) {
      textarea.focus()
      textarea.setSelectionRange(textarea.value.length, textarea.value.length)
    }
    onAppendApplied?.(appendToken)
  }, [appendToken, onAppendApplied])

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
      // Commit the text and place the caret in the same task: a deferred
      // (rAF) caret move could land after the user's next keystrokes.
      flushSync(() => setDraft(text))
      textareaRef.current?.focus()
      textareaRef.current?.setSelectionRange(caret, caret)
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
      <TextArea
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
        rows={rows}
        placeholder={placeholder}
        fieldSize="lg"
        className="resize-y"
      />
      {error && <p className="text-xs text-danger">{error}</p>}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {suggestion && (
          <Button
            onClick={() => void handleInsertSuggestion()}
            disabled={posting || inserting || suggestion.kind === 'disabled'}
            title={
              suggestion.kind === 'disabled'
                ? suggestion.reason
                : t('comments.composer.insertSuggestionTitle')
            }
            className="mr-auto"
            icon={<Lightbulb size={12} aria-hidden />}
          >
            {inserting ? t('comments.composer.loadingLines') : t('comments.composer.insertSuggestion')}
          </Button>
        )}
        {onCancel && (
          <Button variant="ghost" onClick={onCancel} disabled={posting}>
            {t('common.cancel')}
          </Button>
        )}
        <Button type="submit" variant="primary" disabled={posting || draft.trim().length === 0}>
          {posting ? t('comments.composer.posting') : submitLabel}
        </Button>
      </div>
    </form>
  )
}

/** Rows that show a draft whole: 2 when empty, up to 14. */
function draftRows(text: string): number {
  if (!text) return 2
  return Math.min(14, Math.max(4, text.split('\n').length + 1))
}
