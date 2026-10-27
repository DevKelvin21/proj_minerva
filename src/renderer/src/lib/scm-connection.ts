/**
 * Provider-aware connection state for the TitleBar and the Sidebar: which
 * source-control providers are on, how ready each one is, and one aggregate
 * state for the "Connected" indicator. Pure, so every surface agrees.
 */
import type { ScmAuthStatus, ScmProviderId } from '../../../shared/scm'
import type { ScmSettingsInfo } from '../../../shared/types'
import type { ConnectionState } from '../hooks/use-connection-status'

/** Same order as main's registry (`ALL_SCM_PROVIDER_IDS`). */
export const SCM_PROVIDER_IDS: readonly ScmProviderId[] = ['github', 'azure']

/**
 * - `ready`: signed in.
 * - `checking`: no auth answer yet.
 * - `not_configured`: on in Settings but unusable as configured (Azure without an organization).
 * - `cli_unavailable`: `gh` / `az` not found.
 * - `signed_out`: CLI found, no usable session or credential.
 */
export type ProviderReadiness =
  'ready' | 'checking' | 'not_configured' | 'cli_unavailable' | 'signed_out'

export interface ProviderAuthView {
  provider: ScmProviderId
  readiness: ProviderReadiness
  status?: ScmAuthStatus
}

/**
 * Providers turned on. Settings are the source of truth; before they load,
 * any provider whose auth status is not `disabled` counts as on. `null` =
 * nothing known yet.
 */
export function enabledProviders(
  settings: ScmSettingsInfo | null,
  statuses: Record<ScmProviderId, ScmAuthStatus> | null,
): ScmProviderId[] | null {
  if (settings) return SCM_PROVIDER_IDS.filter((id) => settings.providers[id].enabled)
  if (statuses) return SCM_PROVIDER_IDS.filter((id) => statuses[id]?.state !== 'disabled')
  return null
}

export function providerReadiness(status: ScmAuthStatus | undefined): ProviderReadiness {
  if (status === undefined) return 'checking'
  switch (status.state) {
    case 'signed_in':
      return 'ready'
    case 'cli_unavailable':
      return 'cli_unavailable'
    case 'cli_unauthenticated':
      return 'signed_out'
    case 'disabled':
      return 'not_configured'
  }
}

/** One view per enabled provider, in registry order. */
export function providerAuthViews(
  enabled: readonly ScmProviderId[],
  statuses: Record<ScmProviderId, ScmAuthStatus> | null,
): ProviderAuthView[] {
  return enabled.map((provider) => {
    const status = statuses?.[provider]
    return { provider, readiness: providerReadiness(status), status }
  })
}

/**
 * Aggregate state of the TitleBar indicator:
 * - `error`: the IPC ping to main failed (nothing else can work).
 * - `checking`: ping, settings or some provider's status still pending.
 * - `no_providers`: every provider is turned off.
 * - `connected`: every enabled provider is signed in.
 * - `partial`: some are, some are not (e.g. Azure signed in, `gh` missing).
 * - `signed_out`: none of the enabled providers is ready.
 */
export type ScmConnection =
  'checking' | 'connected' | 'partial' | 'signed_out' | 'no_providers' | 'error'

export function scmConnection(
  ipc: ConnectionState,
  views: readonly ProviderAuthView[] | null,
): ScmConnection {
  if (ipc === 'error') return 'error'
  if (ipc === 'checking' || views === null) return 'checking'
  if (views.length === 0) return 'no_providers'
  if (views.some((view) => view.readiness === 'checking')) return 'checking'
  const ready = views.filter((view) => view.readiness === 'ready').length
  if (ready === views.length) return 'connected'
  return ready > 0 ? 'partial' : 'signed_out'
}

/** Name shown for a signed-in identity: display name first, then login. */
export function identityLabel(status: ScmAuthStatus | undefined): string {
  return status?.user?.displayName ?? status?.user?.login ?? ''
}

/** Azure's org-specific login command (shown and copied verbatim, never translated). */
export function azDevopsLoginCommand(organization: string | undefined): string {
  return organization
    ? 'az devops login --organization https://dev.azure.com/' + encodeURIComponent(organization)
    : 'az devops login'
}

export const GH_LOGIN_COMMAND = 'gh auth login'
