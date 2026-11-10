import { Icon } from '../ui/Icon'
import { icons } from '../ui/icons'
import { useTranslation } from 'react-i18next'
import type { ScmListError } from '../../../../shared/types'
import { SCM_PROVIDER_LABEL } from '../../lib/scm-labels'
import { enabledProviders, isSignInError } from '../../lib/scm-connection'
import { useDashboard } from '../../hooks/use-dashboard'
import { useScmSettings } from '../../hooks/use-scm-settings'
import { useLayoutTier } from '../../hooks/use-layout-tier'
import {
  clampSidebarWidth,
  dockedSidebarWidth,
  DRAWER_WIDTH,
  drawerWidth,
  SIDEBAR_MIN_WIDTH,
  sidebarIsDrawer,
} from '../../lib/layout'
import { useAppStore, type SidebarView } from '../../stores/app-store'
import { QueueView } from '../pr-list/QueueView'
import { InboxView } from '../pr-list/InboxView'
import { useUnreadActivityCount } from '../../hooks/use-activity'
import { useNeedsReviewCount } from '../../hooks/use-needs-review-count'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { SignInHint } from './SignInHint'
import { SidebarRail } from './SidebarRail'
import { SIDEBAR_SHORTCUT_LABEL, SidebarToggle } from './SidebarToggle'
import { ResizeHandle } from '../ui/ResizeHandle'
import { CountBadge } from '../ui/CountBadge'
import { InlineError } from '../ui/InlineError'
import { Drawer } from '../ui/Drawer'
import { settingsPageForScm } from '../../lib/settings-pages'
import { SEGMENTED_TRACK, segmentClasses } from '../ui/segmented-classes'

const VIEWS: readonly SidebarView[] = ['queue', 'inbox']

/** One line per provider that failed while the others still listed (typed code + message). */
function ProviderErrors({ errors }: { errors: ScmListError[] }): React.JSX.Element {
  return (
    <div className="flex w-full flex-col gap-1 border-b border-border p-3">
      {errors.map((providerError) => (
        <InlineError
          key={providerError.provider}
          data-error-code={providerError.code}
          message={`${SCM_PROVIDER_LABEL[providerError.provider]}: ${providerError.message}`}
        />
      ))}
    </div>
  )
}

/**
 * "Queue | Inbox" switch for the left column: Queue carries how many PRs
 * need your review, Inbox how many activity items are unread.
 */
