import { useState } from 'react'
import { Check, Link } from 'lucide-react'
import type { CommentThread } from '../../../../shared/types'
import { Avatar } from '../ui/Avatar'
import { Badge } from '../ui/Badge'
import { Markdown } from '../ui/Markdown'
import { threadStatusBadge } from '../../lib/scm-labels'

interface ThreadCardProps {
  thread: CommentThread
  onReply: (threadId: string, bodyMarkdown: string) => Promise<void>
  /** Colapsado por defecto; se usa para hilos resueltos en `ConversationTab`. */
  collapsedByDefault?: boolean
  /** Al pasarlo, `path:line` se pinta como botón clickeable (navegar a Archivos). */
  onNavigateToLine?: () => void
  /** Contenido extra a la derecha del header (p. ej. botón de cerrar en el diff). */
  extraHeaderContent?: React.ReactNode
}

function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/**
 * Card de un hilo de comentarios: header colapsable (chip `path:line` para
 * hilos de línea, badge "Resuelto"), lista de comentarios (avatar/login/fecha
 * corta + body renderizado como Markdown, igual que en GitHub) y un
 * formulario de respuesta. Se reutiliza
 * en `ConversationTab` (hilos generales y de línea) y, envuelto por
 * `InlineThreadCard`, bajo la fila del diff que originó el hilo.
 */
export function ThreadCard({
  thread,
  onReply,
  collapsedByDefault = false,
  onNavigateToLine,
  extraHeaderContent,
}: ThreadCardProps): React.JSX.Element {
  const [collapsed, setCollapsed] = useState(collapsedByDefault)
  const statusBadge = threadStatusBadge(thread.status)
  const [draft, setDraft] = useState('')
  const [posting, setPosting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copiedCommentId, setCopiedCommentId] = useState<string | null>(null)

  async function handleCopyUrl(commentId: string, htmlUrl: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(htmlUrl)
      setCopiedCommentId(commentId)
      setTimeout(() => setCopiedCommentId((current) => (current === commentId ? null : current)), 1500)
    } catch {
      // Sin permiso de portapapeles o API no disponible en este contexto:
      // no hay un fallback razonable, se ignora silenciosamente el clic.
    }
  }

  async function handleReply(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    const bodyMarkdown = draft.trim()
    if (!bodyMarkdown || posting) return

    setPosting(true)
    setError(null)
    try {
      await onReply(thread.id, bodyMarkdown)
      setDraft('')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPosting(false)
    }
  }

  const positionLabel =
    thread.isLineThread && thread.path
      ? `${thread.path}${thread.line ? `:${thread.line}` : ''}`
      : null

  return (
    <div className="rounded-md border border-border bg-panel">
      <div className="flex items-center justify-between gap-2 px-3 py-1.5">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="flex min-w-0 items-center gap-2 text-xs text-muted"
        >
          <span className="shrink-0">{collapsed ? '▸' : '▾'}</span>
          {positionLabel ? (
            onNavigateToLine ? (
              <span
                role="link"
                tabIndex={0}
                onClick={(event) => {
                  event.stopPropagation()
                  onNavigateToLine()
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.stopPropagation()
                    onNavigateToLine()
                  }
                }}
                className="truncate font-mono text-accent underline decoration-dotted hover:text-text"
              >
                {positionLabel}
              </span>
            ) : (
              <span className="truncate font-mono">{positionLabel}</span>
            )
          ) : (
            <span>Comentario general</span>
          )}
          <span className="shrink-0">
            · {thread.comments.length} {thread.comments.length === 1 ? 'comentario' : 'comentarios'}
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-2">
          {statusBadge && (
            <Badge tone={statusBadge.tone}>
              <span data-thread-status={thread.status}>{statusBadge.label}</span>
            </Badge>
          )}
          {thread.isOutdated && <Badge tone="neutral">Outdated</Badge>}
          {extraHeaderContent}
        </div>
      </div>

      {!collapsed && (
        <>
          <ul className="divide-y divide-border border-t border-border">
            {thread.comments.map((comment) => (
              <li key={comment.id} className="p-3">
                <div className="mb-1 flex items-center gap-2 text-xs text-muted">
                  <Avatar user={comment.author} size={16} />
                  <span className="font-medium text-text">{comment.author.login}</span>
                  <span>{formatShortDate(comment.createdAt)}</span>
                  {comment.htmlUrl && (
                    <button
                      type="button"
                      onClick={() => void handleCopyUrl(comment.id, comment.htmlUrl!)}
                      title="Copiar URL del comentario en GitHub"
                      aria-label="Copiar URL del comentario en GitHub"
                      className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-muted transition-colors hover:bg-border/60 hover:text-text"
                    >
                      {copiedCommentId === comment.id ? (
                        <>
                          <Check size={12} className="text-success" />
                          Copiado
                        </>
                      ) : (
                        <Link size={12} />
                      )}
                    </button>
                  )}
                </div>
                <Markdown content={comment.bodyMarkdown} />
              </li>
            ))}
          </ul>

          <form
            onSubmit={(event) => void handleReply(event)}
            className="flex flex-col gap-2 border-t border-border p-3"
          >
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              disabled={posting}
              rows={2}
              placeholder="Responder…"
              className="resize-y rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-text placeholder:text-muted focus:border-accent"
            />
            {error && <p className="text-xs text-danger">No se pudo publicar: {error}</p>}
            <button
              type="submit"
              disabled={posting || draft.trim().length === 0}
              className="self-end rounded-md border border-border bg-accent/90 px-2.5 py-1 text-xs font-medium text-bg transition-colors duration-150 hover:bg-accent disabled:cursor-not-allowed disabled:bg-border/40 disabled:text-muted"
            >
              {posting ? 'Publicando…' : 'Responder'}
            </button>
          </form>
        </>
      )}
    </div>
  )
}
