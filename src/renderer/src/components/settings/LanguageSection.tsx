import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { APP_LOCALES, isAppLocale, type AppLocale } from '../../../../shared/locale'
import { useLocale } from '../../i18n/use-locale'
import { Select } from '../ui/Select'
import { SettingsGroup, SettingsRow } from './SettingsRow'

/**
 * Each language named in itself (never translated): someone who can't read
 * the current UI language still finds their own.
 */
const LANGUAGE_NAMES: Record<AppLocale, string> = {
  en: 'English',
  es: 'Español',
}

/**
 * Settings › General: the UI language picker. Saving goes through main (`settings:setLanguage`),
 * which persists it and pushes `languageChanged` to every window, so the
 * detached didactic window switches too.
 */
export function LanguageSection(): React.JSX.Element {
  const { t } = useTranslation()
  const { locale, setLocale } = useLocale()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function change(next: string): Promise<void> {
    if (!isAppLocale(next) || next === locale) return
    setSaving(true)
    setError(null)
    try {
      await setLocale(next)
    } catch {
      setError(t('settings.language.saveError'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <SettingsGroup title={t('settings.language.title')}>
      <SettingsRow
        title={t('settings.language.label')}
        description={t('settings.language.description')}
        htmlFor="settings-language"
        control={
          <Select
            id="settings-language"
            data-testid="language-picker"
            aria-label={t('settings.language.label')}
            value={locale}
            disabled={saving}
            onChange={(event) => void change(event.target.value)}
            containerClassName="w-44"
          >
            {APP_LOCALES.map((code) => (
              <option key={code} value={code} lang={code}>
                {LANGUAGE_NAMES[code]}
              </option>
            ))}
          </Select>
        }
      >
        {error && (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        )}
      </SettingsRow>
    </SettingsGroup>
  )
}
