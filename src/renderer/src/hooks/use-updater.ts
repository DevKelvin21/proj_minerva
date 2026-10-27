import { useCallback, useEffect, useState } from 'react'
import type { UpdaterStatus } from '../../../shared/types'
import { errorText } from '../lib/error-text'

function toErrorMessage(error: unknown): string {
  return errorText(error)
}

interface UseUpdaterResult {
  /** `null` mientras no se haya cargado la primera vez. */
  status: UpdaterStatus | null
  /** `app.getVersion()` (`minerva:getVersion`); `null` mientras no cargó. */
  version: string | null
  loading: boolean
  error: string | null
  /** Chequeo manual contra el feed (botón "Buscar actualizaciones"). */
  check: () => Promise<void>
  /** Descarga con consentimiento explícito (botón "Descargar (130 MB)"). */
  download: () => Promise<void>
  /** Acción SECUNDARIA de `downloaded` — el camino principal es instalar al salir. */
  quitAndInstall: () => Promise<void>
  openReleasePage: () => Promise<void>
}

/**
 * Estado del auto-updater (T90/T93, F17): carga inicial de `updater:getStatus`
 * + `minerva:getVersion`, suscripción a `onUpdaterStatus` para el resto de la
 * vida del componente, y las cuatro acciones tipadas de
 * `window.minerva.updater`. Mismo criterio anti-`set-state-in-effect` que
 * `use-provider-status.ts`/`use-settings.ts`: el efecto de montaje arranca
 * `loading` en `true` de forma síncrona y solo llama `setState` dentro de los
 * callbacks de la promesa/evento, nunca de forma síncrona en el cuerpo del
 * efecto.
 *
 * En dev y en TODA la suite e2e, `status.phase` es `disabled` (el core del
 * updater vive en `main/updater/`, T91) — este hook no lo trata como caso
 * especial, es la UI (`UpdateSection`) la que decide no montarse en ese caso.
 */
export function useUpdater(): UseUpdaterResult {
  const [status, setStatus] = useState<UpdaterStatus | null>(null)
  const [version, setVersion] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    void Promise.all([window.minerva.updater.getStatus(), window.minerva.system.getVersion()])
      .then(([initialStatus, initialVersion]) => {
        if (cancelled) return
        setStatus(initialStatus)
        setVersion(initialVersion)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(toErrorMessage(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    const unsubscribe = window.minerva.events.onUpdaterStatus((payload) => {
      if (!cancelled) setStatus(payload.status)
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  const check = useCallback(async (): Promise<void> => {
    setError(null)
    try {
      const result = await window.minerva.updater.check()
      setStatus(result)
    } catch (err) {
      setError(toErrorMessage(err))
    }
  }, [])

  const download = useCallback(async (): Promise<void> => {
    setError(null)
    try {
      const result = await window.minerva.updater.download()
      setStatus(result)
    } catch (err) {
      setError(toErrorMessage(err))
    }
  }, [])

  const quitAndInstall = useCallback(async (): Promise<void> => {
    setError(null)
    try {
      await window.minerva.updater.quitAndInstall()
    } catch (err) {
      setError(toErrorMessage(err))
    }
  }, [])

  const openReleasePage = useCallback(async (): Promise<void> => {
    setError(null)
    try {
      await window.minerva.updater.openReleasePage()
    } catch (err) {
      setError(toErrorMessage(err))
    }
  }, [])

  return { status, version, loading, error, check, download, quitAndInstall, openReleasePage }
}
