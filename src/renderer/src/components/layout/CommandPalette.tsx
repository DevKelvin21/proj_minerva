import { useEffect, useMemo, useRef, useState } from 'react'
import { FileCode2, GitPullRequest, Search, Terminal } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { prKey } from '../../../../shared/scm'
import type { PullRequestSummary } from '../../../../shared/types'
import { useAppStore } from '../../stores/app-store'
import { useDashboard } from '../../hooks/use-dashboard'
import { useHomeOpenPr } from '../../hooks/use-home-open-pr'
import { usePullRequestFiles } from '../../hooks/use-pull-request-files'
import {
  filterPaletteItems,
  stepIndex,
  type PaletteGroup,
  type PaletteItem,
} from '../../lib/command-palette'
import { sidebarIsDrawer, widthTier } from '../../lib/layout'
import { MOD_KEY_LABEL } from '../../lib/platform'
import { Dialog } from '../ui/Dialog'
import { fieldBareClass } from '../ui/field-classes'
import { Kbd } from '../ui/Kbd'

/** Key names are the same in every language (macOS and Windows label the key so). */
const ESC_KEY = 'Esc'

const GROUP_ICON: Record<PaletteGroup, React.JSX.Element> = {
  commands: <Terminal size={14} aria-hidden />,
  pullRequests: <GitPullRequest size={14} aria-hidden />,
  files: <FileCode2 size={14} aria-hidden />,
}

/** Commands that always make sense, plus the review ones when a PR is on screen. */
function useCommandItems(): PaletteItem[] {
  const { t } = useTranslation()
  const mainView = useAppStore((s) => s.mainView)
  const hasPr = useAppStore((s) => s.selectedPr !== null)
  const didacticOpen = useAppStore((s) => s.didacticPanelOpen)
  return useMemo(() => {
    const store = useAppStore.getState
    const items: PaletteItem[] = [
      {
        id: 'cmd:home',
        group: 'commands',
        label: t('layout.palette.command.home'),
        run: () => store().goHome(),
      },
      {
        id: 'cmd:prList',
        group: 'commands',
        label: t('layout.palette.command.prList'),
        shortcut: MOD_KEY_LABEL + 'B',
        run: () => {
          // Same rule as the shortcut: the drawer on narrow tiers, the docked column otherwise.
          if (sidebarIsDrawer(widthTier(window.innerWidth))) store().toggleSidebar()
          else store().toggleSidebarCollapsed()
        },
      },
      {
        id: 'cmd:settings',
        group: 'commands',
        label: t('layout.palette.command.settings'),
        keywords: t('layout.palette.command.settingsKeywords'),
        run: () => store().openSettings(),
      },
    ]
    if (hasPr && mainView === 'home') {
      items.push({
        id: 'cmd:review',
        group: 'commands',
        label: t('layout.palette.command.continueReview'),
        run: () => store().showReview(),
      })
    }
    if (hasPr && mainView === 'review') {
      items.push(
        {
          id: 'cmd:walkthrough',
          group: 'commands',
          label: t('layout.palette.command.walkthrough'),
          keywords: t('layout.palette.command.walkthroughKeywords'),
          run: () => store().openWalkthroughFocus(),
        },
        {
          id: 'cmd:conversation',
          group: 'commands',
          label: t('layout.palette.command.conversation'),
          run: () => store().setCenterTab('conversation'),
        },
        {
          id: 'cmd:files',
          group: 'commands',
          label: t('layout.palette.command.files'),
          run: () => store().setCenterTab('files'),
        },
        {
          id: 'cmd:comments',
          group: 'commands',
          label: t('layout.palette.command.comments'),
          run: () => store().setCenterTab('comments'),
        },
        {
          id: 'cmd:didactic',
          group: 'commands',
          label: didacticOpen
            ? t('layout.palette.command.hideDidactic')
            : t('layout.palette.command.showDidactic'),
          keywords: t('layout.palette.command.didacticKeywords'),
          run: () => store().toggleDidacticPanel(),
        },
      )
    }
    return items
  }, [t, mainView, hasPr, didacticOpen])
}

function prItems(
  pullRequests: readonly PullRequestSummary[],
  open: (pr: PullRequestSummary) => void,
): PaletteItem[] {
  return pullRequests.map((pr) => ({
    id: 'pr:' + prKey(pr.repo, pr.number),
    group: 'pullRequests' as const,
    label: pr.title,
    detail: pr.repo.fullName + ' · #' + pr.number + ' · ' + pr.headRef,
    keywords: '#' + pr.number + ' ' + pr.author.login,
    run: () => open(pr),
  }))
}

