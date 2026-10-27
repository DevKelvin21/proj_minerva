import { useEffect } from 'react'
import { useAppStore } from '../stores/app-store'

/**
 * Cmd/Ctrl+K opens the command palette from anywhere (also while typing: no
 * field in the app uses the chord), and closes it again. Ignored with
 * Settings up, which owns the keyboard while open.
 */
export function useCommandPaletteShortcut(): void {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key.toLowerCase() !== 'k' || !(event.metaKey || event.ctrlKey)) return
      if (event.altKey || event.shiftKey || event.defaultPrevented) return
      const state = useAppStore.getState()
      if (state.settingsOpen) return
      event.preventDefault()
      if (state.commandPaletteOpen) state.closeCommandPalette()
      else state.openCommandPalette()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])
}
