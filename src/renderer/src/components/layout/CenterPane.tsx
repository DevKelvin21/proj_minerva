import type { ReactNode } from 'react'
import { useAppStore } from '../../stores/app-store'
import { usePullRequestDetail } from '../../hooks/use-pull-request-detail'
import { useCommentThreads } from '../../hooks/use-comment-threads'
import { PrHeader } from '../pr-detail/PrHeader'
import { ConversationTab } from '../pr-detail/ConversationTab'
import { FilesTab } from '../pr-detail/FilesTab'
import { EmptyState } from '../ui/EmptyState'
import type { RepoRef } from '../../../../shared/scm'

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`border-b-2 px-3 py-2 text-sm font-medium transition-colors duration-150 ${
        active ? 'border-accent text-text' : 'border-transparent text-muted hover:text-text'
      }`}
    >
      {children}
    </button>
  )
}

/** Placeholder for the hooks while nothing is selected (their result is ignored). */
const NO_REPO: RepoRef = { provider: 'github', owner: '', name: '', fullName: '' }

export function CenterPane(): React.JSX.Element {
  const selectedPr = useAppStore((s) => s.selectedPr)
  const centerTab = useAppStore((s) => s.centerTab)
  const setCenterTab = useAppStore((s) => s.setCenterTab)

  // `usePullRequestDetail` necesita un repo/number válidos incluso cuando no
  // hay selección: se le pasa un placeholder y se ignora su resultado (ver
  // guard de `!selectedPr` más abajo) para no romper las reglas de hooks.
  const { detail, loading, error } = usePullRequestDetail(
    selectedPr?.repo ?? NO_REPO,
    selectedPr?.number ?? 0,
  )

  // Hilos de comentarios (generales y por línea) del PR seleccionado: se
  // piden una única vez acá y se pasan como props a ConversationTab y
  // FilesTab, que los necesitan por igual (evita pedirlos dos veces).
  const {
    threads,
    loading: threadsLoading,
    error: threadsError,
    reload: reloadThreads,
  } = useCommentThreads(selectedPr?.repo ?? NO_REPO, selectedPr?.number ?? 0)

  if (!selectedPr) {
    return (
      <section className="flex flex-1 flex-col bg-bg">
        <EmptyState
          title="Elige un Pull Request"
          hint="Selecciona un PR de la lista de la izquierda para ver su conversación y sus archivos."
        />
      </section>
    )
  }

  if (error) {
    return (
      <section className="flex flex-1 flex-col bg-bg">
        <EmptyState title="No se pudo cargar el PR" hint={error} />
      </section>
    )
  }

  if (loading || !detail) {
    return (
      <section className="flex flex-1 flex-col bg-bg">
        <EmptyState
          title="Cargando PR…"
          hint={`${selectedPr.repo.fullName}#${selectedPr.number}`}
        />
      </section>
    )
  }

  return (
    <section className="flex flex-1 flex-col overflow-hidden bg-bg">
      <PrHeader pr={detail} />
      <nav className="flex shrink-0 gap-1 border-b border-border px-3">
        <TabButton
          active={centerTab === 'conversation'}
          onClick={() => setCenterTab('conversation')}
        >
          Conversación
        </TabButton>
        <TabButton active={centerTab === 'files'} onClick={() => setCenterTab('files')}>
          {detail.changedFiles === null ? 'Archivos' : `Archivos (${detail.changedFiles})`}
        </TabButton>
      </nav>
      <div className="flex-1 overflow-hidden">
        {centerTab === 'conversation' ? (
          <ConversationTab
            pr={detail}
            threads={threads}
            loading={threadsLoading}
            error={threadsError}
            reload={reloadThreads}
          />
        ) : (
          <FilesTab
            repo={detail.repo}
            number={detail.number}
            threads={threads}
            reloadThreads={reloadThreads}
          />
        )}
      </div>
    </section>
  )
}
