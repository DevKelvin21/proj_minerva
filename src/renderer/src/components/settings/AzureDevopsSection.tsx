import { useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { Trans, useTranslation } from 'react-i18next'
import type { ScmAuthStatus } from '../../../../shared/scm'
import { isAzureOrganizationName } from '../../../../shared/scm-guards'
import type { ScmSettingsInfo } from '../../../../shared/types'
import { useAzureProjects } from '../../hooks/use-azure-projects'
import { useScmAuth } from '../../hooks/use-scm-auth'
import { useScmSettings } from '../../hooks/use-scm-settings'
import { CREDENTIAL_SOURCE_KEY } from '../../lib/scm-labels'
import { Button } from '../ui/Button'
import { Callout } from '../ui/Callout'
import { Checkbox } from '../ui/Checkbox'
import { Input } from '../ui/Input'
import { ScmRecheckButton } from './ScmRecheckButton'
import { SettingsCardBody, SettingsGroup, SettingsRow } from './SettingsRow'

/** Auth feedback for Azure DevOps (`AzureScmProvider.getAuthStatus`). */
function AzureStatusFeedback({
  status,
}: {
  status: ScmAuthStatus | undefined
}): React.JSX.Element | null {
  const { t } = useTranslation()
  if (status === undefined) return <p className="text-xs text-muted">{t('common.loading')}</p>
  if (status.state === 'signed_in') {
    const name = status.user?.displayName ?? status.user?.login ?? t('settings.azure.unknownUser')
    const who =
      status.user?.login && status.user.login !== name
        ? name + ' (' + status.user.login + ')'
        : name
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
 * The page's form: Access (the enable checkbox, which waits for Save like
 * the rest of the form; the sign-in help only while signed out; the auth
 * answer with "Check again"), then the organization and projects. Mounted
 * with a `key` of the saved settings, so a save (or a change from elsewhere)
 * resets the draft without a setState-in-effect.
 */
function AzureSettingsForm({
  info,
  status,
}: {
  info: ScmSettingsInfo
  status: ScmAuthStatus | undefined
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
  const signedOut = status?.state === 'cli_unavailable' || status?.state === 'cli_unauthenticated'
  const mono = <span className="font-mono text-text" />

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
    <>
      {info.mockScm && <Callout tone="warning">{t('settings.azure.demoMode')}</Callout>}

      <SettingsGroup title={t('settings.scmPage.access')}>
        <SettingsRow
          title={t('settings.azure.enableTitle')}
          description={t('settings.azure.enableHint')}
          control={
            // A checkbox, not a Switch: it is part of the form and waits for Save.
            <Checkbox
              fieldSize="md"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
              label={<span className="sr-only">{t('settings.azure.enable')}</span>}
            />
          }
        />
        {saved.enabled && signedOut && (
          <SettingsRow
            title={t('settings.scmPage.signIn')}
            description={<Trans i18nKey="settings.azure.intro" components={{ mono }} />}
          />
        )}
        <SettingsRow
          title={t('settings.scmPage.connection')}
          description={<AzureStatusFeedback status={status} />}
          control={<ScmRecheckButton />}
        />
      </SettingsGroup>

      <SettingsGroup title={t('settings.azure.scopeTitle')}>
        <SettingsRow
          title={t('settings.azure.organization')}
          htmlFor="azure-org"
          description={
            <Trans
              i18nKey="settings.azure.organizationHint"
              components={{ mono: <span className="font-mono" /> }}
            />
          }
        >
          <div className="flex min-w-0 items-center gap-2">
            <Input
              id="azure-org"
              value={organization}
              onChange={(event) => setOrganization(event.target.value)}
              placeholder={t('settings.azure.organizationPlaceholder')}
              spellCheck={false}
              className="min-w-0 flex-1"
            />
            <Button
              disabled={!orgValid || loading}
              onClick={() => void load(organization.trim())}
              icon={
                loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />
              }
            >
              {t('settings.azure.loadProjects')}
            </Button>
          </div>
          {projectsError && (
            <p role="alert" className="text-xs text-danger">
              {projectsError}
            </p>
          )}
        </SettingsRow>

        <SettingsRow title={t('settings.azure.projects')}>
          {options.length === 0 ? (
            <p className="text-[11px] text-muted">
              {projects === null
                ? t('settings.azure.loadProjectsFirst')
                : t('settings.azure.noProjects')}
            </p>
          ) : (
            <ul
              className="max-h-48 space-y-1 overflow-auto rounded-md border border-border bg-bg/40 p-2"
              aria-label={t('settings.azure.projectsAriaLabel')}
            >
              {options.map((name) => (
                <li key={name}>
                  <Checkbox
                    checked={selected.includes(name)}
                    onChange={() => toggleProject(name)}
                    label={<span className="block truncate">{name}</span>}
                    className="min-w-0"
                  />
                </li>
              ))}
            </ul>
          )}
          {enabled && orgValid && selected.length === 0 && (
            <p className="text-[11px] text-warning">{t('settings.azure.pickProject')}</p>
          )}
        </SettingsRow>

        <SettingsCardBody className="flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            onClick={() => void save()}
            disabled={saving || !dirty || (organization.trim() !== '' && !orgValid)}
          >
            {saving ? t('settings.azure.saving') : t('settings.azure.save')}
          </Button>
          {info.azureSettingsSource === 'az-cli-defaults' && (
            <span className="text-[11px] text-muted">{t('settings.azure.usingAzDefaults')}</span>
          )}
          {saveError && (
            <p role="alert" className="w-full text-xs text-danger">
              {saveError}
            </p>
          )}
        </SettingsCardBody>
      </SettingsGroup>
    </>
  )
}

/**
 * Settings › Source control › Azure DevOps: same structure as the GitHub
 * page. Auth comes from the Azure CLI's own credential (never shown); the
 * organization + projects say where Minerva lists pull requests from.
 */
export function AzureDevopsSection(): React.JSX.Element | null {
  const { statuses } = useScmAuth()
  const { info } = useScmSettings()
  if (info === null) return null
  const formKey = JSON.stringify(info.providers.azure) + ':' + info.azureSettingsSource
  return (
    <div className="flex min-w-0 flex-col gap-6" data-testid="azure-devops-settings">
      <AzureSettingsForm key={formKey} info={info} status={statuses?.azure} />
    </div>
  )
}
