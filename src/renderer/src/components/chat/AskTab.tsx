import { useEffect } from 'react'
import { Sparkles, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { prKey as toPrKey, type RepoRef } from '../../../../shared/scm'
import { useChatStore } from '../../stores/chat-store'
import { ChatComposer } from './ChatComposer'
import { ChatTranscript } from './ChatTranscript'
import { ConversationSwitcher } from './ConversationSwitcher'
import { IconButton } from '../ui/IconButton'

interface AskTabProps {
  repo: RepoRef
  number: number
}

/**
 * The "Ask" tab of the right panel: a chat about the PR under review.
 * Conversations are saved by main per PR; each question is a jailed,
 * read-only run over the snapshot at the PR commit, with the lines and
 * threads the reviewer gathered from the diff as context.
 *
 * Switcher on top (so the transcript gets the room), transcript (or a short
 * hint when no conversation is open), the last error, then the composer.
 */
export function AskTab({ repo, number }: AskTabProps): React.JSX.Element {
  const key = toPrKey(repo, number)
  const activeId = useChatStore((s) => s.active[key] ?? null)
  const loadList = useChatStore((s) => s.loadList)

  useEffect(() => {
    void loadList(repo, number)
  }, [loadList, repo, number])

  return (
    <div data-testid="ask-tab" className="flex min-h-0 min-w-0 flex-1 flex-col">
      <ConversationSwitcher repo={repo} number={number} prKey={key} activeId={activeId} />
      {activeId ? (
        <ChatTranscript key={activeId} conversationId={activeId} prKey={key} />
      ) : (
        <ChatEmptyState />
      )}
      <ChatError prKey={key} />
      <ChatComposer repo={repo} number={number} prKey={key} conversationId={activeId} />
    </div>
  )
}

function ChatEmptyState(): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 overflow-y-auto px-6 text-center">
      <Sparkles size={22} className="text-muted" aria-hidden />
      <p className="text-sm font-medium text-text">{t('chat.empty.title')}</p>
      <p className="max-w-xs text-xs text-muted">{t('chat.empty.hint')}</p>
    </div>
  )
}

function ChatError({ prKey }: { prKey: string }): React.JSX.Element | null {
  const { t } = useTranslation()
  const error = useChatStore((s) => s.errors[prKey] ?? null)
  const dismissError = useChatStore((s) => s.dismissError)
  if (!error) return null
  return (
    <div
      role="alert"
      className="flex shrink-0 items-start gap-2 border-t border-border bg-danger/10 px-3 py-1.5 text-xs text-danger"
    >
      <p className="min-w-0 flex-1 break-words">{error}</p>
      <IconButton
        size="xs"
        onClick={() => dismissError(prKey)}
        label={t('common.dismiss')}
        icon={<X size={12} />}
      />
    </div>
  )
}
