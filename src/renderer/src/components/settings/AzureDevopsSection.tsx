import { useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { Trans, useTranslation } from 'react-i18next'
import type { ScmAuthStatus } from '../../../../shared/scm'
import { isAzureOrganizationName } from '../../../../shared/scm-guards'
import type { ScmSettingsInfo } from '../../../../shared/types'
import { useAzureProjects } from '../../hooks/use-azure-projects'
import { useScmAuth } from '../../hooks/use-scm-auth'
import { useScmSettings } from '../../hooks/use-scm-settings'
import { ScmProviderIcon } from '../ui/ScmProviderIcon'

/** Key of `settings.azure.credentialSource` per credential source. */
const CREDENTIAL_SOURCE_KEY = {
  'gh-cli': 'ghCli',
  'env-pat': 'envPat',
  'az-devops-pat': 'azDevopsPat',
  'az-entra': 'azEntra',
} as const satisfies Record<NonNullable<ScmAuthStatus['credentialSource']>, string>

/** Auth feedback for Azure DevOps (`AzureScmProvider.getAuthStatus`). */
function AzureStatusFeedback({
  status,
}: {
  status: ScmAuthStatus | undefined
}): React.JSX.Element | null {
  const { t } = useTranslation()
  if (status === undefined) return null
  if (status.state === 'signed_in') {
    const name =
      status.user?.displayName ?? status.user?.login ?? t('settings.azure.unknownUser')
    const who =
      status.user?.login && status.user.login !== name ? name + ' (' + status.user.login + ')' : name
    const via = status.credentialSource
      ? t(`settings.azure.credentialSource.${CREDENTIAL_SOURCE_KEY[status.credentialSource]}`)
      : null
    return (
      <p className="text-xs text-success" data-azure-auth="signed_in">
        {via
          ? t('settings.azure.signedInVia', { who, source: via })
          : t('settings.azure.signedIn', { who })}
      </p>
    )
  }
  const tone =
    status.state === 'disabled'
      ? 'text-muted'
      : status.state === 'cli_unavailable'
        ? 'text-danger'
        : 'text-warning'
  const fallback =
    status.state === 'disabled'
      ? t('settings.azure.disabled')
      : status.state === 'cli_unavailable'
        ? t('settings.azure.cliNotFound')
        : t('settings.azure.noCredential')
  return (
    <p className={'text-xs ' + tone} data-azure-auth={status.state}>
      {status.detail ?? fallback}
    </p>
  )
}

/**
 * The editable part. Mounted with a `key` of the saved settings, so a save
 * (or a change from elsewhere) resets the draft without a setState-in-effect.
 */
function AzureSettingsForm({
  info,
  compact,
}: {
  info: ScmSettingsInfo
  compact: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const { saveProviderSettings, error: saveError } = useScmSettings()
  const { projects, loading, error: projectsError, load } = useAzureProjects()
  const saved = info.providers.azure
  const first = saved.organizations[0]
  const [enabled, setEnabled] = useState(saved.enabled)
  const [organization, setOrganization] = useState(first?.organization ?? '')
  const [selected, setSelected] = useState<string[]>(first?.projects ?? [])
  const [saving, setSaving] = useState(false)

  const orgValid = isAzureOrganizationName(organization.trim())
  const options = [...new Set([...(projects ?? []), ...selected])].sort((a, b) =>
    a.localeCompare(b),
  )
  const dirty =
    enabled !== saved.enabled ||
    organization.trim() !== (first?.organization ?? '') ||
    selected.join('\n') !== (first?.projects ?? []).join('\n') ||
    info.azureSettingsSource === 'az-cli-defaults'

  function toggleProject(name: string): void {
    setSelected((current) =>
      current.includes(name) ? current.filter((p) => p !== name) : [...current, name],
    )
  }

  async function save(): Promise<void> {
    if (saving) return
    setSaving(true)
    const org = organization.trim()
    await saveProviderSettings({
      azure: {
        enabled,
        organizations: org ? [{ organization: org, projects: selected }] : [],
      },
    })
    setSaving(false)
  }

  return (
    <div className="mt-3 space-y-3">
      <label className="flex items-center gap-2 text-xs text-text">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
          aria-label={t('settings.azure.enable')}
        />
        {t('settings.azure.enable')}
      </label>

      {info.mockScm ? (
        <p className="text-[11px] text-muted">{t('settings.azure.demoMode')}</p>
      ) : null}

      <div>
        <label
          className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted"
          htmlFor="azure-org"
        >
          {t('settings.azure.organization')}
        </label>
        <div className="flex min-w-0 items-center gap-2">
          <input
            id="azure-org"
            value={organization}
            onChange={(event) => setOrganization(event.target.value)}
            placeholder={t('settings.azure.organizationPlaceholder')}
            spellCheck={false}
            className="min-w-0 flex-1 rounded-md border border-border bg-bg px-2 py-1 text-sm text-text outline-none focus:border-accent/60"
          />
          <button
            type="button"
            disabled={!orgValid || loading}
            onClick={() => void load(organization.trim())}
            className="flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted transition-colors hover:text-text disabled:opacity-50"
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            {t('settings.azure.loadProjects')}
          </button>
        </div>
        {!compact && (
          <p className="mt-1 text-[11px] text-muted">
            <Trans
              i18nKey="settings.azure.organizationHint"
              components={{ mono: <span className="font-mono" /> }}
            />
          </p>
        )}
        {projectsError && <p className="mt-1 text-xs text-danger">{projectsError}</p>}
      </div>

      <div>
        <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
          {t('settings.azure.projects')}
        </h4>
        {options.length === 0 ? (
          <p className="text-[11px] text-muted">
            {projects === null
              ? t('settings.azure.loadProjectsFirst')
              : t('settings.azure.noProjects')}
          </p>
        ) : (
          <ul
            className="max-h-48 space-y-1 overflow-auto rounded-md border border-border p-2"
            aria-label={t('settings.azure.projectsAriaLabel')}
          >
            {options.map((name) => (
              <li key={name}>
                <label className="flex min-w-0 items-center gap-2 text-xs text-text">
                  <input
                    type="checkbox"
                    checked={selected.includes(name)}
                    onChange={() => toggleProject(name)}
                  />
                  <span className="truncate">{name}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
        {enabled && orgValid && selected.length === 0 && (
          <p className="mt-1 text-[11px] text-warning">
            {t('settings.azure.pickProject')}
          </p>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || !dirty || (organization.trim() !== '' && !orgValid)}
          className="rounded-md bg-accent/90 px-3 py-1 text-xs font-medium text-bg transition-colors hover:bg-accent disabled:opacity-50"
        >
          {saving ? t('settings.azure.saving') : t('settings.azure.save')}
        </button>
        {info.azureSettingsSource === 'az-cli-defaults' && (
          <span className="text-[11px] text-muted">{t('settings.azure.usingAzDefaults')}</span>
        )}
      </div>
      {saveError && <p className="text-xs text-danger">{saveError}</p>}
    </div>
  )
}

/**
 * "Azure DevOps": auth status (from the Azure CLI's own credential, never
 * shown), an enable toggle, and the organization + projects Minerva lists
 * pull requests from.
 */
export function AzureDevopsSection({ compact }: { compact: boolean }): React.JSX.Element | null {
  const { statuses } = useScmAuth()
  const { info } = useScmSettings()
  if (info === null) return null
  const formKey = JSON.stringify(info.providers.azure) + ':' + info.azureSettingsSource
  return (
    <div className="mt-4 border-t border-border pt-3" data-testid="azure-devops-settings">
      <h3 className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
        <ScmProviderIcon provider="azure" size={12} />
        Azure DevOps
      </h3>
      {!compact && (
        <p className="mb-2 text-xs text-muted">
          <Trans
            i18nKey="settings.azure.intro"
            components={{ mono: <span className="font-mono text-text" /> }}
          />
        </p>
      )}
      <div className="rounded-md border border-border bg-bg/40 px-2.5 py-2">
        <AzureStatusFeedback status={statuses?.azure} />
      </div>
      <AzureSettingsForm key={formKey} info={info} compact={compact} />
    </div>
  )
}
