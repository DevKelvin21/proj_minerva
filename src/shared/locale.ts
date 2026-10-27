/**
 * UI language, shared by main (settings, native dialogs, error messages, the
 * AI prompt) and the renderer (i18next). English is the default; an absent
 * `language` in settings.json means `en`.
 */
export const APP_LOCALES = ['en', 'es'] as const

export type AppLocale = (typeof APP_LOCALES)[number]

export const DEFAULT_LOCALE: AppLocale = 'en'

export function isAppLocale(value: unknown): value is AppLocale {
  return typeof value === 'string' && (APP_LOCALES as readonly string[]).includes(value)
}

/**
 * Turns a nested message table into the same shape with every leaf typed as
 * `string`, so a translation can be checked against the English source of
 * truth: a missing or extra key is a type error, the text itself is free.
 */
export type MessageShape<T> = {
  [K in keyof T]: T[K] extends string ? string : MessageShape<T[K]>
}

/** Dotted paths of every leaf of a nested message table (`'a.b.c'`). */
export type MessageKey<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${MessageKey<T[K]>}`
}[keyof T & string]

/** Every leaf key of `table` as a dotted path, for runtime coverage tests. */
export function messageKeys(table: object, prefix = ''): string[] {
  return Object.entries(table).flatMap(([key, value]) =>
    typeof value === 'string'
      ? [prefix + key]
      : messageKeys(value as object, prefix + key + '.'),
  )
}
