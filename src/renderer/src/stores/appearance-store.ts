/**
 * Appearance state of this window: the saved settings (from main), whether
 * the OS is dark (`prefers-color-scheme`, which main keeps in step with
 * `nativeTheme`), and an optional live preview from the theme editor that
 * only this window paints until it is saved or discarded.
 *
 * Saving goes through main (`settings:setAppearance`), which persists to
 * settings.json and pushes `appearanceChanged` to every window. The store
 * applies the change optimistically and rolls back if main refuses it.
 */
import { create } from 'zustand'
import {
  DEFAULT_APPEARANCE_SETTINGS,
  resolveAppearance,
  sanitizeAppearanceSettings,
  type AppearanceSettings,
  type ResolvedAppearance,
} from '../../../shared/theme/appearance'
import type { ThemeAppearance, ThemeColors } from '../../../shared/theme/themes'

export interface ThemePreview {
  colors: ThemeColors
  appearance: ThemeAppearance
}

interface AppearanceState {
  settings: AppearanceSettings
  systemDark: boolean
  preview: ThemePreview | null
  /** Last save error (raw IPC message; render it with `errorText()`), cleared on the next save. */
  error: string | null
  /** From main (boot or `appearanceChanged`); untrusted shape, sanitized here. */
  receive: (settings: unknown) => void
  setSystemDark: (dark: boolean) => void
  setPreview: (preview: ThemePreview | null) => void
  /** Saves through main; `false` (and `error` set) when main refused it. */
  save: (next: AppearanceSettings) => Promise<boolean>
}

export const useAppearanceStore = create<AppearanceState>((set, get) => ({
  settings: DEFAULT_APPEARANCE_SETTINGS,
  systemDark: true,
  preview: null,
  error: null,
  receive: (settings) =>
    set({ settings: sanitizeAppearanceSettings(settings) ?? DEFAULT_APPEARANCE_SETTINGS }),
  setSystemDark: (systemDark) => set({ systemDark }),
  setPreview: (preview) => set({ preview }),
  save: async (next) => {
    const previous = get().settings
    set({ settings: next, error: null })
    try {
      const saved = await window.minerva.settings.setAppearance(next)
      get().receive(saved)
      return true
    } catch (error) {
      set({ settings: previous, error: error instanceof Error ? error.message : String(error) })
      return false
    }
  },
}))

export function selectResolved(state: AppearanceState): ResolvedAppearance {
  return resolveAppearance(state.settings, state.systemDark)
}

/** The palette this window paints right now (the editor preview wins). */
export function useResolvedAppearance(): ResolvedAppearance {
  const settings = useAppearanceStore((s) => s.settings)
  const systemDark = useAppearanceStore((s) => s.systemDark)
  const preview = useAppearanceStore((s) => s.preview)
  const resolved = resolveAppearance(settings, systemDark)
  return preview
    ? { ...resolved, appearance: preview.appearance, colors: preview.colors }
    : resolved
}
