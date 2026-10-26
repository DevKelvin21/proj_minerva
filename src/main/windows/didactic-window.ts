/**
 * Ventana didáctica desacoplada (T14): UNA sola instancia a la vez. Si ya hay
 * una abierta, `openDidacticWindow` la reutiliza (la enfoca y la navega al PR
 * nuevo con `loadURL`/`loadFile` otra vez) en vez de crear una segunda.
 * OJO: cuando solo cambia el FRAGMENTO de la URL (mismo origen/path, otro
 * `#didactic/...`), Chromium lo trata como navegación same-document y NO
 * recarga el renderer — por eso `main.tsx` escucha `hashchange` y remonta
 * `DidacticWindowApp` (`src/renderer/src/DidacticWindowApp.tsx`) con el hash
 * nuevo; sin eso, la ventana reutilizada mostraba el PR anterior con la URL
 * del nuevo.
 *
 * Carga el MISMO `index.html` que la ventana principal (mismo bundle de
 * renderer), con `#didactic/<owner>/<name>/<number>` en el hash
 * (`../../shared/didactic-route.ts`, fuente de verdad de ese formato,
 * compartida con `main.tsx`). Mismo preload y `webPreferences` seguras que la
 * ventana principal (`./secure-web-preferences.ts`) y mismo guard de enlaces
 * externos (`./external-link-guard.ts`).
 */
import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import type { RepoRef } from '../../shared/types'
import { buildDidacticHash } from '../../shared/didactic-route'
import { secureWebPreferences } from './secure-web-preferences'
import { installExternalLinkGuard } from './external-link-guard'

const DIDACTIC_WINDOW_WIDTH = 1000
const DIDACTIC_WINDOW_HEIGHT = 900
// Mínimos bajados en F16/T87: con 700x600 esta ventana no entraba como columna
// en un tiling de tres, que es justo el uso que tiene (dejarla al lado del
// editor mientras se lee el PR). El contenido es una columna de lectura
// (`DidacticWindowApp`), así que 520px alcanzan.
const DIDACTIC_WINDOW_MIN_WIDTH = 520
const DIDACTIC_WINDOW_MIN_HEIGHT = 420

let didacticWindow: BrowserWindow | null = null

function windowTitleFor(repo: RepoRef, number: number): string {
  return 'Minerva — Análisis ' + repo.fullName + '#' + number
}

/**
 * Navega la ventana didáctica (nueva o reutilizada) al PR pedido. En dev con
 * `ELECTRON_RENDERER_URL` se concatena el hash a mano (con `#`, formato de
 * URL normal); en prod, `loadFile` recibe el hash SIN `#` inicial vía la
 * opción `{ hash }` (Node se lo antepone al armar la URL `file://` con
 * `url.format()`, ver el comentario de `../../shared/didactic-route.ts`).
 */
function loadDidacticRoute(win: BrowserWindow, repo: RepoRef, number: number, title: string): void {
  const hash = buildDidacticHash(repo, number, title)

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL + '#' + hash)
  } else {
    void win.loadFile(join(import.meta.dirname, '../renderer/index.html'), { hash })
  }
}

export function openDidacticWindow(repo: RepoRef, number: number, title: string): void {
  if (didacticWindow && !didacticWindow.isDestroyed()) {
    didacticWindow.setTitle(windowTitleFor(repo, number))
    loadDidacticRoute(didacticWindow, repo, number, title)
    didacticWindow.focus()
    return
  }

  const win = new BrowserWindow({
    width: DIDACTIC_WINDOW_WIDTH,
    height: DIDACTIC_WINDOW_HEIGHT,
    minWidth: DIDACTIC_WINDOW_MIN_WIDTH,
    minHeight: DIDACTIC_WINDOW_MIN_HEIGHT,
    show: false,
    backgroundColor: '#1a1d23',
    title: windowTitleFor(repo, number),
    webPreferences: secureWebPreferences(),
  })

  win.on('ready-to-show', () => win.show())
  // El <title> del index.html ("Minerva") pisaría el título por-PR de esta
  // ventana en cada navegación; se bloquea esa actualización automática.
  win.on('page-title-updated', (event) => event.preventDefault())
  win.on('closed', () => {
    if (didacticWindow === win) didacticWindow = null
  })

  installExternalLinkGuard(win)
  loadDidacticRoute(win, repo, number, title)

  didacticWindow = win
}
