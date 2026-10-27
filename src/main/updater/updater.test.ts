import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `./updater.ts` es un singleton de módulo (estado en variables top-level),
 * así que cada test necesita `vi.resetModules()` + un `import()` fresco para
 * no arrastrar `initialized`/`capability`/`mockEngine` del test anterior —
 * mismo problema que cualquier singleton, pero sin precedente en el repo
 * (los otros singletons de main, p. ej. `AnalysisCache`, se instancian por
 * clase e inyectan su dependencia, ver `analysis-cache.test.ts`).
 *
 * Se mockea `electron` (`app`/`shell`/`BrowserWindow`) igual que
 * `settings/store.test.ts`/`ai/analysis-store.test.ts`: fuera de un proceso
 * Electron real, `app.isPackaged`/`getVersion()` no existen. `electronState`
 * es mutable por test para simular empaquetado/versión.
 *
 * Estos tests SOLO ejercitan las rutas `disabled` y `MINERVA_MOCK_UPDATER`
 * (mock), que son las que puede correr una suite de vitest sin una sesión
 * real de `electron-updater` contra el feed de GitHub — la ruta real
 * (`auto`/`notify` sin mock) la cubre `capability.test.ts` (la función pura
 * que decide el modo) y la verificación manual de la Aceptación (`npm run
 * dev` queda en `disabled`; `MINERVA_MOCK_UPDATER=1 npm run dev` recorre el
 * guion).
 */
const electronState = { isPackaged: false, version: '0.6.3' }
const openExternalMock = vi.fn()

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return electronState.isPackaged
    },
    getVersion: () => electronState.version,
  },
  shell: {
    openExternal: (...args: unknown[]) => openExternalMock(...args),
  },
  BrowserWindow: {
    getAllWindows: () => [],
  },
}))

describe('updater singleton (T91 núcleo real + T92 selección de mock)', () => {
  beforeEach(() => {
    vi.resetModules()
    electronState.isPackaged = false
    electronState.version = '0.6.3'
    openExternalMock.mockReset()
    delete process.env.MINERVA_MOCK_UPDATER
    delete process.env.MINERVA_UPDATER
    delete process.env.APPIMAGE
  })

  afterEach(() => {
    delete process.env.MINERVA_MOCK_UPDATER
    delete process.env.MINERVA_UPDATER
    delete process.env.APPIMAGE
  })

  it('sin empaquetar (dev y suite e2e): initUpdater() deja disabled sin agendar nada', async () => {
    const updater = await import('./updater')
    updater.initUpdater()
    expect(updater.getStatus()).toEqual({ phase: 'disabled' })
  })

  it('MINERVA_UPDATER=off deja disabled aunque isPackaged sea true', async () => {
    electronState.isPackaged = true
    process.env.MINERVA_UPDATER = 'off'
    const updater = await import('./updater')
    updater.initUpdater()
    expect(updater.getStatus()).toEqual({ phase: 'disabled' })
  })

  it('MINERVA_MOCK_UPDATER=1 gana la selección AUNQUE !isPackaged (única vía de e2e, ver ./mock-updater.ts)', async () => {
    process.env.MINERVA_MOCK_UPDATER = '1'
    const updater = await import('./updater')
    updater.initUpdater()
    expect(updater.getStatus()).toEqual({ phase: 'idle' })
    updater.stop()
  })

  it('guion feliz completo vía checkNow()/download(): available -> downloading -> downloaded', async () => {
    process.env.MINERVA_MOCK_UPDATER = '1'
    const updater = await import('./updater')
    updater.initUpdater()

    await updater.checkNow()
    expect(updater.getStatus().phase).toBe('available')

    await updater.download()
    expect(updater.getStatus().phase).toBe('downloaded')
    updater.stop()
  })

  it('guion "notify": unsupported con available poblado; download() no transiciona', async () => {
    process.env.MINERVA_MOCK_UPDATER = 'notify'
    const updater = await import('./updater')
    updater.initUpdater()

    await updater.checkNow()
    const status = updater.getStatus()
    expect(status.phase).toBe('unsupported')

    await updater.download()
    expect(updater.getStatus()).toEqual(status)
    updater.stop()
  })

  it('quitAndInstall() es no-op fuera de "downloaded" (no lanza)', async () => {
    process.env.MINERVA_MOCK_UPDATER = '1'
    const updater = await import('./updater')
    updater.initUpdater()
    await updater.checkNow()
    expect(updater.getStatus().phase).toBe('available')

    expect(() => updater.quitAndInstall()).not.toThrow()
    expect(updater.getStatus().phase).toBe('available')
    updater.stop()
  })

  it('openReleasePage() llama shell.openExternal con la releaseUrl construida por main (nunca la del feed)', async () => {
    process.env.MINERVA_MOCK_UPDATER = '1'
    const updater = await import('./updater')
    updater.initUpdater()
    await updater.checkNow()

    await updater.openReleasePage()

    expect(openExternalMock).toHaveBeenCalledExactlyOnceWith(
      'https://github.com/DevKelvin21/proj_minerva/releases/tag/v0.7.0',
    )
    updater.stop()
  })

  it('openReleasePage() es no-op sin ninguna URL conocida todavía (estado disabled)', async () => {
    const updater = await import('./updater')
    updater.initUpdater()

    await updater.openReleasePage()

    expect(openExternalMock).not.toHaveBeenCalled()
  })

  it('initUpdater() es idempotente: una segunda llamada no reinicia el guion en curso', async () => {
    process.env.MINERVA_MOCK_UPDATER = '1'
    const updater = await import('./updater')
    updater.initUpdater()
    await updater.checkNow()
    expect(updater.getStatus().phase).toBe('available')

    updater.initUpdater()
    expect(updater.getStatus().phase).toBe('available')
    updater.stop()
  })
})

/**
 * Regresión de v0.7.0: el auto-updater REAL quedaba mudo en producción porque
 * `electron-updater` (CJS) exporta `autoUpdater` con un getter de arrow
 * function que `cjs-module-lexer` no reconoce, así que importado desde nuestro
 * bundle ESM el named export llega `undefined` y solo vive en `default`.
 * Dev y toda la suite e2e seguían en verde porque ahí el camino real nunca se
 * ejecuta (`disabled` o mock) — esto lo cubre a nivel unitario.
 */
describe('resolveAutoUpdaterExport (interop ESM/CJS)', () => {
  it('usa el export nombrado cuando cjs-module-lexer SÍ lo detectó', async () => {
    const { resolveAutoUpdaterExport } = await import('./updater')
    const named = { marca: 'named' }
    expect(resolveAutoUpdaterExport({ autoUpdater: named } as never)).toBe(named)
  })

  it('cae a `default.autoUpdater` cuando el named export llega undefined (el caso REAL)', async () => {
    const { resolveAutoUpdaterExport } = await import('./updater')
    const enDefault = { marca: 'default' }
    const mod = { autoUpdater: undefined, default: { autoUpdater: enDefault } }
    expect(resolveAutoUpdaterExport(mod as never)).toBe(enDefault)
  })

  it('lanza con mensaje accionable si no está en ninguno de los dos lados', async () => {
    const { resolveAutoUpdaterExport } = await import('./updater')
    expect(() => resolveAutoUpdaterExport({ default: {} } as never)).toThrow(
      /exposed no autoUpdater/,
    )
  })
})
