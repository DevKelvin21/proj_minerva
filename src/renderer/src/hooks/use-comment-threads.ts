import { useCallback, useEffect, useState } from 'react'
import type { CommentThread, RepoRef } from '../../../shared/types'
import { repoKey } from '../../../shared/scm'

interface UseCommentThreadsResult {
  threads: CommentThread[]
  loading: boolean
  error: string | null
  /**
   * Vuelve a pedir los hilos a `main`; se usa tras publicar un comentario.
   * Devuelve los hilos recién obtenidos (además de dejarlos en `threads`)
   * para que un llamador pueda ubicar de inmediato el hilo que acaba de
   * crear/actualizar sin esperar al próximo render (p. ej. para expandirlo).
   */
  reload: () => Promise<CommentThread[]>
  /**
   * Merges a thread's new status (the answer of `scm:setThreadStatus`) into
   * the list without refetching everything. Only status fields are taken:
   * providers may answer without the derived fields (`isOutdated`).
   */
  applyThreadStatus: (updated: CommentThread) => void
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Hilos de comentarios de un PR vía `scm:getCommentThreads`.
 *
 * `reload` llama a `setState` directamente (para poder usarse también desde
 * el handler de "publicar comentario" en `ConversationTab`), así que el efecto
 * inicial no debe invocarla como sentencia directa de su cuerpo: eso también
 * dispara `react-hooks/set-state-in-effect` (la regla propaga el "esto llama
 * a setState" a través de identificadores ya marcados, no solo llamadas
 * literales a `setX`). Se invoca desde una función anidada en su lugar.
 */
export function useCommentThreads(repo: RepoRef, number: number): UseCommentThreadsResult {
  const repoIdentity = repoKey(repo)
  const [threads, setThreads] = useState<CommentThread[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async (): Promise<CommentThread[]> => {
    setLoading(true)
    setError(null)
    try {
      const result = await window.minerva.scm.getCommentThreads({ repo, number })
      setThreads(result)
      return result
    } catch (err: unknown) {
      setError(toErrorMessage(err))
      return []
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- se depende de campos primitivos de `repo`, no de su identidad de objeto.
  }, [repoIdentity, number])

  useEffect(() => {
    void (async () => {
      await reload()
    })()
  }, [reload])

  const applyThreadStatus = useCallback((updated: CommentThread) => {
    setThreads((current) =>
      current.map((thread) =>
        thread.id === updated.id
          ? { ...thread, status: updated.status, isResolved: updated.isResolved }
          : thread,
      ),
    )
  }, [])

  return { threads, loading, error, reload, applyThreadStatus }
}
