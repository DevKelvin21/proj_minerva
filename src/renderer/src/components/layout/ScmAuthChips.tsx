import { useEffect, useRef, useState } from 'react'
import { Settings, UserRound } from 'lucide-react'
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
import { Avatar } from '../ui/Avatar'
import { Badge } from '../ui/Badge'
import { IconButton } from '../ui/IconButton'
import { ScmProviderIcon } from '../ui/ScmProviderIcon'
import { Spinner } from '../ui/Spinner'

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
      <Spinner size={12} />
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

/** Providers whose state needs the user (CLI missing, signed out, no org): shown in the bar itself. */
function needsAttention(view: ProviderAuthView): boolean {
  return view.readiness !== 'ready' && view.readiness !== 'checking'
}

/**
 * The actionable chips (login command to copy, "Open Settings") of the
 * providers that need the user, right in the title bar. Signed-in providers
 * live in the accounts menu instead.
 */
export function ScmAttentionChips({
  density,
}: {
  density: AuthChipDensity
}): React.JSX.Element | null {
  const views = useProviderAuthViews()
  const attention = (views ?? []).filter(needsAttention)
  if (attention.length === 0) return null
  return (
    <div className="flex min-w-0 items-center gap-2">
      {attention.map((view) => (
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
 * One button for every source-control account: the signed-in identities'
 * avatars plus a dot with the aggregate state (IPC to main AND every enabled
 * provider; a partial failure reads "Partially connected"). The
 * `scm-connection` node keeps that state as text and the per-provider lines
 * in its `title`. The menu lists each provider: the signed-in chip
 * (identity, "via …", Settings shortcut), or why it is not ready.
 */
export function AccountsMenu(): React.JSX.Element {
  const { t } = useTranslation()
  const ipc = useConnectionStatus()
  const views = useProviderAuthViews()
  const openSettings = useAppStore((s) => s.openSettings)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  const connection = scmConnection(ipc, views)
  const label = t(`layout.titleBar.connection.${connection}`)
  const lines =
    connection === 'error'
      ? [t('layout.titleBar.connectionIpcError')]
      : (views ?? []).map((view) => providerStateText(view, t))
  const title = [t('layout.titleBar.connectionTitle', { status: label }), ...lines].join('\n')
  const signedIn = (views ?? []).filter((view) => view.readiness === 'ready')

  useEffect(() => {
    if (!open) return
    function onPointerDown(event: PointerEvent): void {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={rootRef} className="relative flex shrink-0">
      <button
        type="button"
        data-testid="accounts-menu"
        aria-expanded={open}
        aria-controls="accounts-menu-panel"
        aria-label={t('layout.accounts.button', { status: label })}
        title={title}
        onClick={() => setOpen((value) => !value)}
        className={`relative flex h-8 items-center rounded-md px-1 transition-colors duration-150 hover:bg-border/60 ${
          open ? 'bg-border/60' : ''
        }`}
      >
        {signedIn.length > 0 ? (
          <span className="flex items-center" aria-hidden>
            {signedIn.slice(0, 2).map((view, index) => (
              <span
                key={view.provider}
                className={`rounded-full ring-2 ring-panel ${index > 0 ? '-ml-1.5' : ''}`}
              >
                <Avatar user={{ login: identityLabel(view.status) || view.provider }} size={22} />
              </span>
            ))}
          </span>
        ) : (
          <UserRound size={18} className="m-0.5 text-muted" aria-hidden />
        )}
        <span
          data-testid="scm-connection"
          data-connection={connection}
          title={title}
          className="absolute bottom-0.5 right-0.5"
        >
          <span
            className={`block h-2 w-2 rounded-full ring-2 ring-panel ${CONNECTION_DOT[connection]}`}
            aria-hidden
          />
          <span className="sr-only">{label}</span>
        </span>
      </button>
      {open && (
        <div
          id="accounts-menu-panel"
          role="dialog"
          aria-label={t('layout.accounts.title')}
          data-no-drag
          className="absolute right-0 top-full z-50 mt-1.5 flex w-80 flex-col gap-3 rounded-lg border border-border bg-panel p-3 shadow-2xl"
        >
          <div className="flex items-center gap-2 text-xs text-muted">
            <span className={`h-2 w-2 rounded-full ${CONNECTION_DOT[connection]}`} aria-hidden />
            <span className="font-semibold text-text">{label}</span>
          </div>
          <ul className="flex flex-col gap-2">
            {(views ?? []).map((view) => (
              <li key={view.provider} className="flex min-w-0 items-center gap-2 text-xs">
                {view.readiness === 'ready' ? (
                  <ProviderAuthChip view={view} density="full" />
                ) : (
                  <>
                    <ScmProviderIcon provider={view.provider} size={12} className="text-muted" />
                    <span className="truncate text-muted">{providerStateText(view, t)}</span>
                  </>
                )}
              </li>
            ))}
            {views !== null && views.length === 0 && (
              <li className="text-xs text-muted">{t('layout.titleBar.connection.no_providers')}</li>
            )}
          </ul>
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              openSettings()
            }}
            className="self-start rounded-md border border-border px-2 py-1 text-xs text-muted transition-colors duration-150 hover:border-accent hover:text-text"
          >
            {t('layout.accounts.manage')}
          </button>
        </div>
      )}
    </div>
  )
}
