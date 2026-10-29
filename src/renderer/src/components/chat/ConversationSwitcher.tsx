import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, MessagesSquare, Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ChatConversationSummary } from '../../../../shared/chat'
import type { RepoRef } from '../../../../shared/scm'
import { useLocale } from '../../i18n/use-locale'
import { focusIndexAfterDelete, initialConversationIndex } from '../../lib/conversation-list'
import { formatAbsoluteTime, formatRelativeTime } from '../../lib/relative-time'
import { placeMenu, rovingTarget, type MenuPlacement } from '../../lib/roving-focus'
import { useChatStore } from '../../stores/chat-store'
import { Button } from '../ui/Button'
import { CountBadge } from '../ui/CountBadge'
import { IconButton } from '../ui/IconButton'
import { InlineError } from '../ui/InlineError'
import { Spinner } from '../ui/Spinner'

/** The list never grows taller than this (px), even in a tall window. */
const MAX_LIST_HEIGHT = 384

/** Gap (px) between the list and the bar's sides (its `px-2`). */
const LIST_INSET = 8

const LIST_ID = 'chat-conversation-list'
const ROW_SELECTOR = '[data-conv-row]'
const ITEM_SELECTOR = '[data-conv-item]'

interface ConversationSwitcherProps {
  repo: RepoRef
  number: number
  prKey: string
  activeId: string | null
}

interface OpenState {
  placement: MenuPlacement & { width: number }
  /** Which row gets focus when it opens without an open conversation. */
  from: 'first' | 'last'
}

/**
 * Top bar of the Ask tab: which conversation is open (or "New
 * conversation"), a toggle that drops down this PR's saved conversations
 * (title, last message, when, a spinner while one is answering; delete with
 * a confirm), and "New conversation".
 *
 * The list is a menu (WAI-ARIA APG menu button): it opens on the open
 * conversation (else the first), Up/Down/Home/End move between rows,
 * Left/Right between a row's items (open, delete), Enter opens; Esc, Tab or
 * a click outside close it and focus goes back to the toggle. It is portaled
 * to `body` with `position: fixed` under the bar, so nothing clips it. The
 * delete confirm takes focus on its "Delete"; Esc there cancels only the
 * confirm. After a delete, focus goes to the row that took its place, or to
 * the toggle when none is left.
 */
