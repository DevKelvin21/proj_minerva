/**
 * Pure edits of `AppearanceSettings` behind the Appearance settings UI:
 * picking a theme for one or both halves, and adding, replacing, removing
 * or importing custom themes. Each returns a NEW settings object (or throws
 * `ThemeLibraryError`) that the renderer then saves through main, which
 * validates it again.
 *
 * Semantics follow T3 Code's theme library (`ThemeSettings.tsx`): clicking a
 * theme uses it for both halves when it has both variants, or for the one
 * half it has; a preview circle assigns only that half; removing a theme in
 * use resets that half to the Minerva default.
 */
import { MAX_CUSTOM_THEMES, findThemeById, type AppearanceSettings } from './appearance'
import {
  canonicalizeThemeDefinition,
  getThemeColorsForMode,
  getThemeModes,
  isBuiltInThemeId,
  MINERVA_THEME_ID,
  RESERVED_THEME_IDS,
  themeIdFromName,
  type ThemeAppearance,
  type ThemeDefinition,
} from './themes'

export type ThemeLibraryErrorCode = 'tooMany' | 'notFound' | 'missingVariant' | 'readOnly'

export class ThemeLibraryError extends Error {
  constructor(readonly code: ThemeLibraryErrorCode) {
    super('Theme library: ' + code)
    this.name = 'ThemeLibraryError'
  }
}

/** Which halves currently use `themeId`. */
export function halvesUsing(settings: AppearanceSettings, themeId: string): ThemeAppearance[] {
  const halves: ThemeAppearance[] = []
  if (settings.lightTheme === themeId) halves.push('light')
  if (settings.darkTheme === themeId) halves.push('dark')
  return halves
}

/** Uses `themeId` for one half (the theme must have that variant). */
export function assignHalf(
  settings: AppearanceSettings,
  appearance: ThemeAppearance,
  themeId: string,
): AppearanceSettings {
  const theme = findThemeById(settings, themeId)
  if (!theme) throw new ThemeLibraryError('notFound')
  if (!getThemeColorsForMode(theme, appearance)) throw new ThemeLibraryError('missingVariant')
  return appearance === 'light'
    ? { ...settings, lightTheme: themeId }
    : { ...settings, darkTheme: themeId }
}

/** Uses a theme everywhere it can be used: both halves, or the only half it has. */
export function pickTheme(settings: AppearanceSettings, themeId: string): AppearanceSettings {
  const theme = findThemeById(settings, themeId)
  if (!theme) throw new ThemeLibraryError('notFound')
  return getThemeModes(theme).reduce((next, mode) => assignHalf(next, mode, themeId), settings)
}

/** An id derived from `label` that no built-in, keyword or saved theme has. */
export function uniqueThemeId(
  settings: AppearanceSettings,
  label: string,
  except?: string,
): string {
  const taken = (id: string): boolean =>
    id !== except &&
    (RESERVED_THEME_IDS.has(id) ||
      isBuiltInThemeId(id) ||
      settings.customThemes.some((theme) => theme.id === id))
  const base = themeIdFromName(label)
  if (!taken(base)) return base
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const tail = '-' + suffix
    const candidate = base.slice(0, 48 - tail.length).replace(/-+$/, '') + tail
    if (!taken(candidate)) return candidate
  }
  return base.slice(0, 40) + '-' + Date.now().toString(36).slice(-7)
}

/** A label no other theme uses (`Name`, `Name 2`, …). */
export function uniqueThemeLabel(
  settings: AppearanceSettings,
  label: string,
  except?: string,
): string {
  const labels = new Set(
    [...settings.customThemes.filter((theme) => theme.id !== except)].map((theme) =>
      theme.label.toLowerCase(),
    ),
  )
  const base = label.trim().slice(0, 48) || 'Custom theme'
  if (!labels.has(base.toLowerCase())) return base
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const tail = ' ' + suffix
    const candidate = base.slice(0, 48 - tail.length).trimEnd() + tail
    if (!labels.has(candidate.toLowerCase())) return candidate
  }
  return base
}

