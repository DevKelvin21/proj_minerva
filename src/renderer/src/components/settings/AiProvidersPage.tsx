import { RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { AI_PROVIDER_IDS, type AiProviderId } from '../../../../shared/ai-providers'
import type { AiProviderStatus, AiSettingsInfo } from '../../../../shared/types'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { ProviderStatusBadge } from './ActiveConfigSummary'
import { CliLoginGuide } from './CliLoginGuide'
import { SettingsGroup, SettingsRow } from './SettingsRow'

interface AiProvidersPageProps {
  info: AiSettingsInfo
  statuses: Record<AiProviderId, AiProviderStatus> | null
  loading: boolean
  onRecheck: () => void
}

/**
 * Settings › AI › Providers: one row per CLI (OpenCode, Claude Code, Codex)
 * with its sign-in state and how to sign in, and one "Check again" for all
 * of them (`ai:getProviderStatus`). Picking the model is the Model page.
 */
export function AiProvidersPage({
  info,
  statuses,
  loading,
  onRecheck,
}: AiProvidersPageProps): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <SettingsGroup
      title={t('settings.aiProviders.title')}
      description={t('settings.aiProviders.description')}
    >
      {AI_PROVIDER_IDS.map((provider) => (
        <SettingsRow
          key={provider}
          testId={'settings-ai-provider-' + provider}
          title={
            <span className="flex flex-wrap items-center gap-2">
              {info.catalog[provider].label}
              {info.provider === provider && (
                <Badge tone="accent" size="sm">
                  {t('settings.models.active')}
                </Badge>
              )}
            </span>
          }
          description={<CliLoginGuide provider={provider} status={statuses?.[provider]} />}
          control={<ProviderStatusBadge status={statuses?.[provider]} />}
        />
      ))}
      <SettingsRow
        title={t('settings.aiProviders.recheckTitle')}
        description={t('settings.aiProviders.recheckHint')}
        control={
          <Button
            size="sm"
            onClick={onRecheck}
            disabled={loading}
            icon={<RefreshCw size={12} className={loading ? 'animate-spin' : ''} aria-hidden />}
          >
            {t('settings.cliGuide.recheck')}
          </Button>
        }
      />
    </SettingsGroup>
  )
}
