import { useState } from 'react'
import { ChevronDown, Loader2, MessagesSquare, Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ChatConversationSummary } from '../../../../shared/chat'
import type { RepoRef } from '../../../../shared/scm'
import { useLocale } from '../../i18n/use-locale'
import { formatAbsoluteTime, formatRelativeTime } from '../../lib/relative-time'
import { useChatStore } from '../../stores/chat-store'
import { Button } from '../ui/Button'
import { CountBadge } from '../ui/CountBadge'
import { IconButton } from '../ui/IconButton'

interface ConversationSwitcherProps {
  repo: RepoRef
  number: number
  prKey: string
  activeId: string | null
}

/**
 * Top bar of the Ask tab: which conversation is open (or "New
 * conversation"), a toggle that drops down this PR's saved conversations
 * over the transcript (title, last message, when, a spinner while one is
 * answering; delete with a confirm), and "New conversation".
 */
export function ConversationSwitcher({
  repo,
  number,
  prKey,
  activeId,
}: ConversationSwitcherProps): React.JSX.Element {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const items = useChatStore((s) => s.lists[prKey]?.items ?? null)
  const loading = useChatStore((s) => s.lists[prKey]?.loading ?? false)
  const error = useChatStore((s) => s.lists[prKey]?.error ?? null)
  const loadList = useChatStore((s) => s.loadList)
  const setActive = useChatStore((s) => s.setActive)
  const active = items?.find((c) => c.id === activeId) ?? null
  const count = items?.length ?? 0

  return (
    <div
      className="relative shrink-0 border-b border-border"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.preventDefault()
          event.stopPropagation()
          setOpen(false)
        }
      }}
    >
      <div className="flex min-w-0 items-center gap-1 px-2 py-1.5">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls="chat-conversation-list"
          title={t('chat.list.toggle')}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs hover:bg-border/60"
        >
          <MessagesSquare size={13} className="shrink-0 text-muted" aria-hidden />
          <span className="min-w-0 truncate font-medium text-text">
            {active ? active.title : t('chat.list.newTitle')}
          </span>
          {active?.running && (
            <Loader2
              size={12}
              className="shrink-0 animate-spin text-accent motion-reduce:animate-none"
              aria-label={t('chat.list.running')}
            />
          )}
          {count > 0 && <CountBadge count={count} tone="neutral" />}
          <ChevronDown
            size={13}
            className={`ml-auto shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`}
            aria-hidden
          />
        </button>
        <IconButton
          size="sm"
          onClick={() => {
            setActive(prKey, null)
            setOpen(false)
          }}
          label={t('chat.list.new')}
          icon={<Plus size={14} />}
        />
      </div>

      {open && (
        <div
          id="chat-conversation-list"
          data-testid="chat-conversation-list"
          className="absolute inset-x-0 top-full z-20 max-h-[min(60vh,24rem)] overflow-y-auto border-b border-border bg-panel shadow-lg"
        >
          {error ? (
            <div role="alert" className="flex flex-col gap-1.5 p-3 text-xs text-danger">
              <p>{t('chat.list.loadError', { error })}</p>
              <Button size="xs" className="w-fit" onClick={() => void loadList(repo, number, true)}>
                {t('common.retry')}
              </Button>
            </div>
          ) : items === null || (loading && items.length === 0) ? (
            <p role="status" className="p-3 text-xs text-muted">
              {t('chat.list.loading')}
            </p>
          ) : items.length === 0 ? (
            <p className="p-3 text-xs text-muted">{t('chat.list.empty')}</p>
          ) : (
            <ul className="flex flex-col py-1">
              {items.map((conversation) => (
                <ConversationRow
                  key={conversation.id}
                  conversation={conversation}
                  active={conversation.id === activeId}
                  prKey={prKey}
                  onOpen={() => {
                    setActive(prKey, conversation.id)
                    setOpen(false)
                  }}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

function ConversationRow({
  conversation,
  active,
  prKey,
  onOpen,
}: {
  conversation: ChatConversationSummary
  active: boolean
  prKey: string
  onOpen: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const { locale } = useLocale()
  const [confirming, setConfirming] = useState(false)
  const remove = useChatStore((s) => s.remove)

  return (
    <li
      data-testid="chat-conversation"
      aria-current={active || undefined}
      className={`group/conv flex min-w-0 items-start gap-1 px-2 py-1.5 ${active ? 'bg-border/50' : 'hover:bg-border/40'}`}
    >
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 flex-col gap-0.5 text-left"
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="min-w-0 truncate text-xs font-medium text-text">
            {conversation.title}
          </span>
          {conversation.running && (
            <Loader2
              size={11}
              className="shrink-0 animate-spin text-accent motion-reduce:animate-none"
              aria-label={t('chat.list.running')}
            />
          )}
          <time
            dateTime={conversation.updatedAt}
            title={formatAbsoluteTime(conversation.updatedAt, locale)}
            className="ml-auto shrink-0 text-[10px] text-muted"
          >
            {formatRelativeTime(conversation.updatedAt, locale)}
          </time>
        </span>
        {conversation.lastMessagePreview && (
          <span className="min-w-0 truncate text-[11px] text-muted">
            {conversation.lastMessagePreview}
          </span>
        )}
      </button>
      {confirming ? (
        <span className="flex shrink-0 items-center gap-1 text-[11px]">
          <Button
            variant="danger"
            size="xs"
            onClick={() => {
              setConfirming(false)
              void remove(prKey, conversation.id)
            }}
          >
            {t('chat.list.confirmDelete')}
          </Button>
          <Button variant="ghost" size="xs" onClick={() => setConfirming(false)}>
            {t('common.cancel')}
          </Button>
        </span>
      ) : (
        <IconButton
          size="xs"
          onClick={() => setConfirming(true)}
          label={t('chat.list.delete', { title: conversation.title })}
          title={t('chat.list.deleteTitle')}
          icon={<Trash2 size={12} />}
          className="opacity-0 focus:opacity-100 group-hover/conv:opacity-100"
        />
      )}
    </li>
  )
}