/**
 * Adds a custom theme (new id) or replaces the one with the same id. The
 * halves that used a replaced theme keep using it when the variant still
 * exists, and fall back to Minerva otherwise.
 */
export function upsertCustomTheme(
  settings: AppearanceSettings,
  theme: ThemeDefinition,
): AppearanceSettings {
  if (isBuiltInThemeId(theme.id) || RESERVED_THEME_IDS.has(theme.id)) {
    throw new ThemeLibraryError('readOnly')
  }
  const canonical = canonicalizeThemeDefinition(theme)
  const index = settings.customThemes.findIndex((existing) => existing.id === theme.id)
  if (index === -1 && settings.customThemes.length >= MAX_CUSTOM_THEMES) {
    throw new ThemeLibraryError('tooMany')
  }
  const customThemes =
    index === -1
      ? [...settings.customThemes, canonical]
      : settings.customThemes.map((existing, at) => (at === index ? canonical : existing))
  const next = { ...settings, customThemes }
  return {
    ...next,
    lightTheme:
      next.lightTheme === theme.id && !getThemeColorsForMode(canonical, 'light')
        ? MINERVA_THEME_ID
        : next.lightTheme,
    darkTheme:
      next.darkTheme === theme.id && !getThemeColorsForMode(canonical, 'dark')
        ? MINERVA_THEME_ID
        : next.darkTheme,
  }
}

/** Removes custom themes; any half that used one goes back to Minerva. */
export function removeCustomThemes(
  settings: AppearanceSettings,
  themeIds: readonly string[],
): AppearanceSettings {
  const removed = new Set(themeIds)
  return {
    ...settings,
    customThemes: settings.customThemes.filter((theme) => !removed.has(theme.id)),
    lightTheme: removed.has(settings.lightTheme) ? MINERVA_THEME_ID : settings.lightTheme,
    darkTheme: removed.has(settings.darkTheme) ? MINERVA_THEME_ID : settings.darkTheme,
  }
}

/**
 * Adds imported themes, renaming on id/label clashes (an Open VSX
 * collection that is already installed is replaced instead, so updating an
 * extension does not duplicate it). Answers the new settings and the themes
 * as stored (final ids/labels).
 */
export function importCustomThemes(
  settings: AppearanceSettings,
  themes: readonly ThemeDefinition[],
): { settings: AppearanceSettings; imported: ThemeDefinition[] } {
  const collectionIds = new Set(
    themes.flatMap((theme) => (theme.collection ? [theme.collection.id] : [])),
  )
  const replacedIds = settings.customThemes
    .filter((theme) => theme.collection && collectionIds.has(theme.collection.id))
    .map((theme) => theme.id)
  let next = removeCustomThemes(settings, replacedIds)
  // Halves that pointed at a replaced theme follow it to its new version.
  const reassign: Array<{ appearance: ThemeAppearance; id: string }> = []
  for (const appearance of ['light', 'dark'] as const) {
    const current = appearance === 'light' ? settings.lightTheme : settings.darkTheme
    if (replacedIds.includes(current)) reassign.push({ appearance, id: current })
  }
  if (next.customThemes.length + themes.length > MAX_CUSTOM_THEMES) {
    throw new ThemeLibraryError('tooMany')
  }
  const imported: ThemeDefinition[] = []
  for (const theme of themes) {
    const keepId = replacedIds.includes(theme.id)
    const label = keepId ? theme.label : uniqueThemeLabel(next, theme.label)
    const id = keepId ? theme.id : uniqueThemeId(next, theme.id || label)
    const stored = { ...theme, id, label }
    next = upsertCustomTheme(next, stored)
    imported.push(stored)
  }
  for (const { appearance, id } of reassign) {
    const theme = findThemeById(next, id)
    if (theme && getThemeColorsForMode(theme, appearance)) next = assignHalf(next, appearance, id)
  }
  return { settings: next, imported }
}
