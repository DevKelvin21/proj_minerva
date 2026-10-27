import { enabledProviders, providerAuthViews, type ProviderAuthView } from '../lib/scm-connection'
import { useScmAuth } from './use-scm-auth'
import { useScmSettings } from './use-scm-settings'

/** Enabled source-control providers with their readiness (`null` until settings or auth load). */
export function useProviderAuthViews(): ProviderAuthView[] | null {
  const { statuses } = useScmAuth()
  const { info } = useScmSettings()
  const enabled = enabledProviders(info, statuses)
  return enabled === null ? null : providerAuthViews(enabled, statuses)
}
