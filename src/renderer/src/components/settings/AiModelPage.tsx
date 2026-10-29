import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AiProviderId } from '../../../../shared/ai-providers'
import type { AiProviderStatus, AiSettingsInfo } from '../../../../shared/types'
import { ActiveConfigSummary } from './ActiveConfigSummary'
import { ProviderModelPanel } from './ProviderModelPanel'
import { ProviderTabs } from './ProviderTabs'
import { SettingsGroup } from './SettingsRow'

interface AiModelPageProps {
  info: AiSettingsInfo
  error: string | null
  statuses: Record<AiProviderId, AiProviderStatus> | null
  selectProvider: (provider: AiProviderId) => Promise<boolean>
  saveModel: (provider: AiProviderId, model: string) => Promise<boolean>
  setModelOption: (provider: AiProviderId, optionId: string, value: string) => Promise<boolean>
  onOpenProviders: () => void
}

/**
 * Settings › AI › Model (T62/F12): "In use" states the ACTIVE provider and
 * model; below, the provider tabs only change which provider's models are
 * VIEWED, and clicking a model card activates provider + model in one
 * gesture (`ProviderModelPanel`).
 *
 * `viewedProvider` lives here: the page mounts only while shown and only
 * once `info` loaded, so the lazy initializer always starts on the real
 * active provider without a sync effect.
 */
export function AiModelPage({
  info,
  error,
  statuses,
  selectProvider,
  saveModel,
  setModelOption,
  onOpenProviders,
}: AiModelPageProps): React.JSX.Element {
  const { t } = useTranslation()
  const [viewedProvider, setViewedProvider] = useState<AiProviderId>(info.provider)

  return (
    <>
      <SettingsGroup title={t('settings.activeConfig.title')}>
        <ActiveConfigSummary info={info} statuses={statuses} />
      </SettingsGroup>
      <SettingsGroup title={t('settings.models.title')}>
        <ProviderTabs
          info={info}
          statuses={statuses}
          viewed={viewedProvider}
          onChange={setViewedProvider}
        />
        <ProviderModelPanel
          key={viewedProvider}
          info={info}
          viewedProvider={viewedProvider}
          statuses={statuses}
          error={error}
          saveModel={saveModel}
          selectProvider={selectProvider}
          setModelOption={setModelOption}
          onOpenProviders={onOpenProviders}
        />
      </SettingsGroup>
    </>
  )
}
