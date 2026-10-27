/**
 * Appearance settings: what settings.json stores, how it is validated, and
 * how it resolves to the palette a window paints.
 *
 * Model (T3 Code's, minus its localStorage keys): an appearance `mode`
 * (`system` follows the OS, see `nativeTheme` in main), one theme for the
 * light half and one for the dark half (T3 Code's "halves"), a contrast
 * percentage, and the user's own themes (created in the editor or imported).
 * settings.json is the single source of truth; main validates every write.
 */
import {
  isCanonicalThemeColor,
  readableThemeColorOn,
  themeColorToHex,
  toCanonicalThemeColor,
} from './color'
import {
  getBuiltInTheme,
  getBuiltInThemes,
  getThemeColorsForMode,
  isThemeAppearance,
  isThemeCollectionId,
  isThemeId,
  isThemeLabel,
  MINERVA_THEME_ID,
  RESERVED_THEME_IDS,
  THEME_COLOR_ROLES,
  type ThemeAppearance,
  type ThemeColorRole,
  type ThemeColors,
  type ThemeDefinition,
} from './themes'

export type AppearanceMode = 'system' | 'light' | 'dark'

export const APPEARANCE_MODES: readonly AppearanceMode[] = ['system', 'light', 'dark']

export const MIN_APPEARANCE_CONTRAST = 50
export const MAX_APPEARANCE_CONTRAST = 200
export const DEFAULT_APPEARANCE_CONTRAST = 100

/** Cap on saved custom themes (each is ~5 KB of settings.json). */
export const MAX_CUSTOM_THEMES = 64

export interface AppearanceSettings {
  mode: AppearanceMode
  /** Theme painted in light appearance (must have a light variant). */
  lightTheme: string
  /** Theme painted in dark appearance (must have a dark variant). */
  darkTheme: string
  /** 50..200; 100 = the theme as designed. */
  contrast: number
  customThemes: ThemeDefinition[]
}

export const DEFAULT_APPEARANCE_SETTINGS: AppearanceSettings = {
  mode: 'system',
  lightTheme: MINERVA_THEME_ID,
  darkTheme: MINERVA_THEME_ID,
  contrast: DEFAULT_APPEARANCE_CONTRAST,
  customThemes: [],
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key))
}

export function isAppearanceMode(value: unknown): value is AppearanceMode {
  return value === 'system' || value === 'light' || value === 'dark'
}

export function isAppearanceContrast(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MIN_APPEARANCE_CONTRAST &&
    value <= MAX_APPEARANCE_CONTRAST
  )
}

/** Every role present, every value in canonical `oklch(…)` form, nothing else. */
function isCanonicalThemeColors(value: unknown): value is ThemeColors {
  if (!isRecord(value)) return false
  const keys = Object.keys(value)
  if (keys.length !== THEME_COLOR_ROLES.length) return false
  return THEME_COLOR_ROLES.every((role) => isCanonicalThemeColor(value[role]))
}

/**
 * A custom theme as stored: strict shape, canonical colors (the renderer
 * canonicalizes before saving), an id no built-in or keyword owns.
 */
export function isStoredCustomTheme(value: unknown): value is ThemeDefinition {
  if (!isRecord(value)) return false
  if (!hasOnlyKeys(value, ['id', 'label', 'appearance', 'colors', 'variants', 'collection'])) {
    return false
  }
  if (!isThemeId(value.id) || RESERVED_THEME_IDS.has(value.id)) return false
  if (!isThemeLabel(value.label) || value.label !== value.label.trim()) return false
  if (!isThemeAppearance(value.appearance)) return false
  if (!isCanonicalThemeColors(value.colors)) return false
  if (value.variants !== undefined) {
    if (!isRecord(value.variants)) return false
    const entries = Object.entries(value.variants)
    if (entries.length === 0) return false
    for (const [appearance, colors] of entries) {
      if (!isThemeAppearance(appearance) || appearance === value.appearance) return false
      if (!isCanonicalThemeColors(colors)) return false
    }
  }
  if (value.collection !== undefined) {
    const collection = value.collection
    if (!isRecord(collection) || !hasOnlyKeys(collection, ['id', 'label'])) return false
    if (!isThemeCollectionId(collection.id) || !isThemeLabel(collection.label)) return false
  }
  return true
}

function findTheme(customThemes: readonly ThemeDefinition[], id: string): ThemeDefinition | null {
  return getBuiltInTheme(id) ?? customThemes.find((theme) => theme.id === id) ?? null
}

/** `id` names a built-in or custom theme that has a variant for `appearance`. */
function themeCovers(
  customThemes: readonly ThemeDefinition[],
  id: unknown,
  appearance: ThemeAppearance,
): boolean {
  if (typeof id !== 'string') return false
  const theme = findTheme(customThemes, id)
  return theme !== null && getThemeColorsForMode(theme, appearance) !== null
}

/**
 * Strict check for a full `AppearanceSettings` (the `settings:setAppearance`
 * payload and the stored block): known keys only, unique custom theme ids,
 * and each half pointing at a theme that has that variant.
 */
export function isAppearanceSettings(value: unknown): value is AppearanceSettings {
  if (!isRecord(value)) return false
  if (!hasOnlyKeys(value, ['mode', 'lightTheme', 'darkTheme', 'contrast', 'customThemes'])) {
    return false
  }
  if (!isAppearanceMode(value.mode) || !isAppearanceContrast(value.contrast)) return false
  const customThemes = value.customThemes
  if (!Array.isArray(customThemes) || customThemes.length > MAX_CUSTOM_THEMES) return false
  if (!customThemes.every(isStoredCustomTheme)) return false
  if (new Set(customThemes.map((theme) => theme.id)).size !== customThemes.length) return false
  return (
    themeCovers(customThemes, value.lightTheme, 'light') &&
    themeCovers(customThemes, value.darkTheme, 'dark')
  )
}

