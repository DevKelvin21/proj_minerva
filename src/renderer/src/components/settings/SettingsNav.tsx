import type { KeyboardEvent, ReactNode } from 'react'
import { Bell, Cpu, Download, Palette, SlidersHorizontal, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { rovingTarget } from '../../lib/roving-focus'
import {
  settingsNavSections,
  type SettingsDot,
  type SettingsPageId,
} from '../../lib/settings-pages'
import { ScmProviderIcon } from '../ui/ScmProviderIcon'
import { useSettingsPageLabel } from './use-settings-page-label'

const PAGE_ICON: Record<SettingsPageId, ReactNode> = {
  general: <SlidersHorizontal size={14} aria-hidden />,
  appearance: <Palette size={14} aria-hidden />,
  github: <ScmProviderIcon provider="github" size={14} />,
  azure: <ScmProviderIcon provider="azure" size={14} />,
  'ai-providers': <Cpu size={14} aria-hidden />,
  'ai-model': <Sparkles size={14} aria-hidden />,
  notifications: <Bell size={14} aria-hidden />,
  updates: <Download size={14} aria-hidden />,
}

const DOT_CLASS: Record<SettingsDot, string> = {
  warning: 'bg-warning',
  accent: 'bg-accent',
}

const itemId = (page: SettingsPageId): string => 'settings-nav-' + page

interface SettingsNavProps {
  pages: readonly SettingsPageId[]
  current: SettingsPageId
  dots: Partial<Record<SettingsPageId, SettingsDot>>
  onSelect: (page: SettingsPageId) => void
  /** Arrow keys also open the page they land on (list beside the page). */
  followFocus: boolean
  className?: string
}

/**
 * The page list: a `nav` of buttons, the current one `aria-current="page"`.
 * One Tab stop (the current page); Up/Down move through every page with
 * wrap-around, Home/End jump to the ends, Enter/Space open the focused one.
 */
export function SettingsNav({
  pages,
  current,
  dots,
  onSelect,
  followFocus,
  className = '',
}: SettingsNavProps): React.JSX.Element {
  const { t } = useTranslation()
  const pageLabel = useSettingsPageLabel()
  const sections = settingsNavSections(pages)

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, page: SettingsPageId): void {
    const target = rovingTarget(event.key, pages.indexOf(page), pages.length, 'vertical')
    if (target === null) return
    event.preventDefault()
    const next = pages[target]
    event.currentTarget.ownerDocument.getElementById(itemId(next))?.focus()
    if (followFocus) onSelect(next)
  }

  return (
    <nav
      aria-label={t('settings.modal.navLabel')}
      className={'flex min-w-0 flex-col overflow-y-auto bg-panel px-2 py-3 ' + className}
    >
      {sections.map((section) => (
        <div key={section.group ?? 'top'} className="flex flex-col gap-0.5">
          {section.group && (
            <span className="px-2.5 pb-1 pt-3 text-[11px] font-semibold text-muted">
              {t(`settings.nav.groups.${section.group}`)}
            </span>
          )}
          <ul className="flex flex-col gap-0.5">
            {section.pages.map((page) => {
              const isCurrent = page === current
              const dot = dots[page]
              return (
                <li key={page}>
                  <button
                    type="button"
                    id={itemId(page)}
                    data-testid={itemId(page)}
                    aria-current={isCurrent ? 'page' : undefined}
                    tabIndex={isCurrent ? 0 : -1}
                    // The full-width list (tiled) takes focus on its current
                    // page, also when coming back from a page.
                    autoFocus={!followFocus && isCurrent}
                    onClick={() => onSelect(page)}
                    onKeyDown={(event) => onKeyDown(event, page)}
                    className={`flex h-8 w-full min-w-0 items-center gap-2.5 rounded-md px-2.5 text-left text-sm transition-colors duration-150 ${
                      isCurrent
                        ? 'bg-border/60 font-semibold text-text'
                        : 'text-muted hover:bg-border/40 hover:text-text'
                    }`}
                  >
                    <span className="flex w-4 shrink-0 justify-center">{PAGE_ICON[page]}</span>
                    <span className="min-w-0 flex-1 truncate">{pageLabel(page)}</span>
                    {dot && (
                      <>
                        <span
                          aria-hidden
                          data-settings-dot={dot}
                          className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT_CLASS[dot]}`}
                        />
                        <span className="sr-only">{t(`settings.nav.dot.${dot}`)}</span>
                      </>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </nav>
  )
}
