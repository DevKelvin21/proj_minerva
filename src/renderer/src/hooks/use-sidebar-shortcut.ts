import { useEffect } from 'react'
import { isTypingTarget } from './use-escape-back'
import { useAppStore } from '../stores/app-store'

/**
 * Cmd/Ctrl+B shows or hides the PR list, like the sidebar's own toggle: the
 * docked column on `xl`/`lg` (persisted `sidebarCollapsed`), the drawer over
 * the rail on `md`/`sm` (`toggleSidebarPanel`). Ignored while typing in a
 * field (the shortcut is "bold" in editors) or with Settings up.
 */
export function useSidebarShortcut(): void {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key.toLowerCase() !== 'b' || !(event.metaKey || event.ctrlKey)) return
      if (event.altKey || event.shiftKey || event.defaultPrevented) return
      if (isTypingTarget(event.target)) return
      const state = useAppStore.getState()
      if (state.settingsOpen) return
      event.preventDefault()
      state.toggleSidebarPanel()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])
}