/**
 * Lenient read of a stored block (a hand edit or an older build): keeps every
 * valid piece, drops invalid custom themes, and falls back to the defaults
 * for anything else. `null` only when `value` is not an object at all.
 */
export function sanitizeAppearanceSettings(value: unknown): AppearanceSettings | null {
  if (!isRecord(value)) return null
  const seen = new Set<string>()
  const customThemes = (Array.isArray(value.customThemes) ? value.customThemes : [])
    .filter(isStoredCustomTheme)
    .filter((theme) => {
      if (seen.has(theme.id)) return false
      seen.add(theme.id)
      return true
    })
    .slice(0, MAX_CUSTOM_THEMES)
  return {
    mode: isAppearanceMode(value.mode) ? value.mode : DEFAULT_APPEARANCE_SETTINGS.mode,
    lightTheme: themeCovers(customThemes, value.lightTheme, 'light')
      ? (value.lightTheme as string)
      : DEFAULT_APPEARANCE_SETTINGS.lightTheme,
    darkTheme: themeCovers(customThemes, value.darkTheme, 'dark')
      ? (value.darkTheme as string)
      : DEFAULT_APPEARANCE_SETTINGS.darkTheme,
    contrast: isAppearanceContrast(value.contrast)
      ? value.contrast
      : DEFAULT_APPEARANCE_SETTINGS.contrast,
    customThemes,
  }
}

export function appearanceFor(mode: AppearanceMode, systemDark: boolean): ThemeAppearance {
  if (mode === 'system') return systemDark ? 'dark' : 'light'
  return mode
}

export interface ResolvedAppearance {
  appearance: ThemeAppearance
  theme: ThemeDefinition
  colors: ThemeColors
}

/** Every theme the user can pick: built-ins first, then their own. */
export function allThemes(settings: AppearanceSettings): ThemeDefinition[] {
  return [...getBuiltInThemes(), ...settings.customThemes]
}

export function findThemeById(settings: AppearanceSettings, id: string): ThemeDefinition | null {
  return findTheme(settings.customThemes, id)
}

/** The palette a window paints for `settings` (falls back to Minerva on a dangling id). */
export function resolveAppearance(
  settings: AppearanceSettings,
  systemDark: boolean,
): ResolvedAppearance {
  const appearance = appearanceFor(settings.mode, systemDark)
  const id = appearance === 'light' ? settings.lightTheme : settings.darkTheme
  const picked = findTheme(settings.customThemes, id)
  const pickedColors = picked ? getThemeColorsForMode(picked, appearance) : null
  if (picked && pickedColors) return { appearance, theme: picked, colors: pickedColors }
  const fallback = getBuiltInTheme(MINERVA_THEME_ID) as ThemeDefinition
  return {
    appearance,
    theme: fallback,
    colors: getThemeColorsForMode(fallback, appearance) as ThemeColors,
  }
}

/** `#rrggbb` window background for a resolved appearance (Electron needs hex). */
export function windowBackgroundHex(resolved: ResolvedAppearance): string {
  return (themeColorToHex(resolved.colors.canvas) ?? '#1a1d23').slice(0, 7)
}

// ---------------------------------------------------------------------------
// CSS custom properties. Every role becomes `--theme-<kebab-role>`; Minerva's
// Tailwind tokens (`bg-bg`, `text-muted`, …) point at them in `styles.css`.
// ---------------------------------------------------------------------------

export function themeVariableName(role: ThemeColorRole): string {
  return '--theme-' + role.replace(/[A-Z]/g, (letter) => '-' + letter.toLowerCase())
}

/**
 * Colors Minerva needs that are not T3 Code roles: additions green, merged
 * purple and the info blue. Each is a fixed hue per appearance, moved lighter
 * or darker until it reads on the theme's canvas.
 */
const EXTRA_COLORS = {
  success: { dark: '#22c55e', light: '#15803d' },
  merged: { dark: '#c084fc', light: '#7e22ce' },
  info: { dark: '#60a5fa', light: '#1d4ed8' },
} as const

export function extraColorFor(
  name: keyof typeof EXTRA_COLORS,
  colors: ThemeColors,
  appearance: ThemeAppearance,
): string {
  const readable = readableThemeColorOn(EXTRA_COLORS[name][appearance], colors.canvas, 4.5)
  return toCanonicalThemeColor(readable) ?? colors.accent
}

/** Contrast slider -> the three variables `styles.css` mixes with (T3 Code's formula). */
export function contrastVariables(contrast: number): Record<string, string> {
  const boost = Math.max(contrast - 100, 0)
  return {
    '--appearance-contrast-base': Math.min(contrast, 100) + '%',
    '--appearance-contrast-boost': boost + '%',
    '--appearance-contrast-border-boost': boost / 4 + '%',
  }
}

/** Every custom property a window sets on `<html>` for this palette. */
export function themeCssVariables(
  colors: ThemeColors,
  appearance: ThemeAppearance,
  contrast: number,
): Record<string, string> {
  const variables: Record<string, string> = {}
  for (const role of THEME_COLOR_ROLES) variables[themeVariableName(role)] = colors[role]
  variables['--theme-success'] = extraColorFor('success', colors, appearance)
  variables['--theme-merged'] = extraColorFor('merged', colors, appearance)
  variables['--theme-info'] = extraColorFor('info', colors, appearance)
  return { ...variables, ...contrastVariables(contrast) }
}
