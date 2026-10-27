/**
 * Main-process translations: a typed `en`/`es` table (no i18next, no React).
 * The active locale mirrors `settings.json` (`language`): `handlers.ts` sets
 * it at startup and on `settings:setLanguage`. Kept as module state instead
 * of reading the settings store on every call so pure modules (and their unit
 * tests) can call `mt()` without touching Electron; tests get English.
 *
 * Error CODES never go through here (`[SCM:CODE]` stays as is): only the
 * human text after them.
 */
import { DEFAULT_LOCALE, type AppLocale, type MessageKey } from '../../shared/locale'
import { en } from './locales/en'
import { es } from './locales/es'

export type MainMessageKey = MessageKey<typeof en>

export const MAIN_MESSAGES: Record<AppLocale, typeof en> = { en, es }

let currentLocale: AppLocale = DEFAULT_LOCALE

export function getMainLocale(): AppLocale {
  return currentLocale
}

export function setMainLocale(locale: AppLocale): void {
  currentLocale = locale
}

function lookup(table: object, key: string): string | undefined {
  let node: unknown = table
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined
    node = (node as Record<string, unknown>)[part]
  }
  return typeof node === 'string' ? node : undefined
}

/**
 * Message `key` in the active locale (or `locale`), with `{{name}}`
 * placeholders replaced by `vars`. Falls back to English, then to the key.
 */
export function mt(
  key: MainMessageKey,
  vars: Record<string, string | number> = {},
  locale: AppLocale = currentLocale,
): string {
  const template = lookup(MAIN_MESSAGES[locale], key) ?? lookup(en, key) ?? key
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  )
}
