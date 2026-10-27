/** macOS renderer (Electron's user agent names the OS; no IPC needed). */
export const IS_MAC = typeof navigator !== 'undefined' && /Mac/.test(navigator.userAgent)

/** "⌘" on macOS, "Ctrl" elsewhere: the modifier shown in shortcut hints. */
export const MOD_KEY_LABEL = IS_MAC ? '⌘' : 'Ctrl'
