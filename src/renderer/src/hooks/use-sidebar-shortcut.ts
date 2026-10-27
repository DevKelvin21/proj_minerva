import { useEffect } from 'react'
import { isTypingTarget } from './use-escape-back'
import { sidebarIsDrawer } from '../lib/layout'
import { useAppStore } from '../stores/app-store'
import { useLayoutTier } from './use-layout-tier'

/**
 * Cmd/Ctrl+B shows or hides the PR list: the docked column on `xl`/`lg`
 * (persisted `sidebarCollapsed`), the drawer on `md`/`sm`. Ignored while
 * typing in a field (the shortcut is "bold" in editors) or with Settings up.
 */
export function useSidebarShortcut(): void {
  const tier = useLayoutTier()
  const isDrawer = sidebarIsDrawer(tier.w)
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key.toLowerCase() !== 'b' || !(event.metaKey || event.ctrlKey)) return
      if (event.altKey || event.shiftKey || event.defaultPrevented) return
      if (isTypingTarget(event.target)) return
      const state = useAppStore.getState()
      if (state.settingsOpen) return
      event.preventDefault()
      if (isDrawer) state.toggleSidebar()
      else state.toggleSidebarCollapsed()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [isDrawer])
}
