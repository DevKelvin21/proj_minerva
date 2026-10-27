import { useState } from 'react'
import { Loader2, MessageSquarePlus, Sparkles, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { LineAnswer } from '../../../../shared/types'
import { MAX_LINE_QUESTION_LEN } from '../../../../shared/types'
import { errorText } from '../../lib/error-text'
import { followUpQuestion } from '../../lib/ask-ai'
import { MOD_KEY_LABEL } from '../../lib/platform'
import { Markdown } from '../ui/Markdown'

interface AskAiCardProps {
  line: number
  side: 'LEFT' | 'RIGHT'
  onAsk: (question: string) => Promise<LineAnswer>
  /** Turns the answer into a new comment on this line, opened for editing first. */
  onUseAsComment: (markdown: string) => void
  onClose: () => void
}

interface Exchange {
  question: string
  answer: LineAnswer
}

/**
 * "Ask AI" under one diff line: the reviewer asks, the same jailed agent as
 * the analysis reads the code at the PR commit and answers here. Nothing is
 * posted: "Use as comment" opens the line's comment composer with the answer
 * as a draft the reviewer edits. Each question is its own run (no hidden
 * conversation), so a follow-up carries the previous answer in its text.
 */
export function AskAiCard({
  line,
  side,
  onAsk,
  onUseAsComment,
  onClose,
}: AskAiCardProps): React.JSX.Element {
  const { t } = useTranslation()
  const [question, setQuestion] = useState('')
  const [asking, setAsking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [exchange, setExchange] = useState<Exchange | null>(null)

  async function ask(): Promise<void> {
    const text = question.trim()
    if (!text || asking) return
    // A follow-up quotes the last answer: each run starts fresh in main.
    const full = exchange
      ? followUpQuestion(
          (question, answer, followUp) =>
            t('comments.askAi.followUpContext', { question, answer, followUp }),
          { question: exchange.question, answer: exchange.answer.markdown },
          text,
          MAX_LINE_QUESTION_LEN,
        )
      : text
    setAsking(true)
    setError(null)
    try {
      const answer = await onAsk(full)
      setExchange({ question: text, answer })
      setQuestion('')
    } catch (err: unknown) {
      setError(t('comments.askAi.failed', { error: errorText(err) }))
    } finally {
      setAsking(false)
    }
  }

  return (
    <div
      data-testid="ask-ai-card"
      className="border-y border-accent/30 bg-bg px-2 py-2 font-sans"
    >
      <div className="flex flex-col overflow-hidden rounded-md border border-accent/40 bg-panel shadow-sm">
        <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs text-muted">
          <Sparkles size={13} className="shrink-0 text-accent" aria-hidden />
          <span className="font-medium text-text">
            {side === 'LEFT'
              ? t('comments.askAi.titleOld', { line })
              : t('comments.askAi.title', { line })}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('comments.askAi.close')}
            title={t('comments.askAi.close')}
            className="ml-auto inline-flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-border/60 hover:text-text"
          >
            <X size={14} />
          </button>
        </div>

        {exchange && (
          <div className="flex flex-col gap-2 border-b border-border px-3 py-2.5">
            <p className="text-xs text-muted">
              {t('comments.askAi.youAsked')}{' '}
              <span className="text-text">{exchange.question}</span>
            </p>
            <div data-testid="ask-ai-answer" className="rounded-md bg-accent/10 px-3 py-2 text-sm">
              <Markdown content={exchange.answer.markdown} images={false} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => onUseAsComment(exchange.answer.markdown)}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-text transition-colors duration-150 hover:border-accent"
              >
                <MessageSquarePlus size={13} aria-hidden />
                {t('comments.askAi.useAsComment')}
              </button>
              <span className="text-[11px] text-muted">{t('comments.askAi.private')}</span>
            </div>
          </div>
        )}

        <form
          className="flex flex-col gap-2 px-3 py-2.5"
          onSubmit={(event) => {
            event.preventDefault()
            void ask()
          }}
        >
          <textarea
            autoFocus
            rows={2}
            value={question}
            maxLength={MAX_LINE_QUESTION_LEN}
            disabled={asking}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                void ask()
              } else if (event.key === 'Escape') {
                event.preventDefault()
                event.stopPropagation()
                onClose()
              }
            }}
            aria-label={t('comments.askAi.inputLabel', { line })}
            placeholder={exchange ? t('comments.askAi.followUpPlaceholder') : t('comments.askAi.placeholder')}
            className="w-full resize-y rounded-md border border-border bg-bg px-2.5 py-1.5 text-sm text-text placeholder:text-muted focus:border-accent"
          />
          {error && (
            <p role="alert" className="text-xs text-danger">
              {error}
            </p>
          )}
          <div className="flex items-center gap-2">
            {asking && (
              <span className="flex items-center gap-1.5 text-xs text-muted" role="status">
                <Loader2 size={13} className="animate-spin text-accent motion-reduce:animate-none" />
                {t('comments.askAi.thinking')}
              </span>
            )}
            <span className="ml-auto text-[11px] text-muted">
              {t('comments.askAi.submitHint', { shortcut: MOD_KEY_LABEL + '↵' })}
            </span>
            <button
              type="submit"
              disabled={asking || question.trim().length === 0}
              className="rounded-md bg-accent px-3 py-1 text-xs font-semibold text-accent-fg transition-opacity duration-150 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t('comments.askAi.ask')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
