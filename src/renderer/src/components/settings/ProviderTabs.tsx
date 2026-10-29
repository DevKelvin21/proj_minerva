import { Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { AI_PROVIDER_IDS } from '../../../../shared/ai-providers'
import { useRovingTabs } from '../../hooks/use-roving-tabs'
import type { AiProviderId } from '../../../../shared/ai-providers'
import type { AiProviderStatus, AiSettingsInfo } from '../../../../shared/types'

const DOT_TONE: Record<AiProviderStatus['status'], string> = {
  unavailable: 'bg-border',
  installed: 'bg-warning',
  authenticated: 'bg-success',
}

interface ProviderTabsProps {
  info: AiSettingsInfo
  statuses: Record<AiProviderId, AiProviderStatus> | null
  viewed: AiProviderId
  onChange: (provider: AiProviderId) => void
}

/**
 * Tabs por proveedor (T62, F12): click = SOLO cambiar qué proveedor se está
 * VIENDO (`viewed`), nunca activa nada. La vieja `ProviderPicker` usaba
 * radios que "seleccionaban" el proveedor activo, mezclando "ver" con
 * "activar" (diagnóstico de F12, ver `PLAN.md`) — acá activar pasa
 * exclusivamente por clickear una card de modelo en `ProviderModelPanel`.
 *
 * Cada tab lleva un punto de estado de login (color por
 * `AiProviderStatus.status`) y un check (`lucide-react`) SOLO en el tab del
 * proveedor ACTIVO (`info.provider`), sin importar cuál se esté viendo.
 *
 * Keyboard: `useRovingTabs` (one Tab stop, Left/Right switch with
 * wrap-around, Home/End), shared with the AI panel's tabs.
 */
export function ProviderTabs({ info, statuses, viewed, onChange }: ProviderTabsProps): React.JSX.Element {
  const { t } = useTranslation()
  const tabs = useRovingTabs<AiProviderId>({
    keys: AI_PROVIDER_IDS,
    value: viewed,
    onChange,
    tabId: (provider) => 'settings-tab-' + provider,
    panelId: (provider) => 'settings-tabpanel-' + provider,
  })

  return (
    // `overflow-x-auto` + tabs `shrink-0` (F16/T81): con el modal angosto los
    // tres tabs se comprimían hasta cortar los labels; ahora scrollean.
    <div
      role="tablist"
      aria-label={t('settings.providerTabs.ariaLabel')}
      className="flex overflow-x-auto rounded-t-lg px-2"
    >
      {AI_PROVIDER_IDS.map((provider) => {
        const entry = info.catalog[provider]
        const status = statuses?.[provider]
        const isViewed = viewed === provider
        const isActiveProvider = info.provider === provider

        return (
          <button
            key={provider}
            type="button"
            {...tabs.tabProps(provider)}
            className={`flex shrink-0 items-center gap-1.5 px-3 py-1.5 text-sm transition-colors duration-150 ${
              isViewed ? '-mb-px border-b-2 border-accent text-text' : 'text-muted hover:text-text'
            }`}
          >
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${status ? DOT_TONE[status.status] : 'bg-border'}`}
              title={
                status
                  ? t(`settings.providerStatus.${status.status}`)
                  : t('settings.providerStatus.checking')
              }
            />
            {entry.label}
            {isActiveProvider && (
              <>
                <Check size={12} className="text-accent" aria-hidden />
                <span className="sr-only">{t('settings.providerTabs.activeProvider')}</span>
              </>
            )}
          </button>
        )
      })}
    </div>
  )
}
