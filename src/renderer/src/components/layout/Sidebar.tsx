import { useEffect, useMemo, useRef } from 'react'
import { RefreshCw, Search } from 'lucide-react'
import { Trans, useTranslation } from 'react-i18next'
import type { PrStateFilter, PullRequestSummary, ScmListError } from '../../../../shared/types'
import { repoKey } from '../../../../shared/scm'
import { SCM_PROVIDER_LABEL } from '../../lib/scm-labels'
import { enabledProviders, isSignInError } from '../../lib/scm-connection'
import { groupByRepo } from '../../lib/pr-filters'
import { usePullRequests } from '../../hooks/use-pull-requests'
import { useScmSettings } from '../../hooks/use-scm-settings'
import { useLayoutTier } from '../../hooks/use-layout-tier'
import {
  clampSidebarWidth,
  dockedSidebarWidth,
  SIDEBAR_MIN_WIDTH,
  sidebarIsDrawer,
} from '../../lib/layout'
import { useAppStore, type SidebarView } from '../../stores/app-store'
import { useStacksStore } from '../../stores/stacks-store'
import { countOrphans } from '../../lib/stacks'
import { RepoGroup } from '../pr-list/RepoGroup'
import { StacksView } from '../stacks/StacksView'
import { QueueView } from '../pr-list/QueueView'
import { InboxView } from '../pr-list/InboxView'
import { useUnreadActivityCount } from '../../hooks/use-activity'
import { useNeedsReviewCount } from '../../hooks/use-needs-review-count'
import { IconButton } from '../ui/IconButton'
import { SignInHint } from './SignInHint'
import { SidebarRail } from './SidebarRail'
import { CountBadge } from '../ui/CountBadge'

const STATE_FILTER_OPTIONS: readonly PrStateFilter[] = ['open', 'closed', 'all']

/** One line per provider that failed while the others still listed (typed code + message). */
function ProviderErrors({ errors }: { errors: ScmListError[] }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1 border-b border-border p-3">
      {errors.map((providerError) => (
        <p
          key={providerError.provider}
          data-error-code={providerError.code}
          className="text-xs text-danger"
        >
          {SCM_PROVIDER_LABEL[providerError.provider]}: {providerError.message}
        </p>
      ))}
    </div>
  )
}

/** Segmented control de 3 opciones (T52, F10) para `prStateFilter`. */
function StateFilterControl({
  value,
  onChange,
}: {
  value: PrStateFilter
  onChange: (filter: PrStateFilter) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="flex rounded-md border border-border bg-bg p-0.5 text-xs">
      {STATE_FILTER_OPTIONS.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={value === option}
          onClick={() => onChange(option)}
          className={`rounded px-2 py-1 font-medium transition-colors duration-150 ${
            value === option ? 'bg-accent/15 text-accent' : 'text-muted hover:text-text'
          }`}
        >
          {t(`layout.sidebar.stateFilter.${option}`)}
        </button>
      ))}
    </div>
  )
}

/**
 * "Queue | Repos | Stacks" switch for the left column. Queue carries how many
 * PRs need your review; Stacks the orphan count once some consumer loaded the
 * stacks (it does not trigger the fetch itself: that is a cold ~10 s read on
 * a real org).
 */
function SidebarViewSwitch({
  value,
  onChange,
}: {
  value: SidebarView
  onChange: (view: SidebarView) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const orphans = useStacksStore((s) => (s.result ? countOrphans(s.result.stacks) : 0))
  const toReview = useNeedsReviewCount()
  const unreadActivity = useUnreadActivityCount()
  const count: Record<SidebarView, number> = {
    queue: toReview,
    list: 0,
    stacks: orphans,
    inbox: unreadActivity,
  }
  const options: { value: SidebarView; label: string }[] = [
    { value: 'queue', label: t('layout.sidebar.views.queue') },
    { value: 'list', label: t('layout.sidebar.views.list') },
    { value: 'stacks', label: t('layout.sidebar.views.stacks') },
    { value: 'inbox', label: t('layout.sidebar.views.inbox') },
  ]
  return (
    <div
      role="group"
      aria-label={t('layout.sidebar.viewSwitch')}
      className="flex w-full rounded-md border border-border bg-bg p-0.5 text-xs"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          // The badge is decorative: the name says the count in words, like the rail.
          aria-label={
            count[option.value] > 0
              ? t(`layout.rail.view.${option.value}WithCount`, { count: count[option.value] })
              : undefined
          }
          onClick={() => onChange(option.value)}
          className={`flex min-w-0 flex-auto items-center justify-center gap-0.5 rounded px-1 py-1 font-medium transition-colors duration-150 ${
            value === option.value ? 'bg-accent/15 text-accent' : 'text-muted hover:text-text'
          }`}
        >
          <span className="truncate">{option.label}</span>
          {count[option.value] > 0 && (
            <CountBadge
              count={count[option.value]}
              tone={option.value === 'stacks' ? 'warning' : 'accent'}
              data-testid={option.value === 'inbox' ? 'inbox-unread-badge' : undefined}
            />
          )}
        </button>
      ))}
    </div>
  )
}

