import { Bell, FolderGit2, Layers, ListTodo, PanelLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { prKey } from '../../../../shared/scm'
import { useHomeOpenPr } from '../../hooks/use-home-open-pr'
import { useNeedsReviewCount } from '../../hooks/use-needs-review-count'
import { useUnreadActivityCount } from '../../hooks/use-activity'
import { countOrphans } from '../../lib/stacks'
import { MOD_KEY_LABEL } from '../../lib/platform'
import { useAppStore, type SidebarView } from '../../stores/app-store'
import { useStacksStore } from '../../stores/stacks-store'

const VIEW_ICON: Record<SidebarView, React.JSX.Element> = {
  queue: <ListTodo size={18} aria-hidden />,
  list: <FolderGit2 size={18} aria-hidden />,
  stacks: <Layers size={18} aria-hidden />,
  inbox: <Bell size={18} aria-hidden />,
}

const VIEWS: readonly SidebarView[] = ['queue', 'list', 'stacks', 'inbox']

/**
 * The docked sidebar folded (Cmd/Ctrl+B, title bar toggle): 56px that keep
 * what matters in reach. The three views with their badges (PRs waiting for
 * your review, orphaned stacks) expand the sidebar on that view, and the PRs
 * opened this session reopen in one click. Never a `aside`: the full list is
 * the "Pull request list" landmark, this is navigation.
 */
export function SidebarRail(): React.JSX.Element {
  const { t } = useTranslation()
  const sidebarView = useAppStore((s) => s.sidebarView)
  const setSidebarView = useAppStore((s) => s.setSidebarView)
  const toggleSidebarCollapsed = useAppStore((s) => s.toggleSidebarCollapsed)
  const recentPrs = useAppStore((s) => s.recentPrs)
  const selectedKey = useAppStore((s) =>
    s.selectedPr && s.mainView === 'review' ? prKey(s.selectedPr.repo, s.selectedPr.number) : null,
  )
  const toReview = useNeedsReviewCount()
  const unreadActivity = useUnreadActivityCount()
  const orphans = useStacksStore((s) => (s.result ? countOrphans(s.result.stacks) : 0))
  const { open } = useHomeOpenPr()

  const badge: Record<SidebarView, number> = {
    queue: toReview,
    list: 0,
    stacks: orphans,
    inbox: unreadActivity,
  }

  return (
    <nav
      aria-label={t('layout.rail.ariaLabel')}
      data-testid="sidebar-rail"
      className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-border bg-panel py-2"
    >
      {VIEWS.map((view) => {
        const label =
          badge[view] > 0
            ? t(`layout.rail.view.${view}WithCount`, { count: badge[view] })
            : t(`layout.rail.view.${view}`)
        return (
          <button
            key={view}
            type="button"
            onClick={() => {
              setSidebarView(view)
              toggleSidebarCollapsed()
            }}
            aria-label={label}
            title={label}
            className={`relative flex h-10 w-10 items-center justify-center rounded-md transition-colors duration-150 ${
              sidebarView === view ? 'bg-accent/15 text-accent' : 'text-muted hover:bg-border/60 hover:text-text'
            }`}
          >
            {VIEW_ICON[view]}
            {badge[view] > 0 && (
              <span
                aria-hidden
                className={`absolute right-0.5 top-0.5 min-w-4 rounded-full px-1 text-center text-[9px] font-bold leading-4 ring-2 ring-panel ${
                  view === 'stacks' ? 'bg-warning text-bg' : 'bg-accent text-accent-fg'
                }`}
              >
                {badge[view]}
              </span>
            )}
          </button>
        )
      })}

      {recentPrs.length > 0 && <span className="my-1.5 h-px w-6 bg-border" aria-hidden />}
      {recentPrs.length > 0 && (
        <ul aria-label={t('layout.rail.recent')} className="flex flex-col items-center gap-1">
          {recentPrs.map((pr) => {
            const key = prKey(pr.repo, pr.number)
            const current = key === selectedKey
            const label = t('layout.rail.openPr', { number: pr.number, title: pr.title })
            return (
              <li key={key}>
                <button
                  type="button"
                  onClick={() => open(pr)}
                  aria-label={label}
                  aria-current={current ? 'page' : undefined}
                  title={pr.repo.fullName + ' #' + pr.number + ' · ' + pr.title}
                  className={`flex h-9 w-10 items-center justify-center rounded-md font-mono text-[10px] font-semibold transition-colors duration-150 ${
                    current
                      ? 'bg-accent/15 text-accent ring-1 ring-accent/50'
                      : 'text-muted hover:bg-border/60 hover:text-text'
                  }`}
                >
                  {String(pr.number).slice(-4)}
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <button
        type="button"
        onClick={toggleSidebarCollapsed}
        aria-label={t('layout.titleBar.sidebarShow')}
        title={t('layout.rail.expand', { shortcut: MOD_KEY_LABEL + 'B' })}
        className="mt-auto flex h-9 w-10 items-center justify-center rounded-md text-muted transition-colors duration-150 hover:bg-border/60 hover:text-text"
      >
        <PanelLeft size={16} aria-hidden />
      </button>
    </nav>
  )
}
