import { useEffect, useState } from 'react'
import { TriangleAlert } from 'lucide-react'
import { useElementWidth } from '../../hooks/use-element-width'
import { FILE_TREE_COLUMN_MIN_WIDTH } from '../../lib/layout'
import { truncatedFilesMessage } from '../../lib/scm-labels'
import { useAppStore } from '../../stores/app-store'
import type { CommentThread, DiffFile, RepoRef } from '../../../../shared/types'
import { FileTree } from './FileTree'
import { DiffView } from './DiffView'

interface FilesTabProps {
  repo: RepoRef
  number: number
  /** Files of the PR, fetched once in `CenterPane` (the Comments view needs them too). */
  files: DiffFile[]
  loading: boolean
  error: string | null
  /** The provider capped the file list (`PullRequestDetail.filesTruncated`). */
  filesTruncated: boolean
  /** True file count when the provider knows it. */
  changedFiles: number | null
  /** Hilos de comentarios del PR (T8), pedidos una sola vez en `CenterPane` y compartidos con `ConversationTab`. */
  threads: CommentThread[]
  reloadThreads: () => Promise<CommentThread[]>
}

/**
 * Tab "Archivos": árbol de archivos a la izquierda + diff estilo GitKraken
 * (split/inline, syntax highlighting) a la derecha para el archivo
 * seleccionado. El estado de selección/vista vive en `app-store` (T7).
 *
 * Responsive (F16/T85): el árbol es columna mientras ESTE panel mida al menos
 * `FILE_TREE_COLUMN_MIN_WIDTH`; por debajo pasa a drawer interno (botón "N
 * archivos" en la toolbar del diff) y el diff se queda con todo el ancho. La
 * medida es la del contenedor REAL, no la de la ventana: el panel didáctico se
 * arrastra a mano, así que la misma ventana puede dejar este tab con anchos
 * muy distintos. Medición previa a F16: a 960x540 el diff quedaba en 40px.
 */
export function FilesTab({
  repo,
  number,
  files,
  loading,
  error,
  filesTruncated,
  changedFiles,
  threads,
  reloadThreads,
}: FilesTabProps): React.JSX.Element {
  const { ref, width } = useElementWidth<HTMLDivElement>()
  const [treeOpen, setTreeOpen] = useState(false)

  const selectedFilePath = useAppStore((s) => s.selectedFilePath)
  const setSelectedFilePath = useAppStore((s) => s.setSelectedFilePath)
  const fileTreeMode = useAppStore((s) => s.fileTreeMode)
  const setFileTreeMode = useAppStore((s) => s.setFileTreeMode)
  const diffViewMode = useAppStore((s) => s.diffViewMode)
  const setDiffViewMode = useAppStore((s) => s.setDiffViewMode)
  const wordWrap = useAppStore((s) => s.wordWrap)
  const toggleWordWrap = useAppStore((s) => s.toggleWordWrap)

  // Selecciona el primer archivo automáticamente cuando cargan los archivos
  // del PR (o si el seleccionado ya no existe en la lista actual).
  useEffect(() => {
    if (files.length === 0) return
    const stillExists = selectedFilePath && files.some((f) => f.path === selectedFilePath)
    if (!stillExists) setSelectedFilePath(files[0].path)
  }, [files, selectedFilePath, setSelectedFilePath])

  // `width === null` = todavía sin medir: se asume el layout ancho para no
  // parpadear al drawer durante el primer frame.
  const treeIsDrawer = width !== null && width < FILE_TREE_COLUMN_MIN_WIDTH

  if (error) {
    return <p className="p-4 text-sm text-danger">Could not load the files: {error}</p>
  }

  if (loading) {
    return <p className="p-4 text-sm text-muted">Loading files…</p>
  }

  if (files.length === 0) {
    return <p className="p-4 text-sm text-muted">This pull request has no changed files.</p>
  }

  const selectedFile = files.find((f) => f.path === selectedFilePath) ?? files[0]

  function handleSelectFile(path: string): void {
    setSelectedFilePath(path)
    setTreeOpen(false)
  }

  const tree = (
    <FileTree
      files={files}
      mode={fileTreeMode}
      onModeChange={setFileTreeMode}
      selectedPath={selectedFile.path}
      onSelectFile={handleSelectFile}
      overlay={treeIsDrawer}
    />
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      {filesTruncated && (
        <p
          role="status"
          data-testid="files-truncated-banner"
          className="flex shrink-0 items-start gap-2 border-b border-border bg-warning/10 px-3 py-1.5 text-xs text-warning"
        >
          <TriangleAlert size={13} className="mt-0.5 shrink-0" />
          {truncatedFilesMessage(files.length, changedFiles, repo.provider)}
        </p>
      )}
      <div ref={ref} className="relative flex min-h-0 flex-1">
        {treeIsDrawer
          ? treeOpen && (
              <>
                <div
                  className="absolute inset-0 z-30 bg-black/50"
                  onClick={() => setTreeOpen(false)}
                  aria-hidden
                />
                {tree}
              </>
            )
          : tree}
        <DiffView
          key={selectedFile.path}
          file={selectedFile}
          mode={diffViewMode}
          onModeChange={setDiffViewMode}
          wordWrap={wordWrap}
          onToggleWordWrap={toggleWordWrap}
          repo={repo}
          number={number}
          threads={threads}
          reloadThreads={reloadThreads}
          fileTreeToggle={
            treeIsDrawer
              ? {
                  open: treeOpen,
                  count: files.length,
                  onToggle: () => setTreeOpen((open) => !open),
                }
              : undefined
          }
        />
      </div>
    </div>
  )
}
