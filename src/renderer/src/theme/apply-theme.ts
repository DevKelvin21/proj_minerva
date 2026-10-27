/**
 * Paints a palette on this window: one custom property per theme role on
 * <html> (see `styles.css`), `data-appearance` for the light/dark-specific
 * rules, and a copy in localStorage that `public/theme-boot.js` applies on
 * the next launch before the first paint. That copy is only a boot cache:
 * settings.json (through main) stays the source of truth, and the renderer
 * overwrites the cache whenever it applies the saved theme.
 */
import { themeCssVariables, type ResolvedAppearance } from '../../../shared/theme/appearance'
import type { ThemeAppearance, ThemeColors } from '../../../shared/theme/themes'

export const THEME_BOOT_CACHE_KEY = 'minerva:theme-boot:v1'

export interface ThemeBootCache {
  appearance: ThemeAppearance
  vars: Record<string, string>
}

export function applyPalette(
  colors: ThemeColors,
  appearance: ThemeAppearance,
  contrast: number,
  options: { cache: boolean },
): void {
  const root = document.documentElement
  const vars = themeCssVariables(colors, appearance, contrast)
  for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value)
  root.dataset.appearance = appearance
  if (!options.cache) return
  const cache: ThemeBootCache = { appearance, vars }
  try {
    window.localStorage.setItem(THEME_BOOT_CACHE_KEY, JSON.stringify(cache))
  } catch {
    // Storage full or unavailable: the next boot uses the CSS defaults instead.
  }
}

export function applyResolvedAppearance(resolved: ResolvedAppearance, contrast: number): void {
  applyPalette(resolved.colors, resolved.appearance, contrast, { cache: true })
}
