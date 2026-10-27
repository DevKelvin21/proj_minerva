import { useEffect } from 'react'
import { sidebarIsDrawer, widthTier } from '../lib/layout'
import { useAppStore } from '../stores/app-store'

/** `true` when the key event happened while typing (inputs, textareas, editable nodes). */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

/**
 * Esc goes back from a dashboard page (repo, feature) to the overview, unless
 * a modal is up, the PR-list drawer is open (Esc closes it, `Sidebar.tsx`)
 * or the user is typing in a field.
 */
export function useEscapeBack(onBack: () => void): void {
  const settingsOpen = useAppStore((s) => s.settingsOpen)
  useEffect(() => {
    if (settingsOpen) return
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Escape' || event.defaultPrevented || isTypingTarget(event.target)) return
      const { sidebarOpen } = useAppStore.getState()
      if (sidebarOpen && sidebarIsDrawer(widthTier(window.innerWidth))) return
      onBack()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [settingsOpen, onBack])
}