export function ConversationSwitcher({
  repo,
  number,
  prKey,
  activeId,
}: ConversationSwitcherProps): React.JSX.Element {
  const { t } = useTranslation()
  const [open, setOpen] = useState<OpenState | null>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const items = useChatStore((s) => s.lists[prKey]?.items ?? null)
  const loading = useChatStore((s) => s.lists[prKey]?.loading ?? false)
  const error = useChatStore((s) => s.lists[prKey]?.error ?? null)
  const loadList = useChatStore((s) => s.loadList)
  const setActive = useChatStore((s) => s.setActive)
  const remove = useChatStore((s) => s.remove)
  const active = items?.find((c) => c.id === activeId) ?? null
  const count = items?.length ?? 0
  const isOpen = open !== null
  const hasRows = count > 0
  const from = open?.from

  function show(fromEdge: OpenState['from']): void {
    const bar = barRef.current
    if (!bar) return
    // Inset to the bar's padding, so the list never touches the window edge.
    const bounds = bar.getBoundingClientRect()
    const rect = {
      top: bounds.top,
      bottom: bounds.bottom,
      left: bounds.left + LIST_INSET,
      right: bounds.right - LIST_INSET,
    }
    const placement = placeMenu(rect, { width: window.innerWidth, height: window.innerHeight }, 2)
    setOpen({
      placement: {
        ...placement,
        maxHeight: Math.min(placement.maxHeight, MAX_LIST_HEIGHT),
        width: rect.right - rect.left,
      },
      from: fromEdge,
    })
  }

  function close(returnFocus: boolean): void {
    setOpen(null)
    if (returnFocus) toggleRef.current?.focus()
  }

  function focusRow(index: number): void {
    const rows = listRef.current?.querySelectorAll<HTMLElement>(ROW_SELECTOR)
    rows?.[index]?.querySelector<HTMLElement>(ITEM_SELECTOR)?.focus()
  }

  // Focus moves in once the list is in the DOM, and onto the rows once they load.
  useEffect(() => {
    if (!from) return
    const list = listRef.current
    if (!list || list.querySelector(`${ITEM_SELECTOR}:focus`)) return
    const rows = Array.from(list.querySelectorAll<HTMLElement>(ROW_SELECTOR))
    const index = initialConversationIndex(
      rows.map((row) => row.dataset.convRow ?? ''),
      activeId,
      from,
    )
    if (index !== null) {
      rows[index].querySelector<HTMLElement>(ITEM_SELECTOR)?.focus()
      return
    }
    // Loading, empty or failed: the Retry button, else the list itself (so Esc works).
    if (list.contains(document.activeElement)) return
    ;(list.querySelector<HTMLElement>('button') ?? list).focus()
  }, [from, hasRows, activeId])

  // A click outside, a resize or leaving the window close it.
  useEffect(() => {
    if (!isOpen) return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (
        target instanceof Node &&
        (listRef.current?.contains(target) === true || toggleRef.current?.contains(target) === true)
      )
        return
      setOpen(null)
    }
    const onDismiss = (): void => setOpen(null)
    document.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('resize', onDismiss)
    window.addEventListener('blur', onDismiss)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('resize', onDismiss)
      window.removeEventListener('blur', onDismiss)
    }
  }, [isOpen])

  function onListKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault()
      event.stopPropagation()
      close(true)
      return
    }
    const list = listRef.current
    const row = event.target instanceof HTMLElement ? event.target.closest(ROW_SELECTOR) : null
    if (!list || !row) return
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const rowItems = Array.from(row.querySelectorAll<HTMLElement>(ITEM_SELECTOR))
      const target = rovingTarget(
        event.key,
        Math.max(rowItems.indexOf(event.target as HTMLElement), 0),
        rowItems.length,
        'horizontal',
      )
      if (target === null) return
      event.preventDefault()
      rowItems[target].focus()
      return
    }
    const rows = Array.from(list.querySelectorAll<HTMLElement>(ROW_SELECTOR))
    const target = rovingTarget(
      event.key,
      Math.max(rows.indexOf(row as HTMLElement), 0),
      rows.length,
      'vertical',
    )
    if (target === null) return
    event.preventDefault()
    focusRow(target)
  }

  function deleteConversation(id: string, index: number): void {
    void remove(prKey, id).finally(() => {
      // After React has painted the shorter list.
      requestAnimationFrame(() => {
        const list = listRef.current
        if (!list) {
          if (document.activeElement === document.body) toggleRef.current?.focus()
          return
        }
        const rows = Array.from(list.querySelectorAll<HTMLElement>(ROW_SELECTOR))
        // Still listed: the delete failed (the error shows under the transcript); focus stays.
        if (rows.some((row) => row.dataset.convRow === id)) return
        const next = focusIndexAfterDelete(index, rows.length)
        if (next === null) close(true)
        else focusRow(next)
      })
    })
  }

  return (
    <div className="shrink-0 border-b border-border">
      <div ref={barRef} className="flex min-w-0 items-center gap-1 px-2 py-1.5">
        <button
          ref={toggleRef}
          type="button"
          data-testid="chat-conversation-toggle"
          onClick={() => (isOpen ? close(false) : show('first'))}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              show(event.key === 'ArrowDown' ? 'first' : 'last')
            } else if (event.key === 'Escape' && isOpen) {
              event.preventDefault()
              event.stopPropagation()
              close(false)
            }
          }}
          aria-haspopup="menu"
          aria-expanded={isOpen}
          aria-controls={isOpen ? LIST_ID : undefined}
          title={t('chat.list.toggle')}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-sm hover:bg-border/60"
        >
          <MessagesSquare size={14} className="shrink-0 text-muted" aria-hidden />
          <span className="min-w-0 truncate font-medium text-text">
            {active ? active.title : t('chat.list.newTitle')}
          </span>
          {active?.running && <Spinner size={12} label={t('chat.list.running')} />}
          {count > 0 && <CountBadge count={count} tone="neutral" />}
          <ChevronDown
            size={12}
            className={`ml-auto shrink-0 text-muted transition-transform ${isOpen ? 'rotate-180' : ''}`}
            aria-hidden
          />
        </button>
        <IconButton
          size="sm"
          onClick={() => {
            setActive(prKey, null)
            close(false)
          }}
          label={t('chat.list.new')}
          icon={<Plus size={14} />}
        />
      </div>

      {open &&
        createPortal(
          <div
            ref={listRef}
            id={LIST_ID}
            data-testid="chat-conversation-list"
            role={hasRows && !error ? 'menu' : 'group'}
            aria-label={t('chat.list.label')}
            tabIndex={-1}
            data-no-drag
            onKeyDown={onListKeyDown}
            style={open.placement}
            className="fixed z-50 flex flex-col overflow-y-auto rounded-md border border-border bg-panel py-1 shadow-lg outline-none"
          >
            {error ? (
              <InlineError
                className="px-3 py-2"
                message={t('chat.list.loadError', { error })}
                onRetry={() => void loadList(repo, number, true)}
              />
            ) : items === null || (loading && items.length === 0) ? (
              <p role="status" className="px-3 py-2 text-xs text-muted">
                {t('chat.list.loading')}
              </p>
            ) : items.length === 0 ? (
              <p className="px-3 py-2 text-xs text-muted">{t('chat.list.empty')}</p>
            ) : (
              items.map((conversation, index) => (
                <ConversationRow
                  key={conversation.id}
                  conversation={conversation}
                  active={conversation.id === activeId}
                  onOpen={() => {
                    setActive(prKey, conversation.id)
                    close(true)
                  }}
                  onDelete={() => deleteConversation(conversation.id, index)}
                />
              ))
            )}
          </div>,
          document.body,
        )}
    </div>
  )
}

