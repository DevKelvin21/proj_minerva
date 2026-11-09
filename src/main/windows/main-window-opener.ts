/**
 * "Bring up the main window, then open this": shared by a click on a system
 * notification and every menu bar (tray) entry that leads into the app. When
 * no main window exists (macOS keeps the app running with every window
 * closed), one is created and the `openActivity` push goes out once it has
 * loaded; the preload holds it until the renderer subscribes.
 *
 * Only an item id (or `null` = the Inbox) ever travels: nothing here opens a
 * URL that came from PR content.
 */
import type { BrowserWindow } from 'electron'
import { MINERVA_EVENTS, type OpenActivityEvent } from '../../shared/events'

export interface MainWindowOpenerDeps {
  /** The open main window (not the detached didactic one), if any. */
  find: () => BrowserWindow | null
  /** Creates the main window (it shows itself once ready). */
  create: () => BrowserWindow
  /** Makes Minerva the active app (macOS: a menu bar click leaves another app in front). */
  activateApp: () => void
}

/**
 * `target` omitted = only bring the window up (Open Minerva); an
 * `OpenActivityEvent` also opens that item, or the Inbox for `itemId: null`.
 */
export type MainWindowOpener = (target?: OpenActivityEvent) => void

export function createMainWindowOpener(deps: MainWindowOpenerDeps): MainWindowOpener {
  return (target) => {
    const existing = deps.find()
    const win = existing ?? deps.create()
    deps.activateApp()
    if (existing) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    }
    if (!target) return
    const payload: OpenActivityEvent = { itemId: target.itemId }
    const send = (): void => {
      if (!win.isDestroyed()) win.webContents.send(MINERVA_EVENTS.openActivity, payload)
    }
    if (!existing || win.webContents.isLoading()) win.webContents.once('did-finish-load', send)
    else send()
  }
}