/**
 * Lista de PRs. Dos formas según el tier de layout (F16/T82):
 *
 * - `xl`/`lg`: columna acoplada de 280/240px, como siempre.
 * - `md`/`sm` (ventana tileada a media pantalla o menos): **drawer overlay**
 *   sobre el centro, cerrado por defecto y abierto desde el botón del TitleBar.
 *   Motivo medido (PLAN.md § F16): con la columna fija, a 960px de ancho la
 *   sidebar + el árbol de archivos + el panel didáctico dejaban el diff en
 *   40px. Elegir un PR cierra el drawer (`selectPr` en el store).
 *
 * Los hooks de datos corren SIEMPRE, también con el drawer cerrado: la lista
 * (y su watcher) no debe depender de si el overlay está visible.
 *
 * On the docked tiers the column can also be hidden (`sidebarCollapsed`,
 * TitleBar toggle or Cmd/Ctrl+B): the home dashboard is the main way to
 * reach a PR, so the list is optional there.
 */
export function Sidebar(): React.JSX.Element | null {
  const { t } = useTranslation()
  const searchQuery = useAppStore((s) => s.searchQuery)
  const setSearchQuery = useAppStore((s) => s.setSearchQuery)
  const scmAuth = useAppStore((s) => s.scmAuth)
  const openSettings = useAppStore((s) => s.openSettings)
  const prStateFilter = useAppStore((s) => s.prStateFilter)
  const setPrStateFilter = useAppStore((s) => s.setPrStateFilter)
  const selectPr = useAppStore((s) => s.selectPr)
  const sidebarView = useAppStore((s) => s.sidebarView)
  const setSidebarView = useAppStore((s) => s.setSidebarView)
  // Opaque key of every provider's auth state: signing in (or switching
  // accounts) refetches the list.
  const authKey = scmAuth
    ? Object.values(scmAuth)
        .map((status) => status.provider + ':' + status.state + ':' + (status.user?.login ?? ''))
        .join(',')
    : ''
  const { pullRequests, providerErrors, loading, error, refetch, markSeen } = usePullRequests(
    searchQuery,
    authKey,
    prStateFilter,
  )
  const scmSettings = useScmSettings().info
  const githubAccount = scmSettings?.githubAccount ?? null
  const azureOrganization = scmSettings?.providers.azure.organizations[0]?.organization
  const enabled = enabledProviders(scmSettings, scmAuth)
  const noProviders = enabled !== null && enabled.length === 0
  // Azure turned on without an organization: main reports it `disabled`.
  const azureNotConfigured =
    enabled?.includes('azure') === true && scmAuth?.azure?.state === 'disabled'
  const tier = useLayoutTier()
  const isDrawer = sidebarIsDrawer(tier.w)
  const sidebarOpen = useAppStore((s) => s.sidebarOpen)
  const closeSidebar = useAppStore((s) => s.closeSidebar)
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed)
  const walkthroughFocus = useAppStore((s) => s.walkthroughFocus)
  const preferredWidth = useAppStore((s) => s.sidebarWidth)
  const setSidebarWidth = useAppStore((s) => s.setSidebarWidth)
  const columnRef = useRef<HTMLDivElement>(null)

  // Esc cierra el drawer (solo cuando está abierto y no hay un modal encima:
  // `SettingsModal` monta su propio listener y también cierra con Esc).
  const settingsOpen = useAppStore((s) => s.settingsOpen)
  useEffect(() => {
    if (!isDrawer || !sidebarOpen || settingsOpen) return
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      // Claimed: a dashboard page's Esc (`useEscapeBack`) must not also go back.
      event.preventDefault()
      closeSidebar()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [isDrawer, sidebarOpen, settingsOpen, closeSidebar])

  const groups = useMemo(() => groupByRepo(pullRequests), [pullRequests])
  const signInErrors = providerErrors.filter(isSignInError)
  // Full-panel sign-in CTA (one hint per provider that needs it) only when
  // nothing could be listed at all.
  const needsLogin = signInErrors.length > 0 && pullRequests.length === 0
  // Everything else (or a sign-in error while other providers did list) is a banner.
  const otherErrors = needsLogin
    ? providerErrors.filter((providerError) => !isSignInError(providerError))
    : providerErrors

  const handleSelectPr = (pr: PullRequestSummary): void => {
    selectPr(pr)
    markSeen(pr)
  }

  // The full-screen walkthrough takes the whole window (the hooks above keep running).
  if (walkthroughFocus) return null
  if (isDrawer && !sidebarOpen) return null
  // Docked tiers, folded by the TitleBar toggle / Cmd+B (persisted): the rail.
  if (!isDrawer && sidebarCollapsed) return <SidebarRail />

  const asideClass = isDrawer
    ? 'absolute inset-y-0 left-0 z-40 flex w-[300px] max-w-[85%] flex-col overflow-y-auto border-r border-border bg-panel shadow-2xl'
    : 'flex w-full min-w-0 flex-col overflow-y-auto border-r border-border bg-panel'
  const width = dockedSidebarWidth(preferredWidth, tier.width)
  const maxWidth = clampSidebarWidth(Number.POSITIVE_INFINITY, tier.width)

  const aside = (
    <aside aria-label={t('layout.sidebar.ariaLabel')} className={asideClass}>
      <div className="shrink-0 px-2 pt-2">
        <SidebarViewSwitch value={sidebarView} onChange={setSidebarView} />
      </div>
      {/* Filters both views: a provider-side search for the list (GitHub
          qualifiers work), a text filter for the stacks. */}
      <div className="relative shrink-0 px-2 pt-2">
        <Search
          size={14}
          className="pointer-events-none absolute left-4 top-1/2 mt-1 -translate-y-1/2 text-muted"
          aria-hidden
        />
        <input
          type="search"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder={t('layout.sidebar.searchPlaceholder')}
          aria-label={t('layout.sidebar.search')}
          title={t('layout.sidebar.searchPlaceholder')}
          className="w-full rounded-md border border-border bg-bg py-1.5 pl-8 pr-2 text-sm text-text transition-colors duration-150 placeholder:text-muted focus:border-accent"
        />
      </div>
      {sidebarView === 'inbox' ? (
        <InboxView />
      ) : sidebarView === 'stacks' ? (
        <StacksView pullRequests={pullRequests} onSelectPr={handleSelectPr} />
      ) : sidebarView === 'queue' && !noProviders && !needsLogin ? (
        <QueueView />
      ) : (
        <>
          {/* Open / Closed / All belongs to the Repos list; the queue is open PRs only. */}
          {sidebarView === 'list' && (
            <div className="flex shrink-0 items-center gap-2 border-b border-border px-2 py-2">
              <StateFilterControl value={prStateFilter} onChange={setPrStateFilter} />
              <IconButton
                icon={<RefreshCw size={14} className={loading ? 'animate-spin' : ''} />}
                label={t('layout.sidebar.refresh')}
                onClick={refetch}
                disabled={loading}
                className="ml-auto"
              />
            </div>
          )}
          {noProviders ? (
            <div
              data-testid="no-providers"
              className="flex flex-col items-center gap-3 p-6 text-center"
            >
              <p className="text-sm font-medium text-text">
                {t('layout.sidebar.noProvidersTitle')}
              </p>
              <p className="text-xs text-muted">{t('layout.sidebar.noProvidersHint')}</p>
              <button
                type="button"
                onClick={openSettings}
                className="rounded-md border border-accent/50 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent transition-colors duration-150 hover:bg-accent/20"
              >
                {t('layout.sidebar.openSettings')}
              </button>
            </div>
          ) : needsLogin ? (
            <div
              data-testid="sign-in-needed"
              className="flex flex-col items-center gap-4 p-6 text-center"
            >
              <span className="text-3xl" aria-hidden>
                🔒
              </span>
              {signInErrors.map((signInError) => (
                <SignInHint
                  key={signInError.provider}
                  error={signInError}
                  githubAccount={githubAccount}
                  azureOrganization={azureOrganization}
                />
              ))}
              <button
                type="button"
                onClick={openSettings}
                className="rounded-md border border-accent/50 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent transition-colors duration-150 hover:bg-accent/20"
              >
                {t('layout.sidebar.openSettings')}
              </button>
              {otherErrors.length > 0 && <ProviderErrors errors={otherErrors} />}
            </div>
          ) : error ? (
            <p className="p-4 text-sm text-danger">{t('layout.sidebar.loadFailed', { error })}</p>
          ) : otherErrors.length > 0 && pullRequests.length === 0 ? (
            <ProviderErrors errors={otherErrors} />
          ) : loading && pullRequests.length === 0 ? (
            <p className="p-4 text-sm text-muted">{t('layout.sidebar.loading')}</p>
          ) : groups.length === 0 ? (
            searchQuery.trim() ? (
              <p className="p-4 text-sm text-muted">
                {t('layout.sidebar.noMatches', { query: searchQuery })}
              </p>
            ) : (
              <div className="flex flex-col gap-2 p-4 text-sm text-muted">
                <p>{t(`layout.sidebar.empty.${prStateFilter}`)}</p>
                {azureNotConfigured && (
                  <p className="text-xs text-warning">{t('layout.sidebar.azureNotConfigured')}</p>
                )}
                {/* Search help per enabled provider: GitHub qualifiers mean nothing to Azure. */}
                {enabled?.includes('github') && (
                  <p className="text-xs" data-search-tip="github">
                    <Trans
                      i18nKey="layout.sidebar.searchTipGithub"
                      components={{ code: <code className="rounded bg-bg px-1" /> }}
                    />
                  </p>
                )}
                {enabled?.includes('azure') && !azureNotConfigured && (
                  <p className="text-xs" data-search-tip="azure">
                    <Trans
                      i18nKey="layout.sidebar.searchTipAzure"
                      components={{ code: <code className="rounded bg-bg px-1" /> }}
                    />
                  </p>
                )}
              </div>
            )
          ) : (
            <>
              {otherErrors.length > 0 && <ProviderErrors errors={otherErrors} />}
              {groups.map((group) => (
                <RepoGroup key={repoKey(group.repo)} group={group} onSelectPr={handleSelectPr} />
              ))}
            </>
          )}
        </>
      )}
    </aside>
  )

  if (isDrawer) {
    return (
      <>
        <div className="absolute inset-0 z-30 bg-black/50" onClick={closeSidebar} aria-hidden />
        {aside}
      </>
    )
  }

  // Docked: the column wraps the scrolling aside so the drag handle on its
  // right edge neither scrolls away nor gets clipped. Pointer capture keeps
  // the drag alive when the pointer leaves the 6px strip (as in
  // `DidacticPanel`); arrows nudge it from the keyboard; double-click goes
  // back to the tier's default width.
  return (
    <div ref={columnRef} style={{ width }} className="relative flex shrink-0">
      {aside}
      <div
        role="separator"
        tabIndex={0}
        aria-orientation="vertical"
        aria-label={t('layout.sidebar.resize')}
        aria-valuenow={width}
        aria-valuemin={SIDEBAR_MIN_WIDTH}
        aria-valuemax={maxWidth}
        title={t('layout.sidebar.resizeHint')}
        data-testid="sidebar-resize"
        className="absolute inset-y-0 -right-[3px] z-10 w-1.5 cursor-col-resize touch-none transition-colors duration-150 hover:bg-accent/50 focus-visible:bg-accent/70 focus-visible:outline-none active:bg-accent/70"
        onPointerDown={(e) => {
          e.preventDefault()
          e.currentTarget.setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
          const left = columnRef.current?.getBoundingClientRect().left ?? 0
          setSidebarWidth(e.clientX - left)
        }}
        onDoubleClick={() => setSidebarWidth(null)}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
          e.preventDefault()
          setSidebarWidth(width + (e.key === 'ArrowRight' ? 16 : -16))
        }}
      />
    </div>
  )
}
