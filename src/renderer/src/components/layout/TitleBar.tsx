import {
  ChevronLeft,
  ChevronRight,
  GraduationCap,
  Home,
  PanelLeft,
  PanelLeftClose,
  Search,
  Settings,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '../../stores/app-store'
import { useLayoutTier } from '../../hooks/use-layout-tier'
import { sidebarIsDrawer } from '../../lib/layout'
import { useUpdater } from '../../hooks/use-updater'
import { MOD_KEY_LABEL } from '../../lib/platform'
import { IconButton } from '../ui/IconButton'
import { Kbd } from '../ui/Kbd'
import { AccountsMenu, ScmAttentionChips, type AuthChipDensity } from './ScmAuthChips'
import { AiStatusChip } from './AiStatusChip'
import { TitleBarLocation } from './TitleBarLocation'
import { WalkthroughProgress } from './WalkthroughProgress'

/** Key names read the same in every language. */
const ESC_KEY = 'Esc'

/**
 * Settings gear, with a discreet dot when an update is available or
 * downloaded (never a banner). It keeps the `lucide-settings` icon: the e2e
 * suite finds Settings by `svg.lucide-settings`.
 */
function SettingsButton(): React.JSX.Element {
  const { t } = useTranslation()
  const openSettings = useAppStore((s) => s.openSettings)
  const { status } = useUpdater()
  const showUpdateDot = status?.phase === 'available' || status?.phase === 'downloaded'
  return (
    <span className="relative inline-flex">
      <IconButton
        icon={<Settings size={16} />}
        label={
          showUpdateDot
            ? t('layout.settingsChip.settingsWithUpdate')
            : t('layout.settingsChip.settings')
        }
        onClick={openSettings}
      />
      {showUpdateDot && (
        <span
          className="pointer-events-none absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-accent ring-2 ring-panel"
          aria-hidden
          title={t('layout.settingsChip.updateAvailable')}
        />
      )}
    </span>
  )
}

/** "Jump to a PR, file or command" — opens the Cmd/Ctrl+K palette. */
function CommandBarButton({ size }: { size: 'wide' | 'short' | 'icon' }): React.JSX.Element {
  const { t } = useTranslation()
  const openPalette = useAppStore((s) => s.openCommandPalette)
  const label = t('layout.titleBar.jumpTo', { shortcut: MOD_KEY_LABEL + 'K' })
  if (size === 'icon') {
    return <IconButton icon={<Search size={16} />} label={label} onClick={openPalette} />
  }
  return (
    <button
      type="button"
      onClick={openPalette}
      title={label}
      aria-label={label}
      data-testid="command-bar"
      className={`flex h-8 min-w-0 items-center gap-2 rounded-md border border-border bg-bg pl-2.5 pr-1.5 text-sm text-muted transition-colors duration-150 hover:border-accent hover:text-text ${
        size === 'wide' ? 'w-[min(340px,100%)]' : ''
      }`}
    >
      <Search size={14} className="shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 truncate text-left">
        {size === 'wide' ? t('layout.titleBar.jumpPlaceholder') : t('layout.titleBar.jumpShort')}
      </span>
      <Kbd>{MOD_KEY_LABEL}K</Kbd>
    </button>
  )
}

/**
 * The window's title bar (the native frame is gone: `main/windows/title-bar.ts`).
 * One row for where you are, what you can do and who is working:
 *
 *   [OS controls] [PR list] [Home] | repo › #n Title   [Jump to… ⌘K]   [AI] [panel] [accounts] [⚙]
 *
 * The whole row drags the window (`app-drag`); every control opts out. The
 * OS window controls get their band back through `env(titlebar-area-*)`:
 * the traffic lights on the left on macOS (gone in full screen), the
 * overlay on the right on Windows and Linux.
 *
 * Progressive disclosure by tier (F16), in the order content gives way:
 * `lg` drops the "via …" badges and the AI chip's model and status text
 * (both stay in its tooltip); `md` drops the repo crumb and the state pill,
 * and the command bar shrinks; `sm` keeps only icons around the PR title.
 */
export function TitleBar(): React.JSX.Element {
  const { t } = useTranslation()
  const didacticPanelOpen = useAppStore((s) => s.didacticPanelOpen)
  const toggleDidacticPanel = useAppStore((s) => s.toggleDidacticPanel)
  const sidebarOpen = useAppStore((s) => s.sidebarOpen)
  const toggleSidebar = useAppStore((s) => s.toggleSidebar)
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed)
  const toggleSidebarCollapsed = useAppStore((s) => s.toggleSidebarCollapsed)
  const mainView = useAppStore((s) => s.mainView)
  const goHome = useAppStore((s) => s.goHome)
  const selectedPr = useAppStore((s) => s.selectedPr)
  const focusPr = useAppStore((s) =>
    s.walkthroughFocus && s.mainView === 'review' ? s.selectedPr : null,
  )
  const closeFocus = useAppStore((s) => s.closeWalkthroughFocus)
  const tier = useLayoutTier()

  const showDrawerToggle = sidebarIsDrawer(tier.w)
  const compact = tier.w === 'md' || tier.w === 'sm'
  const authDensity: AuthChipDensity =
    tier.w === 'xl' ? 'full' : tier.w === 'lg' ? 'identity' : 'icon'
  const commandSize = tier.w === 'sm' ? 'icon' : compact ? 'short' : 'wide'

  return (
    <header
      className="app-drag relative flex h-11 shrink-0 items-center gap-1 border-b border-border bg-panel"
      style={{
        paddingLeft: 'max(8px, env(titlebar-area-x, 0px))',
        paddingRight:
          'max(8px, calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw)))',
      }}
    >
      {/* Full-screen walkthrough: one way out (Esc too) instead of the navigation. */}
      {focusPr ? (
        <button
          type="button"
          onClick={closeFocus}
          data-testid="walkthrough-exit"
          className="flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-text transition-colors duration-150 hover:bg-border/60"
        >
          <ChevronLeft size={16} aria-hidden />
          {tier.w !== 'sm' && t('prDetail.focus.exit')}
          <Kbd>{ESC_KEY}</Kbd>
        </button>
      ) : /* PR list toggle: the drawer on narrow tiers (its label is what the
          e2e suite looks for), the hideable docked column on wide ones. */
      showDrawerToggle ? (
        <IconButton
          icon={<PanelLeft size={16} />}
          label={t('layout.titleBar.prListToggle')}
          active={sidebarOpen}
          onClick={toggleSidebar}
          aria-expanded={sidebarOpen}
          data-testid="sidebar-toggle"
        />
      ) : (
        <IconButton
          icon={sidebarCollapsed ? <PanelLeft size={16} /> : <PanelLeftClose size={16} />}
          label={
            sidebarCollapsed ? t('layout.titleBar.sidebarShow') : t('layout.titleBar.sidebarHide')
          }
          active={!sidebarCollapsed}
          onClick={toggleSidebarCollapsed}
          aria-expanded={!sidebarCollapsed}
          data-testid="sidebar-toggle"
        />
      )}

      {!focusPr && (
        <IconButton
          icon={<Home size={16} />}
          label={t('layout.titleBar.home')}
          active={mainView === 'home'}
          onClick={goHome}
          data-testid="home-button"
        />
      )}

      <span className="mx-1.5 h-5 w-px shrink-0 bg-border" aria-hidden />

      <div className="flex min-w-0 flex-1 items-center gap-3">
        <TitleBarLocation compact={compact || focusPr !== null} />
        {focusPr && (
          <span className="flex shrink-0 items-center gap-1 text-sm font-semibold text-text">
            <ChevronRight size={14} className="text-muted/60" aria-hidden />
            {t('prDetail.focus.title')}
          </span>
        )}
        {/* Centered in the free band on wide windows, inline when it would collide. */}
        <div
          className={`flex min-w-0 shrink justify-end ${commandSize === 'wide' ? 'mx-auto' : 'ml-auto'}`}
        >
          {focusPr ? <WalkthroughProgress pr={focusPr} /> : <CommandBarButton size={commandSize} />}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 pl-2">
        <ScmAttentionChips density={authDensity} />
        <AiStatusChip compact={tier.w !== 'xl'} />
        {/* The didactic panel only exists in the review view. */}
        {mainView === 'review' && !focusPr && selectedPr && (
          <IconButton
            icon={<GraduationCap size={16} />}
            label={t('layout.titleBar.didacticPanel')}
            active={didacticPanelOpen}
            onClick={toggleDidacticPanel}
          />
        )}
        <AccountsMenu />
        <SettingsButton />
      </div>
    </header>
  )
}
