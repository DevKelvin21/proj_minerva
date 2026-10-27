import { useState } from 'react'
import { useAppStore } from '../../stores/app-store'
import { useLayoutTier } from '../../hooks/use-layout-tier'
import type { CommentThread, PullRequestDetail } from '../../../../shared/types'
import { Avatar } from '../ui/Avatar'
import { Markdown } from '../ui/Markdown'
import { ThreadCard } from './ThreadCard'

interface ConversationTabProps {
  pr: PullRequestDetail
  threads: CommentThread[]
  loading: boolean
  error: string | null
  /** Vuelve a pedir los hilos a `main`; se pide una sola vez en `CenterPane` y se comparte con `FilesTab`. */
  reload: () => Promise<CommentThread[]>
}

/**
 * Body del PR + hilos de comentarios. Render como texto plano por ahora
 * (`whitespace-pre-wrap`, sin parseo de Markdown): eso llega junto al panel
 * didáctico en T10.
 */
export function ConversationTab({
  pr,
  threads,
  loading,
  error,
  reload,
}: ConversationTabProps): React.JSX.Element {
  const openLineThread = useAppStore((s) => s.openLineThread)
  const tier = useLayoutTier()
  const [draft, setDraft] = useState('')
  const [posting, setPosting] = useState(false)
  const [postError, setPostError] = useState<string | null>(null)

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    const bodyMarkdown = draft.trim()
    if (!bodyMarkdown || posting) return

    setPosting(true)
    setPostError(null)
    try {
      await window.minerva.scm.postComment({ repo: pr.repo, number: pr.number, bodyMarkdown })
      setDraft('')
      await reload()
    } catch (err: unknown) {
      setPostError(err instanceof Error ? err.message : String(err))
    } finally {
      setPosting(false)
    }
  }

  async function handleReply(threadId: string, bodyMarkdown: string): Promise<void> {
    await window.minerva.scm.postComment({
      repo: pr.repo,
      number: pr.number,
      bodyMarkdown,
      threadId,
    })
    await reload()
  }

  return (
    // Columna de lectura centrada (F16/T87): sin el `max-w`, en una ventana
    // completa de 1920px los comentarios se estiraban a líneas de 1200px+.
    // El padding se achica en el tier más angosto, donde cada px cuenta.
    <div
      className={`mx-auto flex h-full w-full max-w-[900px] flex-col gap-4 overflow-y-auto ${
        tier.w === 'sm' ? 'p-2' : 'p-4'
      }`}
    >
      <article className="rounded-md border border-border bg-panel p-3">
        <div className="mb-2 flex items-center gap-2 text-xs text-muted">
          <Avatar user={pr.author} size={18} />
          <span className="font-medium text-text">{pr.author.displayName ?? pr.author.login}</span>
          <span>abrió este PR</span>
        </div>
        <Markdown content={pr.bodyMarkdown} />
      </article>

      {error && (
        <p className="text-sm text-danger">No se pudieron cargar los comentarios: {error}</p>
      )}
      {!error && loading && <p className="text-sm text-muted">Cargando comentarios…</p>}

      {!error &&
        !loading &&
        (threads.length === 0 ? (
          <p className="text-sm text-muted">Todavía no hay comentarios.</p>
        ) : (
          threads.map((thread) => (
            <ThreadCard
              key={thread.id}
              thread={thread}
              onReply={handleReply}
              collapsedByDefault={thread.isResolved}
              onNavigateToLine={
                thread.isLineThread && thread.path && thread.line !== undefined
                  ? () => openLineThread(thread.path!, thread.line!, thread.id)
                  : undefined
              }
            />
          ))
        ))}

      <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-2">
        <label htmlFor="new-comment" className="text-xs font-medium text-muted">
          Comentario general
        </label>
        <textarea
          id="new-comment"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          disabled={posting}
          rows={3}
          placeholder="Escribe un comentario para este PR…"
          className="resize-y rounded-md border border-border bg-panel px-3 py-2 text-sm text-text placeholder:text-muted focus:border-accent"
        />
        {postError && <p className="text-sm text-danger">No se pudo publicar: {postError}</p>}
        <button
          type="submit"
          disabled={posting || draft.trim().length === 0}
          className="self-end rounded-md border border-border bg-accent/90 px-3 py-1.5 text-sm font-medium text-bg transition-colors duration-150 hover:bg-accent disabled:cursor-not-allowed disabled:bg-border/40 disabled:text-muted"
        >
          {posting ? 'Publicando…' : 'Comentar'}
        </button>
      </form>
    </div>
  )
}