/** Stable, so a re-render (a spinner appearing) never pulls focus back. */
function focusOnMount(element: HTMLElement | null): void {
  element?.focus()
}

function ConversationRow({
  conversation,
  active,
  onOpen,
  onDelete,
}: {
  conversation: ChatConversationSummary
  active: boolean
  onOpen: () => void
  onDelete: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const { locale } = useLocale()
  const [confirming, setConfirming] = useState(false)
  const deleting = useRef(false)
  // Cancelling the confirm hands focus back to the trash button it replaced.
  const refocusTrash = useRef(false)
  const baseId = useId()
  const titleId = `${baseId}-title`
  const metaId = `${baseId}-meta`

  return (
    <div
      role="none"
      data-testid="chat-conversation"
      data-conv-row={conversation.id}
      className={`group/conv flex min-w-0 items-start gap-1 px-2 py-1.5 focus-within:bg-border/60 ${active ? 'bg-border/50' : 'hover:bg-border/40'}`}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && confirming) {
          event.preventDefault()
          event.stopPropagation()
          refocusTrash.current = true
          setConfirming(false)
        }
      }}
    >
      <button
        type="button"
        role="menuitemradio"
        aria-checked={active}
        tabIndex={-1}
        data-conv-item
        aria-labelledby={titleId}
        aria-describedby={metaId}
        onClick={onOpen}
        className="flex min-w-0 flex-1 flex-col gap-0.5 rounded-sm text-left"
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <span id={titleId} className="min-w-0 truncate text-sm font-medium text-text">
            {conversation.title}
          </span>
          {conversation.running && <Spinner size={12} label={t('chat.list.running')} />}
        </span>
        <span id={metaId} className="flex min-w-0 items-center gap-1.5 text-xs text-muted">
          <time
            dateTime={conversation.updatedAt}
            title={formatAbsoluteTime(conversation.updatedAt, locale)}
            className="shrink-0"
          >
            {formatRelativeTime(conversation.updatedAt, locale)}
          </time>
          {conversation.lastMessagePreview && (
            <span className="min-w-0 truncate">{conversation.lastMessagePreview}</span>
          )}
        </span>
      </button>
      {confirming ? (
        <span className="flex shrink-0 items-center gap-1">
          <Button
            ref={focusOnMount}
            variant="danger"
            size="xs"
            role="menuitem"
            tabIndex={-1}
            data-conv-item
            onClick={() => {
              if (deleting.current) return
              deleting.current = true
              onDelete()
            }}
          >
            {t('chat.list.confirmDelete')}
          </Button>
          <Button
            variant="ghost"
            size="xs"
            role="menuitem"
            tabIndex={-1}
            data-conv-item
            onClick={() => {
              refocusTrash.current = true
              setConfirming(false)
            }}
          >
            {t('common.cancel')}
          </Button>
        </span>
      ) : (
        <IconButton
          ref={(el) => {
            if (el && refocusTrash.current) {
              refocusTrash.current = false
              el.focus()
            }
          }}
          size="xs"
          role="menuitem"
          tabIndex={-1}
          data-conv-item
          onClick={() => setConfirming(true)}
          label={t('chat.list.delete', { title: conversation.title })}
          title={t('chat.list.deleteTitle')}
          icon={<Trash2 size={12} />}
          className="opacity-0 focus:opacity-100 group-hover/conv:opacity-100 group-focus-within/conv:opacity-100"
        />
      )}
    </div>
  )
}
