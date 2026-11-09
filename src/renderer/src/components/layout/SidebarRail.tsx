import { Icon } from '../ui/Icon'
import { icons } from '../ui/icons'
import { useTranslation } from 'react-i18next'
import { prKey } from '../../../../shared/scm'
import { useHomeOpenPr } from '../../hooks/use-home-open-pr'
import { useNeedsReviewCount } from '../../hooks/use-needs-review-count'
import { useUnreadActivityCount } from '../../hooks/use-activity'
import { useAppStore, type SidebarView } from '../../stores/app-store'
import { CountBadge } from '../ui/CountBadge'
import { SidebarToggle } from './SidebarToggle'

const VIEW_ICON: Record<SidebarView, React.JSX.Element> = {
  queue: <Icon icon={icons.queue} size="lg" />,
  inbox: <Icon icon={icons.inbox} size="lg" />,
}

const VIEWS: readonly SidebarView[] = ['queue', 'inbox']

/**
 * The sidebar folded: 56px that keep what matters in reach. The docked
 * column folds to it (Cmd/Ctrl+B, the toggle), and on the drawer tiers it
 * is always there, with the drawer opening over it. The two views with
 * their badges (PRs waiting for your review, unread activity) expand the
 * sidebar on that view, the PRs opened this session reopen in one click,
 * and the last button is the expand toggle, where the expanded footer has
 * its collapse one. Never an `aside`: the full list is the "Pull request
 * list" landmark, this is navigation.
 *
 * `covered`: the drawer is open on top of it. It stays in the row (the page
 * does not jump) but out of reach, and its toggle drops the test id so one
 * `sidebar-toggle` is ever on screen.
 */
export function SidebarRail({ covered = false }: { covered?: boolean }): React.JSX.Element {
  const { t } = useTranslation()
  const sidebarView = useAppStore((s) => s.sidebarView)
  const expandSidebar = useAppStore((s) => s.expandSidebar)
  const recentPrs = useAppStore((s) => s.recentPrs)
  const selectedKey = useAppStore((s) =>
    s.selectedPr && s.mainView === 'review' ? prKey(s.selectedPr.repo, s.selectedPr.number) : null,
  )
  const toReview = useNeedsReviewCount()
  const unreadActivity = useUnreadActivityCount()
  const { open } = useHomeOpenPr()

  const badge: Record<SidebarView, number> = { queue: toReview, inbox: unreadActivity }

  return (
    <nav
      aria-label={t('layout.rail.ariaLabel')}
      data-testid="sidebar-rail"
      inert={covered}
      aria-hidden={covered || undefined}
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
            onClick={() => expandSidebar(view)}
            aria-label={label}
            title={label}
            className={`relative flex h-10 w-10 items-center justify-center rounded-md transition-colors duration-150 ${
              sidebarView === view ? 'bg-accent/15 text-accent' : 'text-muted hover:bg-border/60 hover:text-text'
            }`}
          >
            {VIEW_ICON[view]}
            {badge[view] > 0 && (
              <CountBadge count={badge[view]} tone="accent" overlay />
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

      <div className="mt-auto">
        <SidebarToggle expanded={false} testId={!covered} />
      </div>
    </nav>
  )
}
