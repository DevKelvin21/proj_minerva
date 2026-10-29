import { useState } from 'react'
import { Check, ChevronDown, Copy, MessageSquarePlus, Reply } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ChatContextItem } from '../../../../shared/chat'
import { answerDraft } from '../../lib/chat-draft'
import type { TFunction } from 'i18next'
import { contextItemAuthor, contextItemLocation, diffSide } from '../../lib/chat-context'
import { widthTier } from '../../lib/layout'
import { useAppStore } from '../../stores/app-store'
import { Button } from '../ui/Button'
import { IconButton } from '../ui/IconButton'
import { Menu } from '../ui/Menu'

interface AnswerActionsProps {
  /** The answer (Markdown). */
  text: string
  /** Context of the question it answers: where the answer can be posted from. */
  context: readonly ChatContextItem[]
}

interface Target {
  key: string
  kind: 'comment' | 'reply'
  /** Its menu entry and tooltip ("Use as reply to the thread on src/a.ts:12"). */
  label: string
  run: () => void
}

function targetsOf(context: readonly ChatContextItem[], text: string, t: TFunction): Target[] {
  return context.map((item) => {
    const location = contextItemLocation(item)
    if (item.kind === 'line') {
      return {
        key: item.id,
        kind: 'comment' as const,
        label: t('chat.answer.useAsCommentOn', { location }),
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
      // A PR-level thread has no location: it is named by who started it.
      label:
        location === null
          ? t('chat.answer.useAsReplyGeneral', { author: contextItemAuthor(item) })
          : t('chat.answer.useAsReplyOn', { location }),
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
 * typed: in the Files tab, or the Conversation tab for a general comment). Several targets = a menu (`ui/Menu`). The text always goes through
 * `answerDraft` (no image or loading HTML survives) and nothing is posted.
 */
export function AnswerActions({ text, context }: AnswerActionsProps): React.JSX.Element {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const targets = targetsOf(context, text, t)

  function run(target: Target): void {
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

  const targetLabel = (target: Target): string => target.label
  const targetIcon = (target: Target): React.JSX.Element =>
    target.kind === 'comment' ? (
      <MessageSquarePlus size={12} aria-hidden />
    ) : (
      <Reply size={12} aria-hidden />
    )

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {targets.length === 1 && (
        <Button
          size="xs"
          onClick={() => run(targets[0])}
          title={targetLabel(targets[0])}
          icon={targetIcon(targets[0])}
        >
          {targets[0].kind === 'comment' ? t('chat.answer.useAsComment') : t('chat.answer.useAsReply')}
        </Button>
      )}
      {targets.length > 1 && (
        <Menu
          label={t('chat.answer.useAs')}
          items={targets.map((target) => ({
            key: target.key,
            label: targetLabel(target),
            icon: targetIcon(target),
            onSelect: () => run(target),
          }))}
          trigger={(props) => (
            <Button size="xs" icon={<MessageSquarePlus size={12} aria-hidden />} {...props}>
              {t('chat.answer.useAs')}
              <ChevronDown size={12} aria-hidden />
            </Button>
          )}
        />
      )}
      <IconButton
        size="xs"
        onClick={() => void copy()}
        label={t('chat.answer.copy')}
        icon={copied ? <Check size={12} className="text-success" /> : <Copy size={12} />}
      />
    </div>
  )
}
