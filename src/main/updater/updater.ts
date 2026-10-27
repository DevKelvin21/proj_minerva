import { app, shell, BrowserWindow } from 'electron'
import { accessSync, constants as fsConstants } from 'node:fs'
import type { Logger, ProgressInfo, UpdateInfo } from 'electron-updater'
import { MINERVA_EVENTS } from '../../shared/events'
import { mt } from '../i18n'
import type { UpdaterStatus, UpdateInfoLite } from '../../shared/types'
import { resolveUpdaterCapability, type UpdaterCapability } from './capability'
import { ALLOW_PRERELEASE, CHECK_INTERVAL_MS, STARTUP_DELAY_MS, buildReleaseUrl } from './config'
import { createMockUpdaterEngine, parseMockUpdaterMode, type MockUpdaterEngine } from './mock-updater'

/**
 * Singleton del auto-updater (T91, F17): cablea `electron-updater`, mantiene
 * el `UpdaterStatus` actual y hace broadcast a TODAS las ventanas ante cada
 * transición (mismo patrón que `broadcastProgress`/`broadcastPrListChanged`
 * en `../ipc/handlers.ts`). Expone `initUpdater`/`getStatus`/`checkNow`/
 * `download`/`quitAndInstall`/`openReleasePage`/`stop`, que `../ipc/handlers.ts`
 * cablea 1:1 a los canales `updater:*`, y `../index.ts` llama `initUpdater()`
 * tras `app.whenReady()` + `stop()` en `before-quit` (mismo lugar que
 * `stopPrWatcher`).
 *
 * **Import perezoso de `electron-updater`**: el módulo real (`ensureRealAutoUpdater`)
 * solo se importa la PRIMERA VEZ que hace falta un chequeo real contra el
 * feed — es decir, nunca si la capacidad es `disabled` (dev y TODA la suite
 * e2e). Arranque más rápido y cero riesgo de que el paquete haga algo por su
 * cuenta cuando no corresponde. `import type` de arriba (`Logger`,
 * `ProgressInfo`, `UpdateInfo`) se borra en compilación — no cuenta como el
 * import perezoso, son solo tipos.
 *
 * **Mock primero, capacidad después**: si `MINERVA_MOCK_UPDATER` está
 * presente, `initUpdater()` NI SIQUIERA llama a `resolveUpdaterCapability`
 * (`./capability.ts`) — el guion de `./mock-updater.ts` es una alternativa
 * completa a la lógica real, no un caso más de la tabla de capacidad (mismo
 * criterio documentado ahí y en `PLAN.md` § F17). Esto es lo que permite que
 * el mock funcione en la suite e2e, donde `!app.isPackaged` dejaría al
 * updater real siempre en `disabled`.
 *
 * **`releaseUrl` la construye SIEMPRE `buildReleaseUrl` (`./config.ts`)**,
 * nunca se usa una URL que venga del feed de `electron-updater` — ni en el
 * motor real (`toUpdateInfoLite`) ni en el mock (`./mock-updater.ts` importa
 * la misma función). Si la versión del feed no valida como semver, el
 * estado pasa a `error` (decisión documentada en `./config.ts`) en vez de
 * `available` con una URL rota o ausente.
 *
 * **Errores nunca silenciosos**: cualquier fallo de `electron-updater` llega
 * acá por su evento `error` (`AppUpdater` SIEMPRE lo emite antes de
 * rechazar la promesa de `checkForUpdates`/`downloadUpdate`, verificado
 * contra su fuente) y se traduce a `{ phase: 'error', message }` con
 * `displayMessage` — nunca el stack interno de main. Por eso `realCheckNow`/
 * `realDownload` atrapan el rechazo y no hacen nada más: el listener
 * `error` ya dejó el estado correcto antes de que la promesa rechace.
 */

type ElectronUpdaterModule = typeof import('electron-updater')
type AppUpdaterInstance = ElectronUpdaterModule['autoUpdater']

const logger: Logger = {
  info: (message) => console.log('[updater]', message),
  warn: (message) => console.warn('[updater]', message),
  error: (message) => console.error('[updater]', message),
  debug: (message) => console.debug('[updater]', message),
}

let capability: UpdaterCapability = { mode: 'disabled' }
let status: UpdaterStatus = { phase: 'disabled' }
/** Snapshot de la última actualización vista disponible (o `undefined`); separado de `status` para no tener que desarmar la unión discriminada en cada transición (`download-progress`/`update-downloaded`/`update-not-available`). */
let currentInfo: UpdateInfoLite | undefined
let lastCheckedAt: string | undefined

let startupTimer: ReturnType<typeof setTimeout> | undefined
let intervalTimer: ReturnType<typeof setInterval> | undefined
let initialized = false

let mockEngine: MockUpdaterEngine | undefined
let realAutoUpdater: AppUpdaterInstance | undefined

/** `fs.accessSync(path, W_OK)` envuelto en try/catch — la implementación real de `canWrite` que pide `./capability.ts`. */
function canWrite(path: string): boolean {
  try {
    accessSync(path, fsConstants.W_OK)
    return true
  } catch {
    return false
  }
}

