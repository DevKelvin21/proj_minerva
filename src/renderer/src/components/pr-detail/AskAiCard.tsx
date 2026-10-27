import { useEffect, useRef, useState } from 'react'
import { Loader2, MessageSquarePlus, Reply, Sparkles, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { MAX_LINE_QUESTION_LEN } from '../../../../shared/types'
import { answerDraft } from '../../lib/ask-ai'
import { MOD_KEY_LABEL } from '../../lib/platform'
import {
  useAskAiStore,
  useAskConversation,
  type AskRunner,
  type AskSubject,
} from '../../stores/ask-ai-store'
import { Markdown } from '../ui/Markdown'

interface AskAiCardProps {
  /** The line or thread the conversation is about (its key in `ask-ai-store`). */
  subject: AskSubject
  title: string
  inputLabel: string
  placeholder: string
  /** One-click questions offered before the first exchange. */
  quickQuestions?: string[]
  onRun: AskRunner
  /** What an answer can become: a new comment on the line, or a reply to the thread. */
  useAs: 'comment' | 'reply'
  /** Opens the comment (or reply) composer with the answer as a draft to edit first (`answerDraft`). */
  onUse: (markdown: string) => void
  onClose: () => void
}

/**
 * "Ask AI" under a diff line or a comment thread: the reviewer asks, the same
 * jailed agent as the analysis reads the code at the PR commit and answers.
 * The whole conversation stays on screen and in `ask-ai-store` for the
 * session, so closing the card loses nothing; each follow-up carries the
 * earlier exchanges. Nothing is posted: "Use as comment / reply" opens a
 * composer with the answer as a draft the reviewer edits.
 */
export function AskAiCard({
  subject,
  title,
  inputLabel,
  placeholder,
  quickQuestions,
  onRun,
  useAs,
  onUse,
  onClose,
}: AskAiCardProps): React.JSX.Element {
  const { t } = useTranslation()
  const conversation = useAskConversation(subject)
  const ask = useAskAiStore((s) => s.ask)
  const clear = useAskAiStore((s) => s.clear)
  const dismissFailure = useAskAiStore((s) => s.dismissFailure)
  const [question, setQuestion] = useState('')
  const transcriptRef = useRef<HTMLDivElement>(null)

  const turns = conversation?.turns ?? []
  const pending = conversation?.pending ?? null
  const failed = conversation?.failed ?? null
  const hasTranscript = turns.length > 0 || pending !== null || failed !== null

  // Keep the newest exchange in view as the conversation grows.
  useEffect(() => {
    const el = transcriptRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [turns.length, pending, failed])

  function send(text: string): void {
    const trimmed = text.trim()
    if (!trimmed || pending !== null) return
    setQuestion('')
    void ask(subject, trimmed, onRun)
  }

  return (
    <div data-testid="ask-ai-card" className="border-y border-accent/30 bg-bg px-2 py-2 font-sans">
      <div className="flex flex-col overflow-hidden rounded-md border border-accent/40 bg-panel shadow-sm">
        <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs text-muted">
          <Sparkles size={13} className="shrink-0 text-accent" aria-hidden />
          <span className="min-w-0 truncate font-medium text-text">{title}</span>
          <span className="ml-auto flex shrink-0 items-center gap-1">
            {turns.length > 0 && (
              <button
                type="button"
                onClick={() => clear(subject)}
                disabled={pending !== null}
                title={t('comments.askAi.clearTitle')}
                className="rounded px-1.5 py-0.5 text-muted hover:bg-border/60 hover:text-text disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t('comments.askAi.clear')}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label={t('comments.askAi.close')}
              title={t('comments.askAi.close')}
              className="inline-flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-border/60 hover:text-text"
            >
              <X size={14} />
            </button>
          </span>
        </div>

        {hasTranscript && (
          <div
            ref={transcriptRef}
            data-testid="ask-ai-transcript"
            className="flex max-h-[min(60vh,32rem)] flex-col gap-3 overflow-y-auto border-b border-border px-3 py-2.5"
          >
            {turns.map((turn, i) => (
              <div key={i} data-testid="ask-ai-exchange" className="flex flex-col gap-2">
                <AskedLine question={turn.question} />
                <div
                  data-testid="ask-ai-answer"
                  className="rounded-md bg-accent/10 px-3 py-2 text-sm"
                >
                  <Markdown content={turn.answer.markdown} images={false} />
                </div>
                <div>
                  <button
                    type="button"
                    onClick={() => onUse(answerDraft(turn.answer.markdown))}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-text transition-colors duration-150 hover:border-accent"
                  >
                    {useAs === 'reply' ? (
                      <Reply size={13} aria-hidden />
                    ) : (
                      <MessageSquarePlus size={13} aria-hidden />
                    )}
                    {useAs === 'reply'
                      ? t('comments.askAi.useAsReply')
                      : t('comments.askAi.useAsComment')}
                  </button>
                </div>
              </div>
            ))}
            {pending !== null && (
              <div className="flex flex-col gap-2">
                <AskedLine question={pending} />
                <span className="flex items-center gap-1.5 text-xs text-muted" role="status">
                  <Loader2
                    size={13}
                    className="animate-spin text-accent motion-reduce:animate-none"
                  />
                  {t('comments.askAi.thinking')}
                </span>
              </div>
            )}
            {failed !== null && (
              <div className="flex flex-col gap-2">
                <AskedLine question={failed.question} />
                <p role="alert" className="text-xs text-danger">
                  {t('comments.askAi.failed', { error: failed.message })}
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void ask(subject, failed.question, onRun)}
                    className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-text hover:border-accent"
                  >
                    {t('comments.askAi.retry')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setQuestion(failed.question)
                      dismissFailure(subject)
                    }}
                    className="rounded-md px-2.5 py-1 text-xs text-muted hover:text-text"
                  >
                    {t('comments.askAi.edit')}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {!hasTranscript && quickQuestions && quickQuestions.length > 0 && (
          <div
            role="group"
            aria-label={t('comments.askAi.quickLabel')}
            className="flex flex-wrap gap-1.5 px-3 pt-2.5"
          >
            {quickQuestions.map((quick) => (
              <button
                key={quick}
                type="button"
                onClick={() => send(quick)}
                className="rounded-full border border-border px-2.5 py-0.5 text-xs text-text transition-colors duration-150 hover:border-accent hover:text-accent"
              >
                {quick}
              </button>
            ))}
          </div>
        )}

        <form
          className="flex flex-col gap-2 px-3 py-2.5"
          onSubmit={(event) => {
            event.preventDefault()
            send(question)
          }}
        >
          <textarea
            autoFocus
            rows={2}
            value={question}
            maxLength={MAX_LINE_QUESTION_LEN}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                send(question)
              } else if (event.key === 'Escape') {
                event.preventDefault()
                event.stopPropagation()
                onClose()
              }
            }}
            aria-label={inputLabel}
            placeholder={turns.length > 0 ? t('comments.askAi.followUpPlaceholder') : placeholder}
            className="w-full resize-y rounded-md border border-border bg-bg px-2.5 py-1.5 text-sm text-text placeholder:text-muted focus:border-accent"
          />
          <div className="flex items-center gap-2">
            {turns.length > 0 && (
              <span className="min-w-0 truncate text-[11px] text-muted">
                {t('comments.askAi.private')}
              </span>
            )}
            <span className="ml-auto shrink-0 text-[11px] text-muted">
              {t('comments.askAi.submitHint', { shortcut: MOD_KEY_LABEL + '↵' })}
            </span>
            <button
              type="submit"
              disabled={pending !== null || question.trim().length === 0}
              className="shrink-0 rounded-md bg-accent px-3 py-1 text-xs font-semibold text-accent-fg transition-opacity duration-150 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t('comments.askAi.ask')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function AskedLine({ question }: { question: string }): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <p className="whitespace-pre-wrap break-words text-xs text-muted">
      {t('comments.askAi.youAsked')} <span className="text-text">{question}</span>
    </p>
  )
}
