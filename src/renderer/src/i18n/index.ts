/**
 * Renderer i18n (i18next + react-i18next). Each window (main and detached
 * didactic) boots with the language saved in settings.json
 * (`settings:getLanguage`) and follows `languageChanged` pushes from main,
 * so switching in Settings applies to every window at once.
 */
import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import { DEFAULT_LOCALE, isAppLocale, type AppLocale } from '../../../shared/locale'
import { en } from './locales/en'
import { es } from './locales/es'

export const resources = {
  en: { translation: en },
  es: { translation: es },
} as const

/** Active UI language (`i18next.language` narrowed to the known locales). */
export function currentLocale(): AppLocale {
  return isAppLocale(i18next.language) ? i18next.language : DEFAULT_LOCALE
}

function syncDocumentLang(locale: AppLocale): void {
  document.documentElement.lang = locale
}

export async function initI18n(locale: AppLocale): Promise<void> {
  await i18next.use(initReactI18next).init({
    resources,
    lng: locale,
    fallbackLng: DEFAULT_LOCALE,
    // React already escapes; PR content never goes through `t()` as a key.
    interpolation: { escapeValue: false },
    returnNull: false,
  })
  syncDocumentLang(locale)
}

export async function applyLocale(locale: AppLocale): Promise<void> {
  if (i18next.language !== locale) await i18next.changeLanguage(locale)
  syncDocumentLang(locale)
}

/**
 * Reads the saved language, initializes i18next and subscribes to changes.
 * Never throws: a failed read falls back to English so the window still renders.
 */
export async function bootI18n(): Promise<void> {
  let locale: AppLocale = DEFAULT_LOCALE
  try {
    const saved = await window.minerva.settings.getLanguage()
    if (isAppLocale(saved)) locale = saved
  } catch (error) {
    console.warn('[i18n] could not read the saved language, using English:', error)
  }
  await initI18n(locale)
  window.minerva.events.onLanguageChanged(({ language }) => {
    void applyLocale(language)
  })
}

export { i18next }
