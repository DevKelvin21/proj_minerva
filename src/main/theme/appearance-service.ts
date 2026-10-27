/**
 * Keeps Electron's native side in step with the saved appearance:
 * `nativeTheme.themeSource` (native dialogs, menus, the title bar, and
 * `prefers-color-scheme` in every renderer) follows the mode, and every
 * window's background color is the resolved theme's canvas, so a new window
 * or a resize never flashes the wrong color behind the page.
 */
import { BrowserWindow, nativeTheme } from 'electron'
import { settingsStore } from '../settings/store'
import {
  resolveAppearance,
  titleBarOverlayColors,
  windowBackgroundHex,
} from '../../shared/theme/appearance'

/** Background for a window created now (same palette its renderer will paint). */
export function currentWindowBackground(): string {
  return windowBackgroundHex(
    resolveAppearance(settingsStore.getAppearance(), nativeTheme.shouldUseDarkColors),
  )
}

/** Colors of the Windows/Linux window controls drawn over the title bar. */
export function currentTitleBarOverlay(): { color: string; symbolColor: string } {
  return titleBarOverlayColors(
    resolveAppearance(settingsStore.getAppearance(), nativeTheme.shouldUseDarkColors),
  )
}

/** Windows created with a title bar overlay (the main one): only those have controls to recolor. */
const overlayWindows = new WeakSet<BrowserWindow>()

export function trackTitleBarOverlay(win: BrowserWindow): void {
  if (process.platform !== 'darwin') overlayWindows.add(win)
}

function repaintWindowBackgrounds(): void {
  const color = currentWindowBackground()
  const overlay = process.platform === 'darwin' ? null : currentTitleBarOverlay()
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    win.setBackgroundColor(color)
    if (overlay && overlayWindows.has(win)) win.setTitleBarOverlay(overlay)
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
