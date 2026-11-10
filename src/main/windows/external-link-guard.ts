/**
 * Guard de enlaces externos (T11, extraído de `main/index.ts` en T14 para que
 * la ventana didáctica desacoplada, `./didactic-window.ts`, no lo reimplemente
 * ni pueda divergir de la ventana principal): el Markdown del panel didáctico
 * viene de una IA que analiza contenido de PRs no confiable, así que solo se
 * abren esquemas http(s) en el navegador del sistema; cualquier otro (file:,
 * protocolos custom, etc.) se deniega sin abrir nada.
 *
 * Subframes: the only frames the app renders are the AI's HTML diagrams
 * (`renderer/.../HtmlDiagram.tsx`, srcdoc, sandboxed without scripts). A
 * subframe may load its srcdoc and nothing else, so even a sanitizer or CSP
 * regression cannot turn a diagram into a frame on a local file or a site.
 */
import { shell, type BrowserWindow } from 'electron'

/** The only documents a subframe may navigate to (fragment changes included). */
export function isAllowedSubframeUrl(url: string): boolean {
  return /^about:(srcdoc|blank)(#.*)?$/.test(url)
}

export function installExternalLinkGuard(win: BrowserWindow): void {
  win.webContents.on('will-frame-navigate', (event) => {
    if (!event.isMainFrame && !isAllowedSubframeUrl(event.url)) event.preventDefault()
  })

  win.webContents.setWindowOpenHandler((details) => {
    try {
      const url = new URL(details.url)
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        void shell.openExternal(details.url)
      }
    } catch {
      // URL no parseable: denegar sin abrir nada.
    }
    return { action: 'deny' }
  })
}