/** Files of the PR under review (only fetched while the palette is open on a review). */
function useFileItems(pr: PullRequestSummary): PaletteItem[] {
  const { files } = usePullRequestFiles(pr.repo, pr.number)
  return useMemo(
    () =>
      files.map((file) => {
        const slash = file.path.lastIndexOf('/')
        return {
          id: 'file:' + file.path,
          group: 'files' as const,
          label: slash >= 0 ? file.path.slice(slash + 1) : file.path,
          detail: file.path,
          run: () => {
            const store = useAppStore.getState()
            store.setCenterTab('files')
            store.setSelectedFilePath(file.path)
          },
        }
      }),
    [files],
  )
}

/**
 * Cmd/Ctrl+K: one field to jump anywhere — a command, any open PR the
 * dashboard knows, or a file of the PR under review. Arrow keys move, Enter
 * runs, Esc closes (`ui/Dialog` claims it, so a dashboard page does not also go back).
 * Mounted only while open, so its state (query, highlight) starts fresh.
 */
export function CommandPalette(): React.JSX.Element {
  const selectedPr = useAppStore((s) => s.selectedPr)
  const mainView = useAppStore((s) => s.mainView)
  const reviewPr = mainView === 'review' ? selectedPr : null
  return reviewPr ? (
    <ReviewPalette key={prKey(reviewPr.repo, reviewPr.number)} pr={reviewPr} />
  ) : (
    <PaletteDialog fileItems={[]} />
  )
}

function ReviewPalette({ pr }: { pr: PullRequestSummary }): React.JSX.Element {
  return <PaletteDialog fileItems={useFileItems(pr)} />
}

function PaletteDialog({ fileItems }: { fileItems: PaletteItem[] }): React.JSX.Element {
  const { t } = useTranslation()
  const close = useAppStore((s) => s.closeCommandPalette)
  const commandItems = useCommandItems()
  const { pullRequests } = useDashboard()
  const { open } = useHomeOpenPr()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLUListElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const items = useMemo(
    () =>
      filterPaletteItems(
        [...commandItems, ...prItems(pullRequests ?? [], open), ...fileItems],
        query,
      ),
    [commandItems, pullRequests, open, fileItems, query],
  )
  const activeIndex = Math.min(active, Math.max(items.length - 1, 0))
  const activeItem = items[activeIndex]

  useEffect(() => {
    listRef.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  const run = (item: PaletteItem | undefined): void => {
    if (!item) return
    close()
    item.run()
  }

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setActive(stepIndex(activeIndex, event.key === 'ArrowDown' ? 1 : -1, items.length))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      run(activeItem)
    }
  }

  return (
    <Dialog
      onClose={close}
      label={t('layout.palette.ariaLabel')}
      placement="top"
      initialFocus={inputRef}
      testId="command-palette"
      onKeyDown={onKeyDown}
      className="max-h-[min(520px,calc(100vh-6rem))] w-full max-w-xl"
    >
      {/* The search row is the field: while the input has focus, its divider turns to the
          focus color across the panel's full width, icon included. */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 transition-[border-color,box-shadow] duration-150 focus-within:border-focus focus-within:shadow-[inset_0_-1px_0_var(--color-focus)]">
        <Search size={16} className="shrink-0 text-muted" aria-hidden />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls="command-palette-list"
          aria-activedescendant={activeItem ? 'palette-' + activeItem.id : undefined}
          aria-label={t('layout.palette.inputLabel')}
          placeholder={t('layout.palette.placeholder')}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setActive(0)
          }}
          className={`h-12 min-w-0 flex-1 text-sm ${fieldBareClass}`}
        />
        <Kbd>{ESC_KEY}</Kbd>
      </div>
      <ul
        ref={listRef}
        id="command-palette-list"
        role="listbox"
        aria-label={t('layout.palette.resultsLabel')}
        className="min-h-0 flex-1 overflow-y-auto p-1.5"
      >
        {items.length === 0 && (
          <li className="px-3 py-6 text-center text-sm text-muted" role="presentation">
            {t('layout.palette.noResults', { query })}
          </li>
        )}
        {items.map((item, index) => {
          const header = items[index - 1]?.group !== item.group
          const selected = index === activeIndex
          return (
            <li key={item.id} role="presentation">
              {header && (
                <div
                  role="presentation"
                  className="px-2.5 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted"
                >
                  {t(`layout.palette.group.${item.group}`)}
                </div>
              )}
              <div
                id={'palette-' + item.id}
                role="option"
                aria-selected={selected}
                onMouseMove={() => {
                  if (!selected) setActive(index)
                }}
                onClick={() => run(item)}
                className={`flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm ${
                  selected ? 'bg-accent/15 text-text' : 'text-text'
                }`}
              >
                <span className={selected ? 'text-accent' : 'text-muted'}>
                  {GROUP_ICON[item.group]}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{item.label}</span>
                  {item.detail && (
                    <span className="truncate text-xs text-muted">{item.detail}</span>
                  )}
                </span>
                {item.shortcut && <Kbd>{item.shortcut}</Kbd>}
              </div>
            </li>
          )
        })}
      </ul>
    </Dialog>
  )
}
