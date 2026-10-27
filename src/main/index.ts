import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { registerIpcHandlers } from './ipc/handlers'
import { ghCliAuth } from './scm/github/gh-cli-auth'
import { createSnapshotCleaner } from './scm/snapshot-store'
import { stopOpencodeServer } from './ai/providers/opencode-runtime'
import { secureWebPreferences } from './windows/secure-web-preferences'
import { installExternalLinkGuard } from './windows/external-link-guard'
import { hydratePathFromLoginShell } from './system/shell-path'
import { initUpdater, stop as stopUpdater } from './updater/updater'
import {
  currentTitleBarOverlay,
  currentWindowBackground,
  initNativeAppearance,
  trackTitleBarOverlay,
} from './theme/appearance-service'
import { frameOptions } from './windows/title-bar'

const isDev = !app.isPackaged

// Aislamiento para e2e (Playwright): un userData alternativo evita que los
// tests pisen settings/cache/snapshots reales y arranca cada corrida desde
// cero. Debe correr ANTES de `app.whenReady()` (todas las lecturas de
// `app.getPath('userData')` en main son lazy, dentro de funciones).
if (process.env.MINERVA_USER_DATA_DIR) {
  app.setPath('userData', process.env.MINERVA_USER_DATA_DIR)
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    // Piso del layout responsivo (F16): la UI está diseñada y verificada hasta
    // el tier `sm`/`xshort` (ver `renderer/src/lib/layout.ts`); por debajo de
    // esto el shell deja de ser operable, así que el WM no puede llevarla ahí.
    minWidth: 560,
    minHeight: 420,
    show: false,
    // The saved theme's canvas, so nothing flashes behind the first paint.
    backgroundColor: currentWindowBackground(),
    title: 'Minerva',
    // The app draws its own title bar; the OS keeps the window controls.
    ...frameOptions(currentTitleBarOverlay()),
    // `webPreferences`/guard de enlaces externos extraídos a `./windows/` en
    // T14 para que la ventana didáctica desacoplada (`./windows/didactic-window.ts`)
    // los reutilice sin poder divergir de la ventana principal.
    webPreferences: secureWebPreferences(),
  })

  trackTitleBarOverlay(mainWindow)

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  installExternalLinkGuard(mainWindow)

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  }
}

void app.whenReady().then(async () => {
  // Enriquecer el PATH con el del shell de login del usuario ANTES de registrar
  // handlers (el probe de proveedores CLI y `resolve-cli.ts` cachean, así que
  // deben ver el PATH completo desde la primera resolución). Solo importa en el
  // empaquetado lanzado desde el launcher del SO —que hereda un PATH mínimo—;
  // en dev desde terminal el PATH ya viene completo y esto es un no-op barato.
  if (app.isPackaged) {
    hydratePathFromLoginShell()
  }

  // Warm the `gh` probe so the renderer's first `scm:getAuthStatus` doesn't
  // wait for the whole spawn. NOT awaited: the probe includes a network call
  // (`GET /user`) and a slow network must not delay the window. The probe is
  // single-flight, so the renderer's first query joins this same promise.
  void ghCliAuth.getStatus()

  // Native theme (dialogs, menus, `prefers-color-scheme`) follows the saved
  // appearance before any window exists.
  initNativeAppearance()

  const { stopPrWatcher } = await registerIpcHandlers()

  // Watcher de PRs en background (T51, F10): para el timer antes de que la
  // app termine de cerrarse — sin esto seguiría re-armándose (`setTimeout`)
  // tras destruir todas las ventanas, hasta que el proceso muriera solo.
  app.on('before-quit', () => {
    stopPrWatcher()
  })

  // Auto-updater (T91, F17): decide capacidad (`disabled`/`auto`/`notify`,
  // o el guion de `MINERVA_MOCK_UPDATER`) y agenda el check de arranque +
  // el periódico. Se inicializa DESPUÉS de `registerIpcHandlers()` para que
  // los canales `updater:*` ya estén registrados cuando el primer broadcast
  // de estado pudiera dispararse. `stop()` limpia los timers antes de que la
  // app termine de cerrarse — mismo criterio que `stopPrWatcher` arriba.
  initUpdater()
  app.on('before-quit', () => {
    stopUpdater()
  })

  // Limpieza periódica de snapshots de PRs (T54): barrido inmediato + timer.
  // Se crea DESPUÉS de `whenReady` porque el sweep usa `app.getPath('userData')`.
  const snapshotCleaner = createSnapshotCleaner()
  snapshotCleaner.start()

  app.on('before-quit', () => {
    snapshotCleaner.stop()
    // Fire-and-forget: el SIGTERM al grupo se envía sincrónicamente dentro;
    // la escalada a SIGKILL (1s después) puede no llegar a correr si el
    // proceso principal muere antes, y está bien — opencode termina con
    // SIGTERM (verificado en T55).
    void stopOpencodeServer()
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
