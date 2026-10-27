import { useEffect, useMemo } from 'react'
import { RefreshCw } from 'lucide-react'
import { Trans, useTranslation } from 'react-i18next'
import type { PrStateFilter, PullRequestSummary, ScmListError } from '../../../../shared/types'
import { repoKey } from '../../../../shared/scm'
import { SCM_PROVIDER_LABEL } from '../../lib/scm-labels'
import { azDevopsLoginCommand, enabledProviders, GH_LOGIN_COMMAND } from '../../lib/scm-connection'
import { groupByRepo } from '../../lib/pr-filters'
import { usePullRequests } from '../../hooks/use-pull-requests'
import { useScmSettings } from '../../hooks/use-scm-settings'
import { useLayoutTier } from '../../hooks/use-layout-tier'
import { SIDEBAR_WIDTH, sidebarIsDrawer } from '../../lib/layout'
import { useAppStore, type SidebarView } from '../../stores/app-store'
import { useStacksStore } from '../../stores/stacks-store'
import { countOrphans } from '../../lib/stacks'
import { RepoGroup } from '../pr-list/RepoGroup'
import { StacksView } from '../stacks/StacksView'
import { IconButton } from '../ui/IconButton'
import { ScmProviderIcon } from '../ui/ScmProviderIcon'

/** A provider error that means "sign in first", not "something broke". */
function isSignInError(error: ScmListError): boolean {
  return error.code === 'UNAUTHENTICATED' || error.code === 'CLI_UNAVAILABLE'
}

const MONO = <span className="font-mono text-text" />
/** A long command (Azure's names the org URL) on its own line, wrapping anywhere. */
const CMD = (
  <code className="my-1 block break-all rounded bg-bg px-1.5 py-1 font-mono text-xs text-text" />
)

/**
 * What to run for ONE provider that could not list because it needs a sign-in
 * (`UNAUTHENTICATED` / `CLI_UNAVAILABLE`). GitHub: `gh auth login`, or the
 * picked account by name (a bare "run gh auth login" would be wrong advice
 * when the CLI is fine and only the choice is broken). Azure: the
 * org-specific `az devops login`, or installing `az` first.
 */
function SignInHint({
  error,
  githubAccount,
  azureOrganization,
}: {
  error: ScmListError
  githubAccount: string | null
  azureOrganization: string | undefined
}): React.JSX.Element {
  const body =
    error.provider === 'github' ? (
      githubAccount !== null ? (
        <Trans
          i18nKey="layout.sidebar.accountNoSession"
          values={{ account: githubAccount, command: GH_LOGIN_COMMAND }}
          components={{ mono: MONO }}
        />
      ) : (
        <Trans
          i18nKey="layout.sidebar.signInWithGhCli"
          values={{ command: GH_LOGIN_COMMAND }}
          components={{ mono: MONO }}
        />
      )
    ) : (
      <Trans
        i18nKey={
          error.code === 'CLI_UNAVAILABLE'
            ? 'layout.sidebar.installAz'
            : 'layout.sidebar.signInWithAz'
        }
        values={{ command: azDevopsLoginCommand(azureOrganization) }}
        components={{ mono: MONO, cmd: CMD }}
      />
    )
  return (
    <div
      data-sign-in={error.provider}
      data-error-code={error.code}
      className="flex w-full flex-col items-center gap-1 text-sm text-muted"
    >
      <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
        <ScmProviderIcon provider={error.provider} size={12} />
        {SCM_PROVIDER_LABEL[error.provider]}
      </span>
      <p className="break-words">{body}</p>
    </div>
  )
}

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
 * "Pull requests | Stacks" switch for the left column. The Stacks segment
 * carries the orphan count once some consumer loaded the stacks (it does not
 * trigger the fetch itself: that is a cold ~10 s read on a real org).
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
  const options: { value: SidebarView; label: string }[] = [
    { value: 'list', label: t('layout.sidebar.views.list') },
    { value: 'stacks', label: t('layout.sidebar.views.stacks') },
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
          onClick={() => onChange(option.value)}
          className={`flex min-w-0 flex-1 items-center justify-center gap-1 rounded px-2 py-1 font-medium transition-colors duration-150 ${
            value === option.value ? 'bg-accent/15 text-accent' : 'text-muted hover:text-text'
          }`}
        >
          <span className="truncate">{option.label}</span>
          {option.value === 'stacks' && orphans > 0 && (
            <span
              className="shrink-0 rounded-full bg-warning/20 px-1.5 text-[10px] text-warning"
              title={t('layout.sidebar.orphans', { count: orphans })}
            >
              {orphans}
            </span>
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
 */
export function Sidebar(): React.JSX.Element | null {
  const { t } = useTranslation()
  const searchQuery = useAppStore((s) => s.searchQuery)
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

  // Esc cierra el drawer (solo cuando está abierto y no hay un modal encima:
  // `SettingsModal` monta su propio listener y también cierra con Esc).
  const settingsOpen = useAppStore((s) => s.settingsOpen)
  useEffect(() => {
    if (!isDrawer || !sidebarOpen || settingsOpen) return
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') closeSidebar()
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

  if (isDrawer && !sidebarOpen) return null

  const asideClass = isDrawer
    ? 'absolute inset-y-0 left-0 z-40 flex w-[300px] max-w-[85%] flex-col overflow-y-auto border-r border-border bg-panel shadow-2xl'
    : 'flex shrink-0 flex-col overflow-y-auto border-r border-border bg-panel'

  return (
    <>
      {isDrawer && (
        <div className="absolute inset-0 z-30 bg-black/50" onClick={closeSidebar} aria-hidden />
      )}
      <aside
        aria-label={t('layout.sidebar.ariaLabel')}
        style={isDrawer ? undefined : { width: SIDEBAR_WIDTH[tier.w] }}
        className={asideClass}
      >
        <div className="shrink-0 px-2 pt-2">
          <SidebarViewSwitch value={sidebarView} onChange={setSidebarView} />
        </div>
        {sidebarView === 'stacks' ? (
          <StacksView pullRequests={pullRequests} onSelectPr={handleSelectPr} />
        ) : (
          <>
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
    </>
  )
}
