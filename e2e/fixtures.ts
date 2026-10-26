import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { test as base, expect, chromium } from '@playwright/test'
import type { Browser, BrowserContext, CDPSession, Page, TestInfo } from '@playwright/test'
import type { ChildProcess } from 'node:child_process'
import { reportSwept, sweepOrphanedOpencodeServers } from './opencode-sweep'

declare global {
  interface Window {
    // Superficie IPC del preload (window.minerva). Tipada de verdad en
    // src/shared/ipc.ts; aquí opaca a propósito: los specs la ejercitan como
    // caja negra, igual que hacían las suites CDP legacy.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    minerva: any
  }
}

const require = createRequire(join(process.cwd(), 'package.json'))
const electronPath = require('electron') as unknown as string

export interface MinervaApp {
  proc: ChildProcess
  browser: Browser
  context: BrowserContext
}

export interface LaunchOptions {
  /**
   * Env extra mezclado SOBRE el default del fixture. Un valor `undefined`
   * BORRA la variable (p. ej. `{ MINERVA_MOCK_AI: undefined }` lanza con IA
   * real del proveedor activo — lo usa el paso condicional de settings).
   */
  env?: Record<string, string | undefined>
  /** Ejecutable alterno (p. ej. el binario empaquetado de dist/). Default: el Electron de node_modules. */
  executable?: string
  /**
   * Args ANTES de `--remote-debugging-port=0`. Default `['out/main/index.js']`;
   * el binario empaquetado no lleva script (pasar `[]`).
   */
  args?: string[]
}

/**
 * Lanza la app construida (`out/main/index.js`; el script `test:e2e` corre
 * `electron-vite build` antes) y conecta Playwright por CDP.
 *
 * DELIBERADAMENTE no se usa `_electron.launch`: con Electron 43 +
 * Playwright 1.62, `electronApp.close()` se queda colgado para siempre en
 * ciertos escenarios (p. ej. tras copiar al clipboard) aunque el proceso de
 * Electron salga limpio e inmediato — bug conocido y cerrado como "not
 * planned" (microsoft/playwright#39248); el cuelgue contamina el teardown
 * del worker (120s + exit 1) y ni SIGKILL lo destraba. Con
 * `connectOverCDP` el teardown es una desconexión de WebSocket (nunca
 * espera al app) y el ciclo de vida del proceso es nuestro.
 *
 * Env del lanzamiento:
 * - `MINERVA_MOCK=1` + `MINERVA_MOCK_AI=1`: universo shopwave + IA mock
 *   determinista (mismo contrato que las suites smoke legacy).
 * - `MINERVA_USER_DATA_DIR`: settings, cache de análisis y snapshots parten
 *   de CERO en cada test y no pisan el userData real — reemplaza toda la
 *   limpieza manual de estado que las suites CDP hacían al arrancar.
 */
export async function launchMinerva(
  userDataDir: string,
  opts: LaunchOptions = {},
): Promise<MinervaApp> {
  const env: Record<string, string | undefined> = {
    ...process.env,
    MINERVA_MOCK: '1',
    MINERVA_MOCK_AI: '1',
    // Kill switch explícito del updater (F17/T94): hoy ya queda `disabled` por
    // `!app.isPackaged` (`resolveUpdaterCapability`, `main/updater/capability.ts`),
    // pero blindarlo acá evita que el día que `packaged.spec.ts` u otro spec
    // corra el binario empaquetado de verdad, el updater real se active sin
    // que el spec lo pida. `MINERVA_MOCK_UPDATER` (que pasan los tests de
    // `updater.spec.ts` vía `opts.env`) se resuelve ANTES que este kill switch
    // en `initUpdater()` (`main/updater/updater.ts`), así que no se pisan.
    MINERVA_UPDATER: 'off',
    MINERVA_USER_DATA_DIR: userDataDir,
    // Terminals hosted inside an Electron app (VS Code, T3 Code…) export this, and it
    // turns the spawned Electron into plain Node ("does not provide an export named
    // 'BrowserWindow'", exit 1). Always strip it.
    ELECTRON_RUN_AS_NODE: undefined,
    ...opts.env,
  }
  for (const key of Object.keys(env)) {
    if (env[key] === undefined) delete env[key]
  }
  const proc = spawn(
    opts.executable ?? electronPath,
    [...(opts.args ?? ['out/main/index.js']), '--remote-debugging-port=0'],
    {
      env: env as NodeJS.ProcessEnv,
      stdio: ['ignore', 'ignore', 'pipe'],
    },
  )
  const wsEndpoint = await new Promise<string>((resolve, reject) => {
    let buf = ''
    const onData = (d: Buffer) => {
      buf += d.toString()
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/)
      if (m) {
        proc.stderr?.off('data', onData)
        resolve(m[1])
      }
    }
    proc.stderr?.on('data', onData)
    proc.once('exit', (code) =>
      reject(new Error('Electron murió antes de exponer CDP (código ' + code + ')')),
    )
    setTimeout(() => reject(new Error('timeout esperando el endpoint DevTools')), 15_000)
  })
  // Seguir drenando stderr: si el pipe se llena, Electron se bloquea al escribir.
  proc.stderr?.resume()
  const browser = await chromium.connectOverCDP(wsEndpoint)
  return { proc, browser, context: browser.contexts()[0] }
}

