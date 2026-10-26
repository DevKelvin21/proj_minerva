import { useCallback, useEffect, useState } from 'react'
import type { GhAccount } from '../../../shared/types'

interface UseGhAccountsResult {
  accounts: GhAccount[]
  loading: boolean
  /**
   * Vuelve a pedir la lista. Main la cachea con TTL 5s
   * (`main/auth/gh-cli-auth.ts`), así que dos clics seguidos devuelven lo
   * mismo — en tiempo humano (correr `gh auth login` en otra terminal y
   * volver) el resultado siempre es fresco.
   */
  reload: () => Promise<void>
}

/**
 * Cuentas que `gh` conoce (F18), para el selector de la sección "GitHub
 * access". Canal `scm:listGhAccounts` — lectura pura, ya cacheada en main
 * (TTL 5s + single-flight), así que este hook no agrega cache propia.
 *
 * `enabled` lets a caller skip spawning `gh` when the section doesn't apply:
 * the hook must be called on every render (rules of hooks), so the condition
 * is an argument, not an `if` around the call.
 *
 * Un fallo del canal se trata como lista vacía a propósito, sin superficie de
 * error: la lista es una AYUDA para elegir cuenta, y quien de verdad reporta
 * el problema de `gh` es el `AuthStatus` que la misma sección ya pinta
 * (`cli_unavailable`/`cli_unauthenticated`). Dos mensajes de error para la
 * misma causa raíz solo confundirían.
 *
 * `accounts === null` (todavía sin respuesta) es el ÚNICO origen de
 * `loading`, y se deriva en el `return` en vez de mantenerse en un estado
 * aparte: así el efecto no llama a `setState` en su cuerpo, que es lo que
 * prohíbe `react-hooks/set-state-in-effect` (mismo criterio que `useAuth` y
 * `useSettings` — solo se hace `setState` dentro del callback de la promesa).
 */
export function useGhAccounts(enabled: boolean): UseGhAccountsResult {
  const [accounts, setAccounts] = useState<GhAccount[] | null>(null)
  const [reloading, setReloading] = useState(false)

  const fetchAccounts = useCallback(async (): Promise<GhAccount[]> => {
    try {
      return await window.minerva.scm.listGhAccounts()
    } catch {
      return []
    }
  }, [])

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    void fetchAccounts().then((result) => {
      if (!cancelled) setAccounts(result)
    })
    return () => {
      cancelled = true
    }
  }, [enabled, fetchAccounts])

  // Handler de evento (no un efecto): acá `setState` síncrono es correcto.
  const reload = useCallback(async (): Promise<void> => {
    setReloading(true)
    const result = await fetchAccounts()
    setAccounts(result)
    setReloading(false)
  }, [fetchAccounts])

  return {
    accounts: enabled && accounts !== null ? accounts : [],
    loading: enabled && (accounts === null || reloading),
    reload,
  }
}
