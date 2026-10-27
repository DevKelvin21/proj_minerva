/**
 * Keeps Electron's native side in step with the saved appearance:
 * `nativeTheme.themeSource` (native dialogs, menus, the title bar, and
 * `prefers-color-scheme` in every renderer) follows the mode, and every
 * window's background color is the resolved theme's canvas, so a new window
 * or a resize never flashes the wrong color behind the page.
 */
import { BrowserWindow, nativeTheme } from 'electron'
import { settingsStore } from '../settings/store'
import { resolveAppearance, windowBackgroundHex } from '../../shared/theme/appearance'

/** Background for a window created now (same palette its renderer will paint). */
export function currentWindowBackground(): string {
  return windowBackgroundHex(
    resolveAppearance(settingsStore.getAppearance(), nativeTheme.shouldUseDarkColors),
  )
}

function repaintWindowBackgrounds(): void {
  const color = currentWindowBackground()
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.setBackgroundColor(color)
  }
}

/** Applies the saved mode to `nativeTheme` and repaints window backgrounds. */
export function applyNativeAppearance(): void {
  const { mode } = settingsStore.getAppearance()
  if (nativeTheme.themeSource !== mode) nativeTheme.themeSource = mode
  repaintWindowBackgrounds()
}

let listening = false

/** Once at startup, before the first window: sync, then follow OS appearance flips. */
export function initNativeAppearance(): void {
  applyNativeAppearance()
  if (listening) return
  listening = true
  nativeTheme.on('updated', repaintWindowBackgrounds)
}
