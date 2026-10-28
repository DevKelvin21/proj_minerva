import { useState } from 'react'
import { Check, ChevronDown, Copy, MessageSquarePlus, Reply } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ChatContextItem } from '../../../../shared/chat'
import { answerDraft } from '../../lib/chat-draft'
import { contextItemLocation, diffSide } from '../../lib/chat-context'
import { widthTier } from '../../lib/layout'
import { useAppStore } from '../../stores/app-store'

interface AnswerActionsProps {
  /** The answer (Markdown). */
  text: string
  /** Context of the question it answers: where the answer can be posted from. */
  context: readonly ChatContextItem[]
}

interface Target {
  key: string
  kind: 'comment' | 'reply'
  location: string
  run: () => void
}

function targetsOf(context: readonly ChatContextItem[], text: string): Target[] {
  return context.map((item) => {
    const location = contextItemLocation(item)
    if (item.kind === 'line') {
      return {
        key: item.id,
        kind: 'comment' as const,
        location,
        run: () =>
          useAppStore.getState().openLineComposer(
            { path: item.path, side: diffSide(item.side), line: item.line, draft: answerDraft(text) },
            true,
          ),
      }
    }
    return {
      key: item.id,
      kind: 'reply' as const,
      location,
      run: () =>
        useAppStore.getState().requestThreadReply({
          threadId: item.threadId,
          path: item.path,
          line: item.startLine,
          text: answerDraft(text),
        }),
    }
  })
}

/**
 * Under a finished answer: copy it, or turn it into a draft where the
 * question pointed. A line of the question offers "Use as comment" (that
 * line's comment composer opens in the Files tab with the answer); a thread
 * offers "Use as reply" (its reply box gets the answer, after anything
 * typed). Several targets = a small menu. The text always goes through
 * `answerDraft` (no image or loading HTML survives) and nothing is posted.
 */
export function AnswerActions({ text, context }: AnswerActionsProps): React.JSX.Element {
  const { t } = useTranslation()
  const [menuOpen, setMenuOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const targets = targetsOf(context, text)

  function run(target: Target): void {
    setMenuOpen(false)
    target.run()
    // The panel is an overlay on the narrowest tier: get it out of the way of the draft.
    const app = useAppStore.getState()
    if (widthTier(window.innerWidth) === 'sm' && app.didacticPanelOpen) app.toggleDidacticPanel()
  }

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // No clipboard permission in this context: nothing sensible to fall back to.
    }
  }

  const buttonClass =
    'inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-0.5 text-xs font-medium text-text transition-colors duration-150 hover:border-accent'

  return (
    <div className="relative flex flex-wrap items-center gap-1.5">
      {targets.length === 1 && (
        <button
          type="button"
          onClick={() => run(targets[0])}
          title={
            targets[0].kind === 'comment'
              ? t('chat.answer.useAsCommentOn', { location: targets[0].location })
              : t('chat.answer.useAsReplyOn', { location: targets[0].location })
          }
          className={buttonClass}
        >
          {targets[0].kind === 'comment' ? (
            <MessageSquarePlus size={12} aria-hidden />
          ) : (
            <Reply size={12} aria-hidden />
          )}
          {targets[0].kind === 'comment' ? t('chat.answer.useAsComment') : t('chat.answer.useAsReply')}
        </button>
      )}
      {targets.length > 1 && (
        <>
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            className={buttonClass}
          >
            <MessageSquarePlus size={12} aria-hidden />
            {t('chat.answer.useAs')}
            <ChevronDown size={12} aria-hidden />
          </button>
          {menuOpen && (
            <div
              role="menu"
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  event.stopPropagation()
                  setMenuOpen(false)
                }
              }}
              className="absolute bottom-full left-0 z-20 mb-1 flex max-w-[min(22rem,100%)] flex-col overflow-hidden rounded-md border border-border bg-panel py-1 shadow-lg"
            >
              {targets.map((target) => (
                <button
                  key={target.key}
                  type="button"
                  role="menuitem"
                  onClick={() => run(target)}
                  className="flex min-w-0 items-center gap-1.5 px-2.5 py-1 text-left text-xs text-text hover:bg-border/60"
                >
                  {target.kind === 'comment' ? (
                    <MessageSquarePlus size={12} className="shrink-0" aria-hidden />
                  ) : (
                    <Reply size={12} className="shrink-0" aria-hidden />
                  )}
                  <span className="truncate">
                    {target.kind === 'comment'
                      ? t('chat.answer.useAsCommentOn', { location: target.location })
                      : t('chat.answer.useAsReplyOn', { location: target.location })}
                  </span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
      <button
        type="button"
        onClick={() => void copy()}
        aria-label={t('chat.answer.copy')}
        title={t('chat.answer.copy')}
        className="inline-flex h-5 w-5 items-center justify-center rounded text-muted hover:bg-border/60 hover:text-text"
      >
        {copied ? <Check size={12} className="text-success" /> : <Copy size={12} />}
      </button>
    </div>
  )
}
