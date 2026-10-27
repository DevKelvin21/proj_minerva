import { Settings } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import type { ScmProviderId } from '../../../../shared/scm'
import { useAppStore } from '../../stores/app-store'
import { useConnectionStatus } from '../../hooks/use-connection-status'
import { useProviderAuthViews } from '../../hooks/use-provider-auth-views'
import { useScmSettings } from '../../hooks/use-scm-settings'
import {
  azDevopsLoginCommand,
  GH_LOGIN_COMMAND,
  identityLabel,
  scmConnection,
  type ProviderAuthView,
  type ScmConnection,
} from '../../lib/scm-connection'
import { CREDENTIAL_SOURCE_KEY, SCM_PROVIDER_LABEL } from '../../lib/scm-labels'
import { Badge } from '../ui/Badge'
import { IconButton } from '../ui/IconButton'
import { ScmProviderIcon } from '../ui/ScmProviderIcon'

/**
 * How much of each chip fits, by window width (F16): `full` = identity +
 * "via …" badge (`xl`), `identity` = identity only (`lg`), `icon` = provider
 * icon + status dot, everything else in the `title` (`md`/`sm`).
 */
export type AuthChipDensity = 'full' | 'identity' | 'icon'

/** "via GitHub CLI" / "via az devops PAT" — how the credential was obtained. */
function viaLabel(view: ProviderAuthView, t: TFunction): string {
  if (view.provider === 'github') return t('layout.auth.viaGhCli')
  const source = view.status?.credentialSource
  return source ? t(`layout.auth.via.${CREDENTIAL_SOURCE_KEY[source]}`) : ''
}

/** Login command of a provider for the signed-out chip (verbatim, never translated). */
function loginCommand(provider: ScmProviderId, azureOrganization: string | undefined): string {
  return provider === 'github' ? GH_LOGIN_COMMAND : azDevopsLoginCommand(azureOrganization)
}

/** One line per provider, for the `title` of the indicator and of compact chips. */
function providerStateText(view: ProviderAuthView, t: TFunction): string {
  const state =
    view.readiness === 'ready'
      ? t('layout.titleBar.providerState.ready', {
          who: [identityLabel(view.status), viaLabel(view, t)].filter(Boolean).join(' '),
        })
      : t(`layout.titleBar.providerState.${view.readiness}`)
  return t('layout.titleBar.providerLine', { provider: SCM_PROVIDER_LABEL[view.provider], state })
}

const READINESS_DOT: Record<ProviderAuthView['readiness'], string> = {
  ready: 'bg-success',
  checking: 'bg-warning',
  not_configured: 'bg-warning',
  cli_unavailable: 'bg-danger',
  signed_out: 'bg-warning',
}

/**
 * One provider's auth chip:
 * - `ready`: identity + discreet "via …" badge + Settings shortcut (there is
 *   no sign-out: the session belongs to `gh` / `az`, not Minerva).
 * - `cli_unavailable`: short text + Settings button.
 * - `signed_out`: copyable login command + spinner; the poll in
 *   `use-scm-auth.ts` notices when the user finishes the login in a terminal.
 * - `not_configured`: Azure on without an organization: Settings button.
 */
