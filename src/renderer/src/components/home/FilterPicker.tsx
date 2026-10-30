import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import {
  Check,
  CircleX,
  Eye,
  GitPullRequestDraft,
  Search,
  Tag,
  ThumbsUp,
  TriangleAlert,
  User,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { searchOptions, type FacetId, type FacetOption, type StatusId } from '../../lib/home-filter'
import { placeMenu, rovingTarget, type MenuPlacement } from '../../lib/roving-focus'
import { Avatar } from '../ui/Avatar'
import { Input } from '../ui/Input'
import { ScmProviderIcon } from '../ui/ScmProviderIcon'

const STATUS_ICON: Record<StatusId, React.JSX.Element> = {
  waitingOnMe: <Eye size={12} aria-hidden className="text-muted" />,
  draft: <GitPullRequestDraft size={12} aria-hidden className="text-muted" />,
  changesRequested: <TriangleAlert size={12} aria-hidden className="text-warning" />,
  approved: <ThumbsUp size={12} aria-hidden className="text-success" />,
  ciFailing: <CircleX size={12} aria-hidden className="text-danger" />,
  unread: <span aria-hidden className="mx-[3px] h-1.5 w-1.5 rounded-full bg-danger" />,
}

/** The small picture before an option: avatar, tag, provider or status glyph. */
export function OptionLead({ facet, option }: { facet: FacetId; option: FacetOption }): React.JSX.Element {
  if (facet === 'status') return STATUS_ICON[option.key as StatusId] ?? <span aria-hidden />
  if (facet === 'tag') return <Tag size={12} aria-hidden className="text-muted" />
  if (facet === 'repo' && option.repo) return <ScmProviderIcon provider={option.repo.provider} size={12} />
  if (option.user) return <Avatar user={option.user} size={16} />
  return (
    <span aria-hidden className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-accent/15 text-accent">
      <User size={10} />
    </span>
  )
}

function CheckMark({ on }: { on: boolean }): React.JSX.Element {
  return (
    <span
      aria-hidden
      className={`inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border ${
        on ? 'border-accent bg-accent text-accent-fg' : 'border-border bg-panel'
      }`}
    >
      {on && <Check size={10} strokeWidth={3} />}
    </span>
  )
}

interface FilterPickerProps {
  facet: FacetId
  /** What it opens next to (the facet button, or the folded "Filters" button). */
  anchor: HTMLElement
  options: readonly FacetOption[]
  isSelected: (key: string) => boolean
  onToggle: (option: FacetOption) => void
  /** `true` = give focus back to the anchor. */
  onClose: (returnFocus: boolean) => void
}

/**
 * A short checklist for one facet: a search box, then the values that exist
 * with how many open PRs have each (`menuitemcheckbox`). Picking keeps it
 * open; Esc or Tab close it and focus goes back to the button that opened
 * it; a click outside, a scroll or a resize close it. Portaled with
 * `position: fixed` next to its anchor, like `ui/Menu`. Mounted only while
 * open, so its search starts empty every time.
 */
export function FilterPicker({
  facet,
  anchor,
  options,
  isSelected,
  onToggle,
  onClose,
}: FilterPickerProps): React.JSX.Element {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [placement] = useState<MenuPlacement>(() =>
    placeMenu(anchor.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight }),
  )
  const panelRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const listId = useId()
  const facetLabel = t(`home.filterBar.facets.${facet}`)
  const shown = useMemo(() => searchOptions(options, query), [options, query])
  const people = facet === 'author' || facet === 'reviewer'
  const me = people ? shown.filter((option) => option.section === 'me') : []
  const others = people ? shown.filter((option) => option.section === 'others') : shown

  useEffect(() => {
    searchRef.current?.focus()
  }, [])

  // Dismiss on anything that would leave the fixed panel floating off its anchor.
  useEffect(() => {
    const inside = (target: EventTarget | null): boolean =>
      target instanceof Node && (panelRef.current?.contains(target) === true || anchor.contains(target))
    const onPointerDown = (event: PointerEvent): void => {
      if (!inside(event.target)) onClose(false)
    }
    const onScroll = (event: Event): void => {
      if (!inside(event.target)) onClose(false)
    }
    const onResize = (): void => onClose(false)
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    window.addEventListener('blur', onResize)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('blur', onResize)
    }
  }, [anchor, onClose])

  const items = (): HTMLElement[] =>
    Array.from(listRef.current?.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]') ?? [])

  function onPanelKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault()
      event.stopPropagation()
      onClose(true)
    }
  }

  function onSearchKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      items()[0]?.focus()
    } else if (event.key === 'Enter') {
      event.preventDefault()
      if (shown[0]) onToggle(shown[0])
    }
  }

  function onListKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const all = items()
    const current = all.findIndex((el) => el === event.target)
    if (event.key === 'ArrowUp' && current === 0) {
      event.preventDefault()
      searchRef.current?.focus()
      return
    }
    const target = rovingTarget(event.key, Math.max(current, 0), all.length, 'vertical')
    if (target === null) return
    event.preventDefault()
    all[target].focus()
  }

  const renderOption = (option: FacetOption): React.JSX.Element => {
    const on = isSelected(option.key)
    const stale = option.count === 0
    return (
      <button
        key={option.key}
        type="button"
        role="menuitemcheckbox"
        aria-checked={on}
        tabIndex={-1}
        data-option-key={option.key}
        onClick={() => onToggle(option)}
        title={
          stale ? t('home.filterPicker.staleTitle') : t('home.filterPicker.countTitle', { count: option.count })
        }
        className="flex min-w-0 items-center gap-2 px-2.5 py-1.5 text-left text-xs text-text hover:bg-border/60 focus:bg-border/60 focus:outline-none"
      >
        <CheckMark on={on} />
        <span className="flex shrink-0 items-center">
          <OptionLead facet={facet} option={option} />
        </span>
        <span className={`min-w-0 flex-1 truncate ${stale ? 'text-muted line-through' : ''}`}>
          {option.label}
        </span>
        <span className="shrink-0 tabular-nums text-[11px] text-muted">{option.count}</span>
      </button>
    )
  }

  const sectionHeading = (label: string): React.JSX.Element => (
    <p
      role="presentation"
      className="px-2.5 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted"
    >
      {label}
    </p>
  )

  const footer =
    facet === 'tag'
      ? t('home.filterPicker.tagsHint')
      : facet === 'author' || facet === 'reviewer'
        ? t('home.filterPicker.keysHint')
        : null

  return createPortal(
    <div
      ref={panelRef}
      data-testid="filter-picker"
      data-facet={facet}
      role="dialog"
      aria-label={facetLabel}
      data-no-drag
      onKeyDown={onPanelKeyDown}
      style={{ ...placement, maxWidth: Math.min(placement.maxWidth, 320) }}
      className="fixed z-50 flex w-72 min-w-0 flex-col overflow-hidden rounded-md border border-border bg-panel shadow-lg"
    >
      <div className="shrink-0 p-2">
        <Input
          ref={searchRef}
          type="search"
          fieldSize="sm"
          icon={<Search size={12} />}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onSearchKeyDown}
          placeholder={t('home.filterPicker.searchPlaceholder')}
          aria-label={t('home.filterPicker.searchLabel', { facet: facetLabel })}
          aria-controls={listId}
        />
      </div>
      <div
        ref={listRef}
        id={listId}
        role="menu"
        aria-label={facetLabel}
        onKeyDown={onListKeyDown}
        className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-1"
      >
        {shown.length === 0 && (
          <p className="px-2.5 py-2 text-xs text-muted">{t('home.filterPicker.noMatch')}</p>
        )}
        {me.length > 0 && sectionHeading(t('home.filterPicker.sectionMe'))}
        {me.map(renderOption)}
        {people &&
          others.length > 0 &&
          sectionHeading(
            facet === 'author'
              ? t('home.filterPicker.sectionPeople')
              : t('home.filterPicker.sectionReviewers'),
          )}
        {others.map(renderOption)}
      </div>
      {footer && (
        <p className="shrink-0 border-t border-border px-2.5 py-1.5 text-[11px] text-muted">{footer}</p>
      )}
    </div>,
    document.body,
  )
}
