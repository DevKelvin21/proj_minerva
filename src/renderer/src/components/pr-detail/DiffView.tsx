import { useEffect, useMemo } from 'react'
import type { CommentThread, DiffFile, RepoRef } from '../../../../shared/types'
import type { DiffViewMode } from '../../stores/app-store'
import { useAppStore } from '../../stores/app-store'
import { parsePatch } from '../../lib/diff-parser'
import { indexLineThreads, type LineSide } from '../../lib/line-threads'
import { useElementWidth } from '../../hooks/use-element-width'
import { SPLIT_DIFF_MIN_WIDTH } from '../../lib/layout'
import { noPatchMessage } from '../../lib/scm-labels'
import { useLineHighlights } from '../../hooks/use-line-highlights'
import { DiffToolbar } from './DiffToolbar'
import { SplitDiff } from './SplitDiff'
import { InlineDiff } from './InlineDiff'

interface DiffViewProps {
  file: DiffFile
  mode: DiffViewMode
  onModeChange: (mode: DiffViewMode) => void
  wordWrap: boolean
  onToggleWordWrap: () => void
  repo: RepoRef
  number: number
  /** Hilos del PR completo; se filtran acá a los que son de línea y de este archivo. */
  threads: CommentThread[]
  reloadThreads: () => Promise<CommentThread[]>
  /** Presente solo cuando el árbol de archivos es drawer (F16/T85): botón "N archivos" en la toolbar. */
  fileTreeToggle?: { open: boolean; count: number; onToggle: () => void }
}

/**
 * Panel principal: toolbar + diff (split o inline) del archivo seleccionado.
 *
 * F16/T86 — `effectiveMode`: por debajo de `SPLIT_DIFF_MIN_WIDTH` (560px de
 * panel REAL) la vista split deja de ser legible (dos columnas de ~190px con
 * los gutters puestos), así que se renderiza inline aunque la preferencia
 * guardada sea split. La preferencia NO se pisa en el store: al ensanchar el
 * panel (cerrar el didáctico, agrandar la ventana) el split vuelve solo. La
 * toolbar deshabilita el botón split y explica por qué en el tooltip — sin eso,
 * el usuario clickearía split y "no pasaría nada".
 */
export function DiffView({
  file,
  mode,
  onModeChange,
  wordWrap,
  onToggleWordWrap,
  repo,
  number,
  threads,
  reloadThreads,
  fileTreeToggle,
}: DiffViewProps): React.JSX.Element {
  const { ref, width } = useElementWidth<HTMLElement>()
  const splitTooNarrow = width !== null && width < SPLIT_DIFF_MIN_WIDTH
  const effectiveMode: DiffViewMode = mode === 'split' && splitTooNarrow ? 'inline' : mode
  const hunks = useMemo(() => parsePatch(file.patch ?? ''), [file.patch])
  const { getTokens } = useLineHighlights(file.path, file.patch)
  const threadsByPosition = useMemo(
    () => indexLineThreads(threads, file.path),
    [threads, file.path],
  )

  const expandedThreadId = useAppStore((s) => s.expandedThreadId)
  const setExpandedThreadId = useAppStore((s) => s.setExpandedThreadId)
  const pendingThreadFocus = useAppStore((s) => s.pendingThreadFocus)
  const clearPendingThreadFocus = useAppStore((s) => s.clearPendingThreadFocus)

  // Al llegar acá navegando desde un chip `path:line` de ConversationTab, el
  // hilo ya quedó expandido (`openLineThread` setea `expandedThreadId`); acá
  // solo hace falta el scroll hasta la card una vez que el diff renderizó.
  useEffect(() => {
    if (!pendingThreadFocus || pendingThreadFocus.path !== file.path) return
    const el = document.getElementById(`thread-${pendingThreadFocus.threadId}`)
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    clearPendingThreadFocus()
  }, [pendingThreadFocus, file.path, clearPendingThreadFocus])

  async function handleReply(threadId: string, bodyMarkdown: string): Promise<void> {
    await window.minerva.scm.postComment({ repo, number, bodyMarkdown, threadId })
    await reloadThreads()
  }

  async function handleCreateThread(
    line: number,
    side: LineSide,
    bodyMarkdown: string,
  ): Promise<void> {
    const comment = await window.minerva.scm.postComment({
      repo,
      number,
      bodyMarkdown,
      path: file.path,
      line,
      side,
    })
    const refreshed = await reloadThreads()
    const created = refreshed.find(
      (t) =>
        t.isLineThread &&
        t.path === file.path &&
        t.line === line &&
        t.comments.some((c) => c.id === comment.id),
    )
    if (created) setExpandedThreadId(created.id)
  }

  return (
    <section ref={ref} className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <DiffToolbar
        file={file}
        mode={effectiveMode}
        onModeChange={onModeChange}
        wordWrap={wordWrap}
        onToggleWordWrap={onToggleWordWrap}
        splitTooNarrow={splitTooNarrow}
        fileTreeToggle={fileTreeToggle}
        compact={width !== null && width < 520}
      />

      <div className="flex-1 overflow-auto">
        {file.isBinary || !file.patch || hunks.length === 0 ? (
          <p className="p-4 text-sm text-muted" data-patch-omitted={file.patchOmitted}>
            {file.isBinary ? 'Sin vista previa disponible.' : noPatchMessage(file.patchOmitted)}
          </p>
        ) : effectiveMode === 'split' ? (
          <SplitDiff
            hunks={hunks}
            wordWrap={wordWrap}
            getTokens={getTokens}
            threadsByPosition={threadsByPosition}
            expandedThreadId={expandedThreadId}
            onToggleExpand={(threadId) =>
              setExpandedThreadId(expandedThreadId === threadId ? null : threadId)
            }
            onReply={handleReply}
            onCreateThread={handleCreateThread}
          />
        ) : (
          <InlineDiff
            hunks={hunks}
            wordWrap={wordWrap}
            getTokens={getTokens}
            threadsByPosition={threadsByPosition}
            expandedThreadId={expandedThreadId}
            onToggleExpand={(threadId) =>
              setExpandedThreadId(expandedThreadId === threadId ? null : threadId)
            }
            onReply={handleReply}
            onCreateThread={handleCreateThread}
          />
        )}
      </div>
    </section>
  )
}