function ProviderAuthChip({
  view,
  density,
}: {
  view: ProviderAuthView
  density: AuthChipDensity
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const openSettings = useAppStore((s) => s.openSettings)
  const azureOrganization = useScmSettings().info?.providers.azure.organizations[0]?.organization
  const { provider, readiness } = view
  if (readiness === 'checking') return null

  const icon = <ScmProviderIcon provider={provider} size={12} className="text-muted" />
  const common = {
    'data-auth-provider': provider,
    'data-auth-state': readiness,
  }

  if (density === 'icon') {
    return (
      <button
        type="button"
        {...common}
        onClick={openSettings}
        title={providerStateText(view, t)}
        aria-label={providerStateText(view, t)}
        className="relative flex shrink-0 items-center rounded-md border border-border px-1.5 py-1 text-muted transition-colors duration-150 hover:border-accent hover:text-text"
      >
        {icon}
        <span
          className={`absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full ring-2 ring-panel ${READINESS_DOT[readiness]}`}
          aria-hidden
        />
      </button>
    )
  }

  if (readiness === 'ready') {
    const via = viaLabel(view, t)
    return (
      <div
        {...common}
        className="flex min-w-0 items-center gap-1.5 text-xs"
        title={providerStateText(view, t)}
      >
        {icon}
        <span className="max-w-[140px] truncate text-text">{identityLabel(view.status)}</span>
        {density === 'full' && via && <Badge tone="neutral">{via}</Badge>}
        <IconButton
          icon={<Settings size={13} />}
          label={
            provider === 'github' ? t('layout.auth.managedByGhCli') : t('layout.auth.managedByAz')
          }
          onClick={openSettings}
        />
      </div>
    )
  }

  if (readiness === 'cli_unavailable' || readiness === 'not_configured') {
    const text =
      readiness === 'not_configured'
        ? t('layout.auth.notConfigured')
        : provider === 'github'
          ? t('layout.auth.ghCliNotFound')
          : t('layout.auth.azCliNotFound')
    return (
      <div
        {...common}
        className="flex min-w-0 items-center gap-1.5 text-xs"
        title={
          readiness === 'not_configured'
            ? t('layout.auth.notConfiguredTitle')
            : (view.status?.detail ?? text)
        }
      >
        {icon}
        <span className="truncate text-muted">{text}</span>
        <button
          type="button"
          onClick={openSettings}
          className="shrink-0 rounded-md border border-border px-2 py-1 text-muted transition-colors duration-150 hover:border-accent hover:text-text"
        >
          {t('layout.auth.openSettings')}
        </button>
      </div>
    )
  }

  // `signed_out`: the GitHub command is short; Azure's names the org, so the
  // chip shows the bare `az devops login` and copies the full command.
  const command = loginCommand(provider, azureOrganization)
  const shown = provider === 'github' ? command : 'az devops login'
  return (
    <div
      {...common}
      className="flex min-w-0 items-center gap-1.5 text-xs"
      title={view.status?.detail}
    >
      {icon}
      <span
        className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-accent border-t-transparent"
        aria-hidden
      />
      <button
        type="button"
        title={t('layout.auth.copyCommandNamed', { command })}
        onClick={() => void navigator.clipboard?.writeText(command).catch(() => {})}
        className="shrink-0 rounded-md border border-accent/50 bg-accent/10 px-2 py-1 font-mono text-sm font-semibold text-accent transition-colors duration-150 hover:bg-accent/20"
      >
        {shown}
      </button>
      {density === 'full' && (
        <span className="truncate text-muted">{t('layout.auth.waitingForSession')}</span>
      )}
    </div>
  )
}

/** One auth chip per ENABLED provider (a turned-off provider shows nothing at all). */
export function ScmAuthChips({ density }: { density: AuthChipDensity }): React.JSX.Element | null {
  const views = useProviderAuthViews()
  if (views === null || views.length === 0) return null
  return (
    <div className="flex min-w-0 items-center gap-2">
      {views.map((view) => (
        <ProviderAuthChip key={view.provider} view={view} density={density} />
      ))}
    </div>
  )
}

const CONNECTION_DOT: Record<ScmConnection, string> = {
  connected: 'bg-success',
  partial: 'bg-warning',
  signed_out: 'bg-warning',
  no_providers: 'bg-muted',
  checking: 'bg-warning',
  error: 'bg-danger',
}

/**
 * Aggregate indicator: IPC to main AND every enabled provider. A partial
 * failure (Azure signed in, `gh` missing) reads "Partially connected", and
 * the `title` lists each provider's state.
 */
export function ScmConnectionIndicator({ showLabel }: { showLabel: boolean }): React.JSX.Element {
  const { t } = useTranslation()
  const ipc = useConnectionStatus()
  const views = useProviderAuthViews()
  const connection = scmConnection(ipc, views)
  const label = t(`layout.titleBar.connection.${connection}`)
  const lines =
    connection === 'error'
      ? [t('layout.titleBar.connectionIpcError')]
      : (views ?? []).map((view) => providerStateText(view, t))
  const title = [t('layout.titleBar.connectionTitle', { status: label }), ...lines].join('\n')

  return (
    <span
      data-testid="scm-connection"
      data-connection={connection}
      className="flex shrink-0 items-center gap-1.5 text-xs text-muted"
      title={title}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${CONNECTION_DOT[connection]}`} />
      {showLabel && label}
    </span>
  )
}
