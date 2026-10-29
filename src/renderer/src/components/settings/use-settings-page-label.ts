import { useTranslation } from 'react-i18next'
import type { SettingsPageId } from '../../lib/settings-pages'

/** Locale key of each page's name (`settings.nav.pages.*`). */
const PAGE_KEY = {
  general: 'general',
  appearance: 'appearance',
  github: 'github',
  azure: 'azure',
  'ai-providers': 'aiProviders',
  'ai-model': 'aiModel',
  notifications: 'notifications',
  updates: 'updates',
} as const satisfies Record<SettingsPageId, string>

/** The name of a page, as the list and the breadcrumb show it. */
export function useSettingsPageLabel(): (page: SettingsPageId) => string {
  const { t } = useTranslation()
  return (page) => t(`settings.nav.pages.${PAGE_KEY[page]}`)
}
