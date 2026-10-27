import type { BrowserWindowConstructorOptions } from 'electron'

/**
 * Height of the renderer's title bar (`TitleBar.tsx`, `h-11`). The native
 * window controls are centered in this band, so both must stay in step.
 */
export const TITLE_BAR_HEIGHT = 44

/** macOS traffic lights: 12px buttons centered in the bar, 16px from the left edge. */
const TRAFFIC_LIGHT_POSITION = { x: 16, y: Math.round((TITLE_BAR_HEIGHT - 12) / 2) }

/**
 * Frameless main window whose title bar is the app's own (`TitleBar.tsx`).
 * The OS keeps drawing the window controls: the traffic lights on macOS, a
 * Window Controls Overlay on Windows and Linux. With `titleBarOverlay` set,
 * Chromium exposes the free band as `env(titlebar-area-*)`, which the
 * renderer uses to keep its content clear of the controls (and which goes
 * away by itself in macOS full screen, where the traffic lights hide).
 */
export function frameOptions(overlay: {
  color: string
  symbolColor: string
}): BrowserWindowConstructorOptions {
  if (process.platform === 'darwin') {
    return {
      titleBarStyle: 'hidden',
      titleBarOverlay: { height: TITLE_BAR_HEIGHT },
      trafficLightPosition: TRAFFIC_LIGHT_POSITION,
    }
  }
  return {
    titleBarStyle: 'hidden',
    titleBarOverlay: { ...overlay, height: TITLE_BAR_HEIGHT },
  }
}
