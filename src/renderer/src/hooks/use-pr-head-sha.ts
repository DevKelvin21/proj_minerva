import { useEffect, useState } from 'react'
import type { RepoRef } from '../../../shared/types'
import { repoKey } from '../../../shared/scm'

interface UsePrHeadShaResult {
  /** `null` mientras carga o si el fetch falla (best-effort, T42). */
  headSha: string | null
}

/**
 * SHA actual del head de un PR, para la detección de staleness (T42, Issue
 * 2): la ventana didáctica desacoplada no recibe el `PullRequestSummary`
 * completo (a diferencia de `DidacticPanel`, que ya tiene `selectedPr.headSha`
 * sin pedir nada) — este hook hace UN fetch liviano de
 * `scm:getPullRequestDetail` al montar solo para conseguir ese SHA.
 *
 * Sigue el mismo patrón que `use-pull-request-detail.ts`: `setState` solo
 * dentro de callbacks de la promesa (nunca síncrono en el cuerpo del
 * efecto), cleanup con flag `cancelled`, deps por campos primitivos de
 * `repo` (no su identidad de objeto). Best-effort: un error de red se traga
 * y `headSha` se queda en `null` (no hay affordance de error propia — la
 * barra de staleness simplemente no aparece sin `currentHeadSha`).
 */
export function usePrHeadSha(repo: RepoRef, number: number): UsePrHeadShaResult {
  const repoIdentity = repoKey(repo)
  const [headSha, setHeadSha] = useState<string | null>(null)

  useEffect(() => {
    if (!repo.name || !Number.isInteger(number) || number <= 0) return

    let cancelled = false

    void window.minerva.scm
      .getPullRequestDetail({ repo, number })
      .then((detail) => {
        if (!cancelled) setHeadSha(detail.headSha)
      })
      .catch(() => {
        // Best-effort (ver cabecera): se queda en `null`, la barra de
        // staleness simplemente no aparece hasta que se sepa el SHA actual.
      })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- se depende de campos primitivos de `repo`, no de su identidad de objeto.
  }, [repoIdentity, number])

  return { headSha }
}
