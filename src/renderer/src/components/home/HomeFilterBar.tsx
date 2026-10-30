import { useCallback, useRef, useState, type KeyboardEvent } from 'react'
import { ChevronDown, Funnel, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  addValue,
  FACETS,
  filterChips,
  filterValueCount,
  hasValue,
  isFilterActive,
  isStatusId,
  ME_KEY,
  parseTypedTokens,
  type FacetId,
  type FacetOption,
  type FilterChip,
  type HomeFilter,
  type OptionsByFacet,
  type StatusId,
} from '../../lib/home-filter'
import { useHomeFilterStore } from '../../stores/home-filter-store'
import { Button } from '../ui/Button'
import { CountBadge } from '../ui/CountBadge'
import { fieldBareClass, fieldFrameClass } from '../ui/field-classes'
import { Menu } from '../ui/Menu'
import { FilterPicker } from './FilterPicker'

interface OpenPicker {
  facet: FacetId
  anchor: HTMLElement
}

/** The picker's list: what exists, plus picked values nobody has any more (count 0, so they can be unpicked). */
function pickerOptions(facet: FacetId, options: OptionsByFacet, filter: HomeFilter): FacetOption[] {
  const listed = options[facet]
  const stale: FacetOption[] = []
  for (const chip of filterChips(filter)) {
    if (chip.facet !== facet || listed.some((option) => option.key === chip.key)) continue
    stale.push({
      key: chip.key,
      label: chip.label,
      count: 0,
      section: chip.key === ME_KEY ? 'me' : 'others',
      aliases: [],
    })
  }
  return [...listed, ...stale]
}

/** Focus back on what opened a picker: the button itself, or the button inside a wrapper. */
function focusAnchor(anchor: HTMLElement): void {
  const target = anchor instanceof HTMLButtonElement ? anchor : anchor.querySelector('button')
  target?.focus()
}

/** One picked value inside the field: "Author Ada Lovelace ×". */
function FilterToken({
  chip,
  facetLabel,
  valueLabel,
  onRemove,
}: {
  chip: FilterChip
  facetLabel: string
  valueLabel: string
  onRemove: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <span
      data-testid="home-filter-chip"
      data-facet={chip.facet}
      data-key={chip.key}
      className="inline-flex h-6 min-w-0 max-w-full shrink-0 items-center gap-1 rounded-full border border-accent/40 bg-accent/15 pl-2 pr-1 text-[11px] text-accent"
    >
      <span className="shrink-0 opacity-75">{facetLabel}</span>
      <span className="min-w-0 truncate font-semibold" title={valueLabel}>
        {valueLabel}
      </span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={t('home.filterBar.removeChip', { facet: facetLabel, value: valueLabel })}
        title={t('home.filterBar.removeChip', { facet: facetLabel, value: valueLabel })}
        className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full hover:bg-accent/20"
      >
        <X size={11} aria-hidden />
      </button>
    </span>
  )
}

interface HomeFilterBarProps {
  options: OptionsByFacet
  statusLabel: (status: StatusId) => string
  /** Tiled window: the five facet buttons fold into one "Filters · n" menu; chips go under the field. */
  folded: boolean
}

/**
 * The Home filter bar: a field whose picked values show as chips (typed
 * `author:ada tag:checkout` turns into chips on Enter), one button per
 * facet with its picker, Clear, and the combining rule. Esc in the field
 * clears everything (Home comes back); Backspace in an empty field drops
 * the last chip.
 */
