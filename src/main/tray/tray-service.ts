/**
 * The macOS menu bar item (Electron `Tray`): the owl as a template image,
 * the unread Inbox count next to it, and a native menu of the newest unread
 * items (`tray-menu.ts` builds the content). macOS only in v1; Windows and
 * Linux get no tray. `MINERVA_TRAY=off` (set by the e2e fixture) never
 * creates one.
 *
 * `refresh()` is called on every inbox change and every notification
 * settings change: it creates the tray when `notifications.menuBar` is on,
 * destroys it when off, and rebuilds the title, tooltip and menu. The `Tray`
 * lives in module state, so it is not garbage collected (which would remove
 * it from the menu bar); `destroy()` runs on `before-quit`.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app, Menu, nativeImage, Tray, type MenuItemConstructorOptions } from 'electron'
import type { ActivityState, NotificationSettings } from '../../shared/activity'
import { buildTrayContent, type TrayAction, type TrayMenuEntry, type TrayText } from './tray-menu'

export interface TrayServiceDeps {
  getState: () => ActivityState
  getSettings: () => NotificationSettings
  text: TrayText
  /** Runs a menu click (open an item, mark all read…) in main. */
  dispatch: (action: TrayAction) => void
}

export interface TrayService {
  refresh(): void
  destroy(): void
}

/** The tray exists only on macOS, unless `MINERVA_TRAY=off`. */
export function trayAvailable(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return platform === 'darwin' && env.MINERVA_TRAY !== 'off'
}

/**
 * `minervaTemplate.png` (+ `@2x`), rendered from the brand mark by
 * `scripts/build-app-icons.mjs`. Packaged: `extraResources` copies
 * `resources/tray/` next to `app.asar`; dev: the repo's own copy.
 */
function trayIconPath(): string {
  const base = app.isPackaged
    ? join(process.resourcesPath, 'tray')
    : join(app.getAppPath(), 'resources', 'tray')
  return join(base, 'minervaTemplate.png')
}

/** Module state on purpose: a `Tray` that is garbage collected leaves the menu bar. */
let tray: Tray | null = null

function toMenuItem(
  entry: TrayMenuEntry,
  dispatch: (action: TrayAction) => void,
): MenuItemConstructorOptions {
  if (entry.type === 'separator') return { type: 'separator' }
  const { action } = entry
  return {
    type: entry.type,
    label: entry.label,
    enabled: entry.enabled,
    ...(entry.type === 'checkbox' ? { checked: entry.checked } : {}),
    // Only the action's ids are captured; nothing reads the item again here.
    ...(action ? { click: () => dispatch(action) } : {}),
  }
}

export function createTrayService(deps: TrayServiceDeps): TrayService {
  const destroy = (): void => {
    if (tray && !tray.isDestroyed()) tray.destroy()
    tray = null
  }

  const ensureTray = (): Tray | null => {
    if (tray && !tray.isDestroyed()) return tray
    const path = trayIconPath()
    if (!existsSync(path)) {
      console.warn('[tray] icon missing at ' + path + '; no menu bar item.')
      return null
    }
    const image = nativeImage.createFromPath(path)
    image.setTemplateImage(true)
    tray = new Tray(image)
    return tray
  }

  return {
    refresh() {
      const settings = deps.getSettings()
      if (!trayAvailable() || !settings.menuBar) {
        destroy()
        return
      }
      const current = ensureTray()
      if (!current) return
      const content = buildTrayContent(deps.getState(), settings, deps.text)
      current.setTitle(content.title, { fontType: 'monospacedDigit' })
      current.setToolTip(content.tooltip)
      current.setContextMenu(
        Menu.buildFromTemplate(content.menu.map((entry) => toMenuItem(entry, deps.dispatch))),
      )
    },
    destroy,
  }
}