/**
 * Desconecta el CDP y termina el proceso. SIGTERM con escalada corta a
 * SIGKILL: un exit limpio tarda <1s; si tarda más es el cuelgue de shutdown
 * de Chromium bajo Xvfb (clipboard/X11) y esperar no lo arregla.
 *
 * Al final barre el server de `opencode` si quedó huérfano (F20): la limpieza
 * REAL es `stopOpencodeServer()` en el `before-quit` de main, pero si algún
 * camino se la saltea, cada launch deja ~300 MB colgados — con 39 tests eso
 * llenaba la RAM de la máquina. Se hace por test, no solo al final de la suite,
 * para que un leak no se arrastre por toda la corrida; y se loguea CUÁL test lo
 * dejó, porque el barrido silencioso taparía la regresión. Solo toca procesos
 * huérfanos de la suite — ver `./opencode-sweep.ts`.
 */
export async function closeMinerva(app: MinervaApp): Promise<void> {
  await app.browser.close().catch(() => {})
  app.proc.kill('SIGTERM')
  await new Promise<void>((resolve) => {
    if (app.proc.exitCode !== null) return resolve()
    const killer = setTimeout(() => {
      app.proc.kill('SIGKILL')
      resolve()
    }, 3_000)
    app.proc.once('exit', () => {
      clearTimeout(killer)
      resolve()
    })
  })
  reportSwept('close', sweepOrphanedOpencodeServers())
}

/** Espera la ventana principal lista (lista de PRs mock cargada). */
export async function mainWindow(app: MinervaApp): Promise<Page> {
  let page = app.context.pages().find((p) => !p.url().includes('#didactic'))
  if (!page) {
    page = await app.context.waitForEvent('page', { timeout: 15_000 })
  }
  await page.waitForLoadState('domcontentloaded')
  await expect(page.getByText('apply-coupon').first()).toBeVisible({ timeout: 20_000 })
  return page
}

/**
 * Cambia el tamaño del viewport de una ventana de Electron (F16/T88).
 *
 * `page.setViewportSize()` NO sirve acá: con `connectOverCDP` la página vive en
 * una ventana que Playwright no creó, y ese método exige un contexto propio. La
 * vía que sí funciona es `Emulation.setDeviceMetricsOverride` por CDP — es lo
 * que usó la sonda con la que se midió el diagnóstico de F16 (el diff de 40px a
 * 960x540). La sesión CDP se cachea por página: al detachear, Chromium revierte
 * los overrides de esa sesión.
 *
 * Espera a que `window.innerWidth/Height` reflejen el tamaño pedido, así el
 * llamador no tiene que dormir a ciegas esperando el relayout de React.
 */
const cdpSessions = new WeakMap<Page, CDPSession>()

export async function setViewport(page: Page, width: number, height: number): Promise<void> {
  let session = cdpSessions.get(page)
  if (!session) {
    session = await page.context().newCDPSession(page)
    cdpSessions.set(page, session)
  }
  await session.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await page.waitForFunction(
    ([w, h]) => window.innerWidth === w && window.innerHeight === h,
    [width, height] as const,
  )
}

/** Captura del viewport adjunta como artifact del test (verificación visual). */
export async function attachScreenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const path = testInfo.outputPath(name + '.png')
  await page.screenshot({ path, fullPage: false })
  await testInfo.attach(name, { path, contentType: 'image/png' })
}

/**
 * `window` es la ventana principal, ya con la lista de PRs cargada; la
 * didáctica desacoplada se obtiene con `minerva.context.waitForEvent('page')`
 * desde el test que la necesite.
 */
export const test = base.extend<{ minerva: MinervaApp; window: Page }>({
  // eslint-disable-next-line no-empty-pattern
  minerva: async ({}, use, testInfo) => {
    const app = await launchMinerva(testInfo.outputPath('user-data'))
    await use(app)
    await closeMinerva(app)
  },
  window: async ({ minerva }, use) => {
    await use(await mainWindow(minerva))
  },
})

export { expect }
export type { Page }
