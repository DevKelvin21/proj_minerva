import type { UpdaterStatus, UpdateInfoLite } from '../../shared/types'
import { buildReleaseUrl } from './config'
import { mt } from '../i18n'

/**
 * Guion determinista del auto-updater bajo `MINERVA_MOCK_UPDATER` (T92, F17).
 * MISMO criterio que `MockAiService`/`MINERVA_MOCK_AI` (`../ai/index.ts`):
 * funciona AUNQUE `!app.isPackaged`, que es justo el punto — en la suite e2e
 * (`e2e/`) la app corre sin empaquetar, así que ahí `resolveUpdaterCapability`
 * (`./capability.ts`) deja el updater real en `disabled` por diseño, y este
 * mock es LA única vía de ejercitar la UI de Settings/badge de T93. Por eso
 * la selección del mock va ANTES de mirar la capacidad real (ver
 * `./updater.ts`): no es una rama de la tabla de capacidad, es una
 * alternativa completa a ella.
 *
 * A propósito este módulo NO importa `electron`: recibe la versión actual
 * (`app.getVersion()`) por parámetro y expone sus transiciones de estado vía
 * un callback `setStatus` que el caller (`./updater.ts`) decide cómo
 * propagar (acá: broadcast a todas las ventanas). Esto lo hace testeable con
 * vitest puro, sin mockear `electron` (la secuencia de estados es lo único
 * que exige el criterio de aceptación de T92).
 *
 * Tres guiones según el valor de `MINERVA_MOCK_UPDATER`:
 * - `'1'` (o cualquier valor no reconocido — camino feliz por default):
 *   al `checkNow()` → `checking` → `available` (versión = la actual con el
 *   minor +1, `releaseUrl` construida con la MISMA `buildReleaseUrl` que usa
 *   el updater real). Al `download()` → varios `downloading` con `percent`
 *   0→100 en pasos cortos → `downloaded`.
 * - `'notify'`: al `checkNow()` → `checking` → `unsupported` con reason
 *   `'mac-unsigned'` y un `available` poblado (el caso mac/AppImageLauncher:
 *   SÍ hay una versión más nueva, pero esta instalación no puede bajarla
 *   sola). `download()` es no-op — nunca debe transicionar a `downloading`.
 * - `'error'`: al `checkNow()` → `checking` → `error` con un mensaje de
 *   exhibición.
 *
 * El guion completo (checking→downloaded del camino feliz) dura ≤2s a
 * propósito (pasos de `downloading` con delays cortos, `STEP_MS`): si no, el
 * spec e2e de T94 se vuelve lento y flaky (mismo criterio que toda la suite
 * Playwright del repo).
 */
export type MockUpdaterMode = 'happy' | 'notify' | 'error'

/** `MINERVA_MOCK_UPDATER=notify`/`=error` seleccionan esos guiones; CUALQUIER otro valor (incluido `'1'`) cae al camino feliz por default. */
export function parseMockUpdaterMode(raw: string): MockUpdaterMode {
  if (raw === 'notify' || raw === 'error') return raw
  return 'happy'
}

const STEP_MS = 120

/** Versión = la actual con el minor +1 (patch a 0; ignora prerelease/build de `currentVersion`, no aplica acá). */
export function nextMinorVersion(currentVersion: string): string {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(currentVersion)
  if (!match) return currentVersion
  const major = Number.parseInt(match[1], 10)
  const minor = Number.parseInt(match[2], 10)
  return `${major}.${minor + 1}.0`
}

/**
 * Misma interfaz "pública" que expone `./updater.ts` para el motor real:
 * `setStatus` es inyectado por el caller en cada llamada (en vez de guardado
 * en el constructor) para que quien orquesta (`./updater.ts`) sea la única
 * fuente de verdad del `UpdaterStatus` actual y del broadcast — este motor
 * solo decide QUÉ estados emitir y CUÁNDO.
 */
export interface MockUpdaterEngine {
  /** Estado inicial (antes de cualquier `checkNow`): `unsupported` para el guion `notify`, `idle` para los otros dos. */
  init(setStatus: (status: UpdaterStatus) => void): void
  checkNow(setStatus: (status: UpdaterStatus) => void): Promise<void>
  /** No-op en los guiones `notify`/`error`, o si `current` no es `available` (nada que descargar). */
  download(setStatus: (status: UpdaterStatus) => void, current: UpdaterStatus): Promise<void>
  /** Cancela cualquier paso del guion en vuelo (no queda ningún timer suelto tras `stop()`). */
  stop(): void
}

export function createMockUpdaterEngine(mode: MockUpdaterMode, currentVersion: string): MockUpdaterEngine {
  const mockVersion = nextMinorVersion(currentVersion)
  const releaseUrl = buildReleaseUrl(mockVersion)
  // `buildReleaseUrl` solo falla si `mockVersion` no valida como semver; con
  // `currentVersion` = `app.getVersion()` (siempre semver válido en un
  // package.json real) esto no debería ocurrir nunca — el fallback vacío es
  // defensivo, no un camino esperado.
  const info: UpdateInfoLite = {
    version: mockVersion,
    releaseUrl: releaseUrl ?? '',
    releaseDate: new Date().toISOString(),
  }

  const timers = new Set<ReturnType<typeof setTimeout>>()

  function scheduledWait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const id = setTimeout(() => {
        timers.delete(id)
        resolve()
      }, ms)
      timers.add(id)
    })
  }

  function clearTimers(): void {
    for (const id of timers) clearTimeout(id)
    timers.clear()
  }

  return {
    init(setStatus) {
      setStatus(mode === 'notify' ? { phase: 'unsupported', reason: 'mac-unsigned' } : { phase: 'idle' })
    },

    async checkNow(setStatus) {
      clearTimers()
      setStatus({ phase: 'checking' })
      await scheduledWait(STEP_MS)

      if (mode === 'error') {
        setStatus({
          phase: 'error',
          message: mt('updater.mockFeedError'),
          lastCheckedAt: new Date().toISOString(),
        })
        return
      }
      if (mode === 'notify') {
        setStatus({ phase: 'unsupported', reason: 'mac-unsigned', available: info })
        return
      }
      setStatus({ phase: 'available', info })
    },

    async download(setStatus, current) {
      if (mode !== 'happy') return
      if (current.phase !== 'available') return

      clearTimers()
      const steps = [0, 25, 50, 75]
      for (const percent of steps) {
        setStatus({ phase: 'downloading', info, percent })
        await scheduledWait(STEP_MS)
      }
      setStatus({ phase: 'downloaded', info })
    },

    stop() {
      clearTimers()
    },
  }
}
