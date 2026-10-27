/**
 * Boots appearance for this window (main or detached didactic): reads the
 * saved settings, paints them before React renders, then follows every
 * change: saves from any window (`appearanceChanged`), OS light/dark flips
 * (`prefers-color-scheme`, kept in step with `nativeTheme` by main) and the
 * editor's live preview. Never throws: a failed read keeps the defaults.
 */
import { resolveAppearance } from '../../../shared/theme/appearance'
import { useAppearanceStore } from '../stores/appearance-store'
import { applyPalette } from './apply-theme'

function paint(): void {
  const { settings, systemDark, preview } = useAppearanceStore.getState()
  if (preview) {
    applyPalette(preview.colors, preview.appearance, settings.contrast, { cache: false })
    return
  }
  const resolved = resolveAppearance(settings, systemDark)
  applyPalette(resolved.colors, resolved.appearance, settings.contrast, { cache: true })
}

export async function bootAppearance(): Promise<void> {
  const store = useAppearanceStore.getState()
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  store.setSystemDark(media.matches)
  try {
    store.receive(await window.minerva.settings.getAppearance())
  } catch (error) {
    console.warn('[theme] could not read the saved appearance, using the defaults:', error)
  }
  paint()
  useAppearanceStore.subscribe((state, previous) => {
    if (
      state.settings !== previous.settings ||
      state.systemDark !== previous.systemDark ||
      state.preview !== previous.preview
    ) {
      paint()
    }
  })
  media.addEventListener('change', (event) =>
    useAppearanceStore.getState().setSystemDark(event.matches),
  )
  window.minerva.events.onAppearanceChanged(({ appearance }) => {
    useAppearanceStore.getState().receive(appearance)
  })
}