/** Actualiza el estado actual y lo empuja a TODAS las ventanas abiertas — mismo patrón que `broadcastProgress` (`../ipc/handlers.ts`). */
function setStatus(next: UpdaterStatus): void {
  status = next
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(MINERVA_EVENTS.updaterStatusChanged, { status: next })
    }
  }
}

/** Mensaje de exhibición sin stack interno (frontera IPC, ver `CLAUDE.md`). */
function displayMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return mt('updater.unknownError')
}

function toUpdateInfoLite(info: UpdateInfo): UpdateInfoLite | undefined {
  const releaseUrl = buildReleaseUrl(info.version)
  if (releaseUrl === undefined) return undefined
  return { version: info.version, releaseUrl, releaseDate: info.releaseDate }
}

/**
 * Saca `autoUpdater` del módulo `electron-updater` contemplando el interop
 * ESM/CJS. **No es defensa paranoica: sin esto el updater real no funciona.**
 *
 * `electron-updater` es CommonJS y exporta `autoUpdater` con
 * `Object.defineProperty(exports, 'autoUpdater', { get: () => ... })` — un
 * getter con ARROW FUNCTION, definido al final del módulo. `cjs-module-lexer`
 * (lo que usa Node para derivar los exports nombrados de un CJS importado
 * desde ESM) reconoce el patrón que emite TypeScript
 * (`get: function () { return X }`) pero NO ese, así que al importarlo desde
 * nuestro bundle de main —que es ESM— `mod.autoUpdater` llega `undefined` y
 * el objeto solo existe colgado de `mod.default`. El resto de los exports
 * (`AppUpdater`, `NsisUpdater`, …) sí se detectan; el único roto es
 * justamente el que necesitamos.
 *
 * Verificado a mano contra electron-updater 6.8.9 corriendo bajo Electron 43:
 * `typeof mod.autoUpdater === 'undefined'` y `typeof mod.default.autoUpdater
 * === 'object'`. Sin este fallback, `instance.autoDownload = false` lanzaba un
 * TypeError que el `catch` de `realCheckNow` se tragaba: el updater quedaba
 * MUDO en producción (v0.7.0) mientras dev y toda la suite e2e seguían en
 * verde, porque ahí el camino real nunca se ejecuta (`disabled` o mock).
 */
export function resolveAutoUpdaterExport(mod: ElectronUpdaterModule): AppUpdaterInstance {
  const named = mod.autoUpdater
  if (named) return named
  const fromDefault = (mod as { default?: ElectronUpdaterModule }).default?.autoUpdater
  if (fromDefault) return fromDefault
  throw new Error(mt('updater.missingExport'))
}

/** Wiring de `electron-updater` (una sola vez, perezoso — ver comentario del módulo). */
async function ensureRealAutoUpdater(): Promise<AppUpdaterInstance> {
  if (realAutoUpdater) return realAutoUpdater

  const mod = await import('electron-updater')
  const instance = resolveAutoUpdaterExport(mod)
  instance.autoDownload = false
  instance.autoInstallOnAppQuit = true
  instance.allowPrerelease = ALLOW_PRERELEASE
  instance.logger = logger

  instance.on('checking-for-update', () => {
    setStatus({ phase: 'checking' })
  })

  instance.on('update-available', (info: UpdateInfo) => {
    lastCheckedAt = new Date().toISOString()
    const infoLite = toUpdateInfoLite(info)
    const cap = capability
    if (!infoLite) {
      currentInfo = undefined
      setStatus({
        phase: 'error',
        message: mt('updater.invalidVersion', { version: info.version }),
        lastCheckedAt,
      })
      return
    }
    currentInfo = infoLite
    setStatus(
      cap.mode === 'notify'
        ? { phase: 'unsupported', reason: cap.reason, available: infoLite }
        : { phase: 'available', info: infoLite },
    )
  })

  instance.on('update-not-available', () => {
    lastCheckedAt = new Date().toISOString()
    currentInfo = undefined
    const cap = capability
    setStatus(cap.mode === 'notify' ? { phase: 'unsupported', reason: cap.reason } : { phase: 'idle', lastCheckedAt })
  })

  instance.on('download-progress', (progress: ProgressInfo) => {
    if (!currentInfo) return
    setStatus({ phase: 'downloading', info: currentInfo, percent: Math.round(progress.percent) })
  })

  instance.on('update-downloaded', () => {
    if (!currentInfo) return
    setStatus({ phase: 'downloaded', info: currentInfo })
  })

  instance.on('error', (error: Error) => {
    setStatus({ phase: 'error', message: displayMessage(error), lastCheckedAt })
  })

  realAutoUpdater = instance
  return instance
}

