import { useCallback, useEffect, useState } from 'react'
import type { AiProviderId } from '../../../shared/ai-providers'
import type { AiProviderStatus } from '../../../shared/types'
import { errorText } from '../lib/error-text'

function toErrorMessage(error: unknown): string {
  return errorText(error)
}

interface UseProviderStatusResult {
  /** `null` mientras no se haya cargado la primera vez. */
  statuses: Record<AiProviderId, AiProviderStatus> | null
  loading: boolean
  error: string | null
  /** Vuelve a pedir `ai:getProviderStatus` (botón "Volver a comprobar" de `CliLoginGuide`). */
  refetch: () => void
}

/**
 * Estado de login por proveedor de IA (T27, `ai:getProviderStatus`; UI en
 * T30): `unavailable`/`installed`/`authenticated` por proveedor, sin
 * secretos (ver `AiProviderStatus` en `shared/types.ts`).
 *
 * A propósito NO vive en `app-store` como `aiModelInfo`: cada consumidor
 * (la pantalla de Settings, que se desmonta por completo al cerrarse, ver el
 * comentario de cabecera de `SettingsModal`; y desde T60 también
 * `DidacticAnalysisArea` para decidir si mostrar `NoCliProvidersCard`) monta
 * su propia instancia y refetchea al montar — conviene así porque el login de
 * los CLIs (`claude login`/`codex login`/`opencode auth login`) sucede FUERA
 * de la app y el estado puede haber cambiado desde la última consulta; el
 * costo real por consulta es bajo, `getAiProviderStatusMap` (`main/ai/
 * providers/provider-status.ts`) delega en el probe de cada proveedor, que
 * ya cachea con su propio TTL corto.
 *
 * Mismo criterio anti-`set-state-in-effect` que `use-settings.ts`/`use-auth.ts`:
 * el efecto de montaje no llama `setState` de forma síncrona (el `loading`
 * inicial ya arranca en `true`), solo dentro de los callbacks de la promesa.
 */
export function useProviderStatus(): UseProviderStatusResult {
  const [statuses, setStatuses] = useState<Record<AiProviderId, AiProviderStatus> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.minerva.ai
      .getProviderStatus()
      .then((result) => {
        if (!cancelled) setStatuses(result)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(toErrorMessage(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const refetch = useCallback(() => {
    setLoading(true)
    setError(null)
    void window.minerva.ai
      .getProviderStatus()
      .then((result) => setStatuses(result))
      .catch((err: unknown) => setError(toErrorMessage(err)))
      .finally(() => setLoading(false))
  }, [])

  return { statuses, loading, error, refetch }
}
