import { useRef, useState } from 'react'
import { EyeOff, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { CommentThread } from '../../../../shared/types'
import { isLiveConversation, useAskConversation } from '../../stores/ask-ai-store'
import { AskAiCard } from './AskAiCard'
import type { CommentComposerHandle } from './CommentComposer'
import type { ThreadAskBinding } from './diff-body'
import { ThreadCard } from './ThreadCard'

interface InlineThreadCardProps {
  thread: CommentThread
  highlighted: boolean
  /** Hides the threads of this line (the gutter icon shows them again); absent = no hide button. */
  onHide?: () => void
  /** "Ask AI" about this thread; absent = no button. */
  ask?: ThreadAskBinding
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
 * the Comments view or a `path:line` chip.
 *
 * Under a row, every thread starts folded to its one-line header (author,
 * first words, status) so the code reads as code; one click opens it. The
 * focused thread (jumped to, or just created) opens by itself (`highlighted`).
 *
 * "Ask AI" opens a conversation about the thread under it, with the thread as
 * context. "Use as reply" adds the answer to the reply box, after anything
 * already typed; a folded thread (no reply box) remounts open with the answer
 * as its draft. Nothing is posted.
 */
export function InlineThreadCard({
  thread,
  highlighted,
  onHide,
  ask,
  placement = 'line',
}: InlineThreadCardProps): React.JSX.Element {
  const { t } = useTranslation()
  const [askOpen, setAskOpen] = useState(false)
  // `n` remounts a folded thread so its reply composer starts from the new draft.
  const [replyDraft, setReplyDraft] = useState<{ text: string; n: number } | null>(null)
  const replyRef = useRef<CommentComposerHandle>(null)
  const canAsk = ask !== undefined && thread.comments.length > 0
  const subject = canAsk ? ask.subject(thread) : undefined
  const asked = isLiveConversation(useAskConversation(subject))

  return (
    <div
      id={`thread-${thread.id}`}
      className={placement === 'line' ? 'bg-bg px-2 py-1 font-sans' : ''}
    >
      <ThreadCard
        key={replyDraft?.n ?? 0}
        thread={thread}
        collapsedByDefault={replyDraft ? false : placement === 'line' ? true : undefined}
        showPath={false}
        showExcerpt={placement === 'above'}
        highlighted={highlighted}
        replyDraft={replyDraft?.text}
        replyRef={replyRef}
        extraHeaderContent={
          <>
            {canAsk && (
              <button
                type="button"
                onClick={() => setAskOpen((open) => !open)}
                aria-pressed={askOpen}
                aria-label={t('comments.askAi.threadButton')}
                title={
                  asked ? t('comments.askAi.threadButtonActive') : t('comments.askAi.threadButton')
                }
                data-asked={asked || undefined}
                className={`inline-flex h-5 w-5 items-center justify-center rounded hover:text-accent ${
                  askOpen || asked ? 'text-accent' : 'text-muted'
                }`}
              >
                <Sparkles size={13} />
              </button>
            )}
            {onHide && (
              <button
                type="button"
                onClick={onHide}
                aria-label={t('comments.line.hideComments')}
                title={t('comments.line.hideCommentsTitle')}
                className="inline-flex h-5 w-5 items-center justify-center rounded text-muted hover:text-text"
              >
                <EyeOff size={13} />
              </button>
            )}
          </>
        }
      />
      {askOpen && ask && subject && (
        <div className="mt-1">
          <AskAiCard
            subject={subject}
            title={t('comments.askAi.threadTitle')}
            inputLabel={t('comments.askAi.threadInputLabel')}
            placeholder={t('comments.askAi.threadPlaceholder')}
            quickQuestions={[
              t('comments.askAi.quickValid'),
              t('comments.askAi.quickFix'),
              t('comments.askAi.quickExplain'),
            ]}
            onRun={ask.run(thread)}
            useAs="reply"
            onUse={(markdown) => {
              if (replyRef.current) replyRef.current.append(markdown)
              else setReplyDraft((draft) => ({ text: markdown, n: (draft?.n ?? 0) + 1 }))
              setAskOpen(false)
            }}
            onClose={() => setAskOpen(false)}
          />
        </div>
      )}
    </div>
  )
}