async function realCheckNow(): Promise<void> {
  if (capability.mode === 'disabled') return
  let instance: AppUpdaterInstance
  try {
    instance = await ensureRealAutoUpdater()
  } catch (error) {
    // El SETUP falla ANTES de que exista el listener 'error' (import roto,
    // interop ESM/CJS, wiring). Nadie más va a transicionar el estado, así que
    // se hace acá: tragárselo dejaba el updater mudo para siempre — fue
    // exactamente el bug de v0.7.0 (ver `resolveAutoUpdaterExport`).
    setStatus({ phase: 'error', message: displayMessage(error), lastCheckedAt })
    return
  }
  try {
    await instance.checkForUpdates()
  } catch {
    // El listener 'error' de arriba ya transicionó el estado y emitió el
    // broadcast correspondiente antes de que esta promesa rechazara
    // (`AppUpdater.checkForUpdates` SIEMPRE emite 'error' antes de
    // re-lanzar, verificado contra su fuente) — acá no hay nada más que
    // hacer.
  }
}

async function realDownload(): Promise<void> {
  // `notify`/`disabled` NUNCA descargan (decisión de producto de F17, ver
  // `PLAN.md` § F17): esto es lo que hace que `download()` sea un no-op
  // seguro en esos modos, sin importar qué dispare la llamada.
  if (capability.mode !== 'auto') return
  if (status.phase !== 'available') return
  let instance: AppUpdaterInstance
  try {
    instance = await ensureRealAutoUpdater()
  } catch (error) {
    // Idem `realCheckNow`: si el setup falla no hay listener 'error' que
    // pueda reportarlo, así que el estado se transiciona acá.
    setStatus({ phase: 'error', message: displayMessage(error), lastCheckedAt })
    return
  }
  try {
    await instance.downloadUpdate()
  } catch {
    // Acá SÍ: el listener 'error' ya dejó el estado correcto.
  }
}

function scheduleChecks(): void {
  startupTimer = setTimeout(() => {
    void checkNow()
  }, STARTUP_DELAY_MS)
  intervalTimer = setInterval(() => {
    void checkNow()
  }, CHECK_INTERVAL_MS)
}

/** Inicializa el updater (real o mock, según `MINERVA_MOCK_UPDATER`); idempotente — llamadas repetidas son no-op. Llamar UNA vez desde `../index.ts` tras `app.whenReady()`. */
export function initUpdater(): void {
  if (initialized) return
  initialized = true

  const mockModeRaw = process.env.MINERVA_MOCK_UPDATER
  if (mockModeRaw) {
    mockEngine = createMockUpdaterEngine(parseMockUpdaterMode(mockModeRaw), app.getVersion())
    mockEngine.init(setStatus)
    scheduleChecks()
    return
  }

  capability = resolveUpdaterCapability({
    platform: process.platform,
    isPackaged: app.isPackaged,
    env: process.env,
    canWrite,
  })

  if (capability.mode === 'disabled') {
    setStatus({ phase: 'disabled' })
    return
  }

  setStatus(capability.mode === 'notify' ? { phase: 'unsupported', reason: capability.reason } : { phase: 'idle' })
  scheduleChecks()
}

/** Snapshot actual, sin disparar ningún chequeo (lectura pura, mismo criterio que `ai:getAnalysisState`). */
export function getStatus(): UpdaterStatus {
  return status
}

/** Fuerza un chequeo inmediato contra el feed (arranque, intervalo de 6h, o botón manual — todos pasan por acá). */
export async function checkNow(): Promise<UpdaterStatus> {
  if (mockEngine) {
    await mockEngine.checkNow(setStatus)
    return status
  }
  await realCheckNow()
  return status
}

/** Solo tiene efecto en `available` con capacidad `auto` (real) o guion feliz (mock); no-op en cualquier otro caso. */
export async function download(): Promise<UpdaterStatus> {
  if (mockEngine) {
    await mockEngine.download(setStatus, status)
    return status
  }
  await realDownload()
  return status
}

/** Acción SECUNDARIA (ver `shared/ipc.ts`): el camino principal es seguir usando Minerva y que se instale sola al salir (`autoInstallOnAppQuit`). No-op fuera de `downloaded`, y siempre no-op bajo el mock (no hay instalador real que correr). */
export function quitAndInstall(): void {
  if (status.phase !== 'downloaded') return
  if (mockEngine) return
  realAutoUpdater?.quitAndInstall()
}

function currentReleaseUrl(): string | undefined {
  switch (status.phase) {
    case 'available':
    case 'downloading':
    case 'downloaded':
      return status.info.releaseUrl
    case 'unsupported':
      return status.available?.releaseUrl
    default:
      return undefined
  }
}

/** `shell.openExternal` sobre la `releaseUrl` que ya construyó main (ver `./config.ts`) — nunca una URL que venga del feed. No-op si no hay ninguna URL conocida todavía. */
export async function openReleasePage(): Promise<void> {
  const url = currentReleaseUrl()
  if (!url) return
  await shell.openExternal(url)
}

/** Limpia scheduler y motor mock; llamar en `before-quit` (mismo patrón que `stopPrWatcher`, `../ipc/handlers.ts`). */
export function stop(): void {
  if (startupTimer !== undefined) clearTimeout(startupTimer)
  if (intervalTimer !== undefined) clearInterval(intervalTimer)
  startupTimer = undefined
  intervalTimer = undefined
  mockEngine?.stop()
}