export function HomeFilterBar({ options, statusLabel, folded }: HomeFilterBarProps): React.JSX.Element {
  const { t } = useTranslation()
  const filter = useHomeFilterStore((s) => s.filter)
  const setText = useHomeFilterStore((s) => s.setText)
  const setFilter = useHomeFilterStore((s) => s.setFilter)
  const removeValue = useHomeFilterStore((s) => s.removeValue)
  const toggleValue = useHomeFilterStore((s) => s.toggleValue)
  const clear = useHomeFilterStore((s) => s.clear)
  const [open, setOpen] = useState<OpenPicker | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const foldAnchorRef = useRef<HTMLSpanElement>(null)
  const chips = filterChips(filter)
  const active = isFilterActive(filter)
  const picked = filterValueCount(filter)

  const facetLabel = (facet: FacetId): string => t(`home.filterBar.facets.${facet}`)
  const chipValueLabel = (chip: FilterChip): string =>
    chip.facet === 'status' && isStatusId(chip.key) ? statusLabel(chip.key) : chip.label
  const countIn = (facet: FacetId): number => chips.filter((chip) => chip.facet === facet).length

  const closePicker = useCallback(
    (returnFocus: boolean) => {
      if (open && returnFocus) focusAnchor(open.anchor)
      setOpen(null)
    },
    [open],
  )

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter') {
      event.preventDefault()
      const parsed = parseTypedTokens(filter.text, options)
      if (parsed.added.length === 0) return
      let next: HomeFilter = { ...filter, text: parsed.rest }
      for (const item of parsed.added) next = addValue(next, item.facet, item.value)
      setFilter(next)
    } else if (event.key === 'Backspace' && filter.text === '' && chips.length > 0) {
      const last = chips[chips.length - 1]
      removeValue(last.facet, last.key)
    }
  }

  const tokens = chips.map((chip) => (
    <FilterToken
      key={chip.facet + ':' + chip.key}
      chip={chip}
      facetLabel={facetLabel(chip.facet)}
      valueLabel={chipValueLabel(chip)}
      onRemove={() => {
        removeValue(chip.facet, chip.key)
        inputRef.current?.focus()
      }}
    />
  ))

  const facetButton = (facet: FacetId): React.JSX.Element => {
    const count = countIn(facet)
    const isOpen = open?.facet === facet
    return (
      <Button
        key={facet}
        variant="secondary"
        size="xs"
        data-testid={'home-filter-facet-' + facet}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-label={count > 0 ? t('home.filterBar.facetPicked', { facet: facetLabel(facet), count }) : undefined}
        onClick={(event) => {
          const anchor = event.currentTarget
          setOpen((current) => (current?.facet === facet ? null : { facet, anchor }))
        }}
        className={count > 0 ? 'border-accent/45 text-accent' : ''}
      >
        {facetLabel(facet)}
        {count > 0 && <CountBadge count={count} />}
        <ChevronDown size={11} aria-hidden />
      </Button>
    )
  }

  return (
    <div
      role="search"
      aria-label={t('home.filterBar.ariaLabel')}
      data-testid="home-filter-bar"
      data-folded={folded || undefined}
      onKeyDown={(event) => {
        // Esc anywhere in the bar (pickers and the Filters menu stop their own) brings Home back.
        if (event.key !== 'Escape' || (!active && filter.text === '')) return
        event.preventDefault()
        event.stopPropagation()
        clear()
        inputRef.current?.focus()
      }}
      className="flex min-w-0 flex-col gap-2"
    >
      <div className="flex min-w-0 items-center gap-2">
        {/* A click on the box (not on a chip's ×) puts the caret in the field. */}
        <div
          onClick={(event) => {
            if (event.target === event.currentTarget) inputRef.current?.focus()
          }}
          className={`${fieldFrameClass} flex min-h-8 min-w-0 flex-1 flex-wrap items-center gap-1.5 px-2 py-1`}
        >
          <Funnel size={13} aria-hidden className="shrink-0 text-muted" />
          {!folded && tokens}
          <input
            ref={inputRef}
            type="text"
            data-testid="home-filter-input"
            value={filter.text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={onKeyDown}
            spellCheck={false}
            aria-label={t('home.filterBar.inputLabel')}
            placeholder={
              folded || chips.length > 0
                ? t('home.filterBar.placeholderShort')
                : t('home.filterBar.placeholder')
            }
            className={`${fieldBareClass} min-w-[8rem] flex-1 py-0.5 text-xs`}
          />
        </div>
        {folded && (
          <span ref={foldAnchorRef} className="inline-flex shrink-0">
            <Menu
              label={t('home.filterBar.filtersMenu')}
              items={FACETS.map((facet) => {
                const count = countIn(facet)
                return {
                  key: facet,
                  label: (
                    <span className="inline-flex items-center gap-1.5">
                      {facetLabel(facet)}
                      {count > 0 && <CountBadge count={count} />}
                    </span>
                  ),
                  onSelect: () => {
                    const anchor = foldAnchorRef.current
                    if (anchor) setOpen({ facet, anchor })
                  },
                }
              })}
              trigger={(props) => (
                <Button
                  {...props}
                  variant="secondary"
                  size="sm"
                  data-testid="home-filter-folded"
                  aria-label={
                    picked > 0 ? t('home.filterBar.filtersAriaLabel', { count: picked }) : undefined
                  }
                  icon={<Funnel size={12} aria-hidden />}
                  className={picked > 0 ? 'border-accent/45 text-accent' : ''}
                >
                  {t('home.filterBar.filters')}
                  {picked > 0 && <CountBadge count={picked} />}
                </Button>
              )}
            />
          </span>
        )}
        {active && (
          <Button
            variant="ghost"
            size="sm"
            data-testid="home-filter-clear"
            title={t('home.filterBar.clearTitle')}
            onClick={() => {
              clear()
              inputRef.current?.focus()
            }}
          >
            {t('home.filterBar.clear')}
          </Button>
        )}
      </div>
      {folded ? (
        tokens.length > 0 && <div className="flex min-w-0 flex-wrap items-center gap-1.5">{tokens}</div>
      ) : (
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          {FACETS.map(facetButton)}
          <span className="ml-1 min-w-0 text-[11px] text-muted">{t('home.filterBar.combineHint')}</span>
        </div>
      )}
      {open && (
        <FilterPicker
          key={open.facet}
          facet={open.facet}
          anchor={open.anchor}
          options={pickerOptions(open.facet, options, filter)}
          isSelected={(key) => hasValue(filter, open.facet, key)}
          onToggle={(option) => toggleValue(open.facet, { key: option.key, label: option.label })}
          onClose={closePicker}
        />
      )}
    </div>
  )
}
