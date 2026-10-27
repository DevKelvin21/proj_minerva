import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { isAppLocale, DEFAULT_LOCALE, type AppLocale } from '../../../shared/locale'
import { applyLocale } from './index'

/**
 * Active UI language plus a setter that persists it in main. Main pushes
 * `languageChanged` to every window; applying it here too makes the window
 * that asked switch without waiting for the round trip.
 */
export function useLocale(): { locale: AppLocale; setLocale: (next: AppLocale) => Promise<void> } {
  const { i18n } = useTranslation()
  const locale = isAppLocale(i18n.language) ? i18n.language : DEFAULT_LOCALE
  const setLocale = useCallback(async (next: AppLocale) => {
    const saved = await window.minerva.settings.setLanguage({ language: next })
    await applyLocale(saved)
  }, [])
  return { locale, setLocale }
}
