import { useEffect } from 'react'
import { Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { prKey as toPrKey, type RepoRef } from '../../../../shared/scm'
import { useChatStore } from '../../stores/chat-store'
import { ChatComposer } from './ChatComposer'
import { ChatTranscript } from './ChatTranscript'
import { ConversationSwitcher } from './ConversationSwitcher'
import { EmptyState } from '../ui/EmptyState'
import { InlineError } from '../ui/InlineError'

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
    <EmptyState compact icon={Sparkles} title={t('chat.empty.title')} hint={t('chat.empty.hint')} />
  )
}

function ChatError({ prKey }: { prKey: string }): React.JSX.Element | null {
  const error = useChatStore((s) => s.errors[prKey] ?? null)
  const dismissError = useChatStore((s) => s.dismissError)
  if (!error) return null
  return (
    <InlineError
      message={error}
      onDismiss={() => dismissError(prKey)}
      className="shrink-0 border-t border-border bg-danger/10 px-3 py-1.5"
    />
  )
}