function SidebarViewSwitch({
  value,
  onChange,
}: {
  value: SidebarView
  onChange: (view: SidebarView) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const toReview = useNeedsReviewCount()
  const unreadActivity = useUnreadActivityCount()
  const count: Record<SidebarView, number> = { queue: toReview, inbox: unreadActivity }
  return (
    <div
      role="group"
      aria-label={t('layout.sidebar.viewSwitch')}
      className={`flex w-full ${SEGMENTED_TRACK}`}
    >
      {VIEWS.map((view) => (
        <button
          key={view}
          type="button"
          aria-pressed={value === view}
          // The badge is decorative: the name says the count in words, like the rail.
          aria-label={
            count[view] > 0 ? t(`layout.rail.view.${view}WithCount`, { count: count[view] }) : undefined
          }
          onClick={() => onChange(view)}
          className={`flex min-w-0 flex-1 items-center justify-center gap-1 px-1 py-1 ${segmentClasses(value === view)}`}
        >
          <span className="truncate">{t(`layout.sidebar.views.${view}`)}</span>
          {count[view] > 0 && (
            <CountBadge
              count={count[view]}
              tone="accent"
              data-testid={view === 'inbox' ? 'inbox-unread-badge' : undefined}
            />
          )}
        </button>
      ))}
    </div>
  )
}

/**
 * The Queue, or what stands in for it when nothing can be listed: no
 * provider turned on, or every listing provider needs a sign-in. Both come
 * from the dashboard answer the queue itself reads (and the auth state), so
 * the sidebar never fetches a list of its own.
 */
function QueuePane(): React.JSX.Element {
  const { t } = useTranslation()
  const scmAuth = useAppStore((s) => s.scmAuth)
  const openSettings = useAppStore((s) => s.openSettings)
  const { pullRequests, providerErrors } = useDashboard()
  const scmSettings = useScmSettings().info
  const githubAccount = scmSettings?.githubAccount ?? null
  const azureOrganization = scmSettings?.providers.azure.organizations[0]?.organization
  const enabled = enabledProviders(scmSettings, scmAuth)
  const noProviders = enabled !== null && enabled.length === 0
  // Azure turned on without an organization: main reports it `disabled`.
  const azureNotConfigured =
    enabled?.includes('azure') === true && scmAuth?.azure?.state === 'disabled'

  const signInErrors = providerErrors.filter(isSignInError)
  // Full-panel sign-in CTA (one hint per provider that needs it) only when
  // nothing could be listed at all; otherwise the queue shows them as banners.
  const needsLogin = signInErrors.length > 0 && (pullRequests?.length ?? 0) === 0
  const otherErrors = providerErrors.filter((providerError) => !isSignInError(providerError))

  if (noProviders) {
    return (
      <div data-testid="no-providers" className="flex flex-col items-center gap-3 p-6 text-center">
        <p className="text-sm font-medium text-text">{t('layout.sidebar.noProvidersTitle')}</p>
        <p className="text-xs text-muted">{t('layout.sidebar.noProvidersHint')}</p>
        <Button variant="primary" onClick={() => openSettings('github')}>
          {t('layout.sidebar.openSettings')}
        </Button>
      </div>
    )
  }
  if (needsLogin) {
    return (
      <div data-testid="sign-in-needed" className="flex flex-col items-center gap-4 p-6 text-center">
        <Icon icon={icons.signIn} size="lg" className="text-muted" />
        {signInErrors.map((signInError) => (
          <SignInHint
            key={signInError.provider}
            error={signInError}
            githubAccount={githubAccount}
            azureOrganization={azureOrganization}
          />
        ))}
        <Button
          variant="primary"
          onClick={() => openSettings(settingsPageForScm(signInErrors[0].provider))}
        >
          {t('layout.sidebar.openSettings')}
        </Button>
        {otherErrors.length > 0 && <ProviderErrors errors={otherErrors} />}
      </div>
    )
  }
  return (
    <>
      {azureNotConfigured && (
        <p className="px-3 pt-2 text-xs text-warning">{t('layout.sidebar.azureNotConfigured')}</p>
      )}
      <QueueView />
    </>
  )
}

/**
 * Left column: the Queue (open PRs by what they need from you) or the
 * activity Inbox. Two shapes by layout tier (F16/T82):
 *
 * - `xl`/`lg`: a docked column (280/240px, draggable), foldable to the 56px
 *   rail (`sidebarCollapsed`, persisted).
 * - `md`/`sm` (a window tiled to half a screen or less): the rail always,
 *   and the full list as a **drawer overlay** over the page, closed by
 *   default. Measured reason (PLAN.md § F16): with a fixed column, at 960px
 *   the sidebar + file tree + didactic panel left the diff 40px. Picking a
 *   PR closes the drawer (`selectPr` in the store).
 *
 * In both, ONE toggle shows or hides the list, at the sidebar's
 * bottom-left: the expanded list's footer and the rail's last button sit in
 * the same spot (`SidebarToggle`). Cmd/Ctrl+B and the palette do the same.
 * The home dashboard is the main way to reach a PR, so the list is optional.
 */
export function Sidebar(): React.JSX.Element | null {
  const { t } = useTranslation()
  const searchQuery = useAppStore((s) => s.searchQuery)
  const setSearchQuery = useAppStore((s) => s.setSearchQuery)
  const sidebarView = useAppStore((s) => s.sidebarView)
  const setSidebarView = useAppStore((s) => s.setSidebarView)
  const tier = useLayoutTier()
  const isDrawer = sidebarIsDrawer(tier.w)
  const sidebarOpen = useAppStore((s) => s.sidebarOpen)
  const closeSidebar = useAppStore((s) => s.closeSidebar)
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed)
  const walkthroughFocus = useAppStore((s) => s.walkthroughFocus)
  const preferredWidth = useAppStore((s) => s.sidebarWidth)
  const setSidebarWidth = useAppStore((s) => s.setSidebarWidth)

  // The full-screen walkthrough takes the whole window.
  if (walkthroughFocus) return null
  // Docked tiers, folded by the toggle / Cmd+B (persisted): the rail.
  if (!isDrawer && sidebarCollapsed) return <SidebarRail />
  // Drawer tiers, drawer closed: only the rail.
  if (isDrawer && !sidebarOpen) return <SidebarRail />

  // As a drawer, `ui/Drawer` draws the edge and the shadow (and claims Esc,
  // so a dashboard page's `useEscapeBack` does not also go back).
  const asideClass = isDrawer
    ? 'flex h-full w-full min-w-0 flex-col bg-panel'
    : 'flex w-full min-w-0 flex-col border-r border-border bg-panel'

  const aside = (
    <aside aria-label={t('layout.sidebar.ariaLabel')} className={asideClass}>
      {/* Scrolls on its own so the footer toggle never scrolls away (and the
          Inbox's sticky toast stays above it). */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="shrink-0 px-2 pt-2">
          <SidebarViewSwitch value={sidebarView} onChange={setSidebarView} />
        </div>
        {/* Filters both views locally. */}
        <div className="shrink-0 px-2 pt-2">
          <Input
            type="search"
            fieldSize="lg"
            icon={<Icon icon={icons.search} size="sm" />}
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder={t('layout.sidebar.searchPlaceholder')}
            aria-label={t('layout.sidebar.search')}
            title={t('layout.sidebar.searchPlaceholder')}
          />
        </div>
        {sidebarView === 'inbox' ? <InboxView /> : <QueuePane />}
      </div>
      <div className="@container flex shrink-0 items-center gap-2 border-t border-border px-2 py-2">
        <SidebarToggle expanded />
        <span aria-hidden className="min-w-0 truncate text-[11px] text-muted @max-[9rem]:hidden">
          {t('layout.sidebar.collapseHint', { shortcut: SIDEBAR_SHORTCUT_LABEL })}
        </span>
      </div>
    </aside>
  )

  if (isDrawer) {
    // The rail stays in the row (the drawer covers it), out of reach while it does.
    return (
      <>
        <SidebarRail covered />
        <Drawer
          side="left"
          label={t('layout.sidebar.ariaLabel')}
          width={drawerWidth(DRAWER_WIDTH.sidebar, tier.width)}
          onClose={closeSidebar}
        >
          {aside}
        </Drawer>
      </>
    )
  }

  // Docked: the column wraps the aside so the drag handle on its right edge
  // never gets clipped; double-click goes back to the tier's default width.
  const width = dockedSidebarWidth(preferredWidth, tier.width)
  const maxWidth = clampSidebarWidth(Number.POSITIVE_INFINITY, tier.width)
  return (
    <div style={{ width }} className="relative flex shrink-0">
      {aside}
      <ResizeHandle
        edge="right"
        value={width}
        min={SIDEBAR_MIN_WIDTH}
        max={maxWidth}
        onChange={setSidebarWidth}
        onReset={() => setSidebarWidth(null)}
        label={t('layout.sidebar.resize')}
        title={t('layout.sidebar.resizeHint')}
        data-testid="sidebar-resize"
      />
    </div>
  )
}
