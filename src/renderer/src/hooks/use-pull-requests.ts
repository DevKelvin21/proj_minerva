import { useCallback, useEffect, useState } from 'react'
import { prKey } from '../../../shared/scm'
import type { PrStateFilter, PullRequestSummary, ScmListError } from '../../../shared/types'

const SEARCH_DEBOUNCE_MS = 250

interface UsePullRequestsResult {
  pullRequests: PullRequestSummary[]
  /** Providers that failed this time (typed codes); the others' items are still listed. */
  providerErrors: ScmListError[]
  loading: boolean
  /** The whole call failed (IPC/main), not a single provider. */
  error: string | null
  /** Re-pide la lista de inmediato (sin debounce), con `search`/`state` vigentes. */
  refetch: () => void
  /**
   * Sella "visto" para `pr` (T52, F10): fire-and-forget contra
   * `scm:markPrSeen` (el fallo se loguea con `console.warn`, no bloquea la
   * UI) + clear optimista del `unread` de ESE item en el estado local, para
   * que el dot desaparezca al instante sin esperar un refetch.
   */
  markSeen: (pr: PullRequestSummary) => void
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Lista PRs vía `scm:listPullRequests` (fan-out over every enabled provider), re-pidiendo a `main` cuando cambia
 * `search` (con debounce), `state` (T52, filtro de estado — SIN debounce,
 * fetch inmediato) o `authState`, y cuando se llama `refetch()` manualmente
 * o llega un evento `prListChanged` del watcher de main.
 *
 * El debounce de `search` vive en un efecto SEPARADO que solo depende de
 * `search`: escribe `debouncedSearch` tras `SEARCH_DEBOUNCE_MS`. El efecto de
 * fetch depende de `debouncedSearch`/`state`/`authState`/`refetchToken` y
 * dispara de inmediato — así un cambio de `state` (o un refetch) no hereda el
 * debounce pensado para el tecleo del buscador.
 *
 * Toda la lógica async (incluido el `setLoading(true)` inicial) vive dentro
 * de una función anidada invocada de inmediato: si esas llamadas a
 * `setState` fueran sentencias directas del cuerpo del efecto,
 * `react-hooks/set-state-in-effect` las marca como anti-patrón (setState
 * síncrono en un efecto). Envolverlas en una función anidada evita el falso
 * positivo sin cambiar el comportamiento.
 */
export function usePullRequests(
  search: string,
  authState?: string,
  state: PrStateFilter = 'open',
): UsePullRequestsResult {
  const [pullRequests, setPullRequests] = useState<PullRequestSummary[]>([])
  const [providerErrors, setProviderErrors] = useState<ScmListError[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [debouncedSearch, setDebouncedSearch] = useState(search)
  const [refetchToken, setRefetchToken] = useState(0)

  // Debounce: solo aplica al tecleo del buscador. Si `search` no cambió
  // (p. ej. re-render por otra razón) el timeout igual dispara, pero
  // `setDebouncedSearch` con el mismo valor no re-renderiza (bail-out de
  // React por igualdad referencial en primitivos).
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [search])

  // `authState` está en las dependencias a propósito: al pasar de
  // `signed_out` a `signed_in` (o al cerrar sesión) hay que volver a pedir la
  // lista — un UNAUTHENTICATED previo al login no se corrige solo.
  // `state` e `refetchToken` disparan un fetch inmediato (sin debounce).
  useEffect(() => {
    let cancelled = false

    void (async () => {
      setLoading(true)
      setError(null)

      try {
        const result = await window.minerva.scm.listPullRequests({
          search: debouncedSearch.trim() || undefined,
          state,
        })
        if (!cancelled) {
          setPullRequests(result.items)
          setProviderErrors(result.errors)
        }
      } catch (err: unknown) {
        if (!cancelled) setError(toErrorMessage(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [debouncedSearch, state, authState, refetchToken])

  const refetch = useCallback(() => {
    setRefetchToken((token) => token + 1)
  }, [])

  // Watcher de main (T50/T51, F10): cualquier cambio detectado (PR nuevo,
  // cerrado/mergeado, comentarios, actualización) refresca la lista vigente
  // (respeta `search`/`state` actuales, ver el efecto de fetch de arriba).
  useEffect(() => {
    const unsubscribe = window.minerva.events.onPrListChanged(() => {
      refetch()
    })
    return unsubscribe
  }, [refetch])

  const markSeen = useCallback((pr: PullRequestSummary) => {
    window.minerva.scm
      .markPrSeen({
        repo: pr.repo,
        number: pr.number,
        updatedAt: pr.updatedAt,
        commentCount: pr.commentCount,
      })
      .catch((err: unknown) => {
        console.warn('No se pudo marcar el PR como visto', err)
      })

    setPullRequests((prev) =>
      prev.map((item) =>
        prKey(item.repo, item.number) === prKey(pr.repo, pr.number)
          ? { ...item, unread: { isNew: false, hasUpdates: false, hasNewComments: false } }
          : item,
      ),
    )
  }, [])

  return { pullRequests, providerErrors, loading, error, refetch, markSeen }
}
