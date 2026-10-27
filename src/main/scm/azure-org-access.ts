/**
 * Which Azure DevOps organizations main may use the user's credential with,
 * for the two channels that take an organization NAME from the renderer
 * (`scm:listAzureProjects`, `scm:setProviderSettings`). Every other Azure
 * call is scoped to the saved settings by the provider itself.
 *
 * An organization is trusted (no question asked) when it was approved in
 * this session, or Azure is on and it is configured in Settings or known to
 * `az` (`az devops configure` default or a stored `az devops login`). Anything
 * else needs a native confirmation (`./confirm.ts`): a compromised renderer
 * can't make main resolve and send a credential to an organization the user
 * never chose. Approvals last for the process; a decline is remembered for
 * `declineCooldownMs` so a loop can't stack dialogs, and only one dialog is
 * open at a time.
 *
 * Settings saves only drop the credential cache when the organization set
 * really changed, at most once per `invalidateIntervalMs` (each drop makes
 * the next call re-read the az keyring).
 */
import type { ScmProviderSettings } from '../../shared/scm'
import type { SetProviderSettingsRequest } from '../../shared/types'
import { organizationUrl } from './azure/credentials'
import { dialogText, type ConfirmFn } from './confirm'
import { ScmError } from './errors'

export interface AzureOrgAccessDeps {
  current: () => ScmProviderSettings
  knownOrganizations: () => string[]
  now?: () => number
  declineCooldownMs?: number
  invalidateIntervalMs?: number
}

export interface SettingsSaveDeps {
  save: (req: SetProviderSettingsRequest) => void
  /** Drops identity/auth caches; `credentials: true` also drops the credential cache. */
  invalidateAzure: (options: { credentials: boolean }) => void
  invalidateStacks: () => void
}

export interface AzureOrgAccess {
  isTrusted(organization: string): boolean
  /**
   * Gate for `scm:listAzureProjects`: resolves when `organization` may be
   * used (asking if needed), throws `FORBIDDEN` / `RATE_LIMITED` otherwise.
   */
  ensureProjectsLookupAllowed(organization: string, confirm: ConfirmFn): Promise<void>
  /**
   * `scm:setProviderSettings`: confirms organizations that are new to the
   * user, then saves. `false` = declined, nothing saved.
   */
  saveSettings(
    req: SetProviderSettingsRequest,
    confirm: ConfirmFn,
    deps: SettingsSaveDeps,
  ): Promise<boolean>
}

const DEFAULT_DECLINE_COOLDOWN_MS = 30_000
const DEFAULT_INVALIDATE_INTERVAL_MS = 10_000

const lower = (name: string): string => name.toLowerCase()

function orgSet(settings: ScmProviderSettings): Set<string> {
  return new Set(settings.azure.organizations.map((entry) => lower(entry.organization)))
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  return a.size === b.size && [...a].every((value) => b.has(value))
}

export function createAzureOrgAccess(deps: AzureOrgAccessDeps): AzureOrgAccess {
  const now = deps.now ?? Date.now
  const declineCooldownMs = deps.declineCooldownMs ?? DEFAULT_DECLINE_COOLDOWN_MS
  const invalidateIntervalMs = deps.invalidateIntervalMs ?? DEFAULT_INVALIDATE_INTERVAL_MS
  const approved = new Set<string>()
  const declinedAt = new Map<string, number>()
  let dialogOpen = false
  let lastCredentialInvalidate = Number.NEGATIVE_INFINITY

  /** Configured or known to az (Azure on or off). */
  const isFamiliar = (organization: string): boolean => {
    const key = lower(organization)
    return (
      orgSet(deps.current()).has(key) ||
      deps.knownOrganizations().some((name) => lower(name) === key)
    )
  }

  const isTrusted = (organization: string): boolean =>
    approved.has(lower(organization)) || (deps.current().azure.enabled && isFamiliar(organization))

  /** One dialog at a time, and no new dialog for a recently declined org. */
  const ask = async (
    organizations: string[],
    confirm: ConfirmFn,
    request: Parameters<ConfirmFn>[0],
  ): Promise<boolean | 'busy' | 'cooldown'> => {
    if (dialogOpen) return 'busy'
    const at = now()
    if (
      organizations.some(
        (org) => at - (declinedAt.get(lower(org)) ?? -Infinity) < declineCooldownMs,
      )
    ) {
      return 'cooldown'
    }
    dialogOpen = true
    try {
      const ok = await confirm(request)
      for (const org of organizations) {
        if (ok) {
          approved.add(lower(org))
          declinedAt.delete(lower(org))
        } else declinedAt.set(lower(org), now())
      }
      return ok
    } finally {
      dialogOpen = false
    }
  }

  const credentialLine = (organizations: string[]): string =>
    'Minerva will use your Azure DevOps credential (from az) with ' +
    organizations.map((org) => dialogText(organizationUrl(org))).join(', ') +
    '.'

  return {
    isTrusted,

    async ensureProjectsLookupAllowed(organization, confirm) {
      if (isTrusted(organization)) return
      const off = !deps.current().azure.enabled
      const answer = await ask([organization], confirm, {
        message: 'Load the projects of Azure DevOps organization ' + dialogText(organization) + '?',
        detail:
          (off ? 'Azure DevOps is turned off in Settings.\n' : '') + credentialLine([organization]),
        confirmLabel: 'Load projects',
      })
      if (answer === true) return
      if (answer === 'busy') {
        throw new ScmError('RATE_LIMITED', 'Another confirmation is already open.')
      }
      throw new ScmError('FORBIDDEN', 'Loading projects of ' + organization + ' was not allowed.')
    },

    async saveSettings(req, confirm, saveDeps) {
      const before = orgSet(deps.current())
      if (req.azure) {
        const fresh = req.azure.organizations
          .map((entry) => entry.organization)
          .filter((org) => !approved.has(lower(org)) && !isFamiliar(org))
        if (fresh.length > 0) {
          const plural = fresh.length > 1
          const answer = await ask(fresh, confirm, {
            message:
              'Add Azure DevOps organization' +
              (plural ? 's ' : ' ') +
              fresh.map((org) => dialogText(org)).join(', ') +
              '?',
            detail:
              (plural ? 'They are' : 'It is') +
              ' not configured yet and not known to az.\n' +
              credentialLine(fresh),
            confirmLabel: 'Add',
          })
          if (answer !== true) return false
        }
      }
      saveDeps.save(req)
      // Cheap caches (auth status, identities) always go: they depend on the
      // enabled flag too. The credential cache only for a new org set, rate-limited.
      const at = now()
      const credentials =
        !sameSet(before, orgSet(deps.current())) &&
        at - lastCredentialInvalidate >= invalidateIntervalMs
      if (credentials) lastCredentialInvalidate = at
      saveDeps.invalidateAzure({ credentials })
      saveDeps.invalidateStacks()
      return true
    },
  }
}
