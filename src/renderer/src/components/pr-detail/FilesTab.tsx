import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { TriangleAlert } from 'lucide-react'
import { useElementWidth } from '../../hooks/use-element-width'
import { useWalkthrough } from '../../hooks/use-walkthrough'
import { FILE_TREE_COLUMN_MIN_WIDTH } from '../../lib/layout'
import { truncatedFilesMessage } from '../../lib/scm-labels'
import {
  findFlatLayer,
  flattenLayers,
  layerFocus,
  resolveLayerFiles,
  stepLayer,
  type LayerRef,
  layerVerdictKey,
} from '../../lib/walkthrough'
import { useAppStore, type LayerVerdict } from '../../stores/app-store'
import { prKey } from '../../../../shared/scm'
import type { CommentThread, DiffFile, RepoRef } from '../../../../shared/types'
import { FileTree } from './FileTree'
import { DiffView } from './DiffView'
import { LayerNavigator } from './LayerNavigator'
import { LayerContextBar } from './LayerContextBar'
import { WalkthroughFocusBar } from './WalkthroughFocusBar'

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

/** `true` when a key press belongs to a text field (no single-key shortcuts there). */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

/**
 * Tab "Archivos": árbol de archivos a la izquierda + diff estilo GitKraken
 * (split/inline, syntax highlighting) a la derecha para el archivo
 * seleccionado. El estado de selección/vista vive en `app-store` (T7).
 *
 * Layers mode (guided walkthrough): the left column becomes the AI's
 * cohorts/layers (`LayerNavigator`), picking a layer selects its first file,
 * the lines it covers get a marker in the diff and `LayerContextBar` shows
 * its summary above. `J`/`K` move to the next/previous layer. The walkthrough
 * comes from the same didactic analysis the right panel shows
 * (`useWalkthrough`), so following it costs no extra LLM call.
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
  const { t } = useTranslation()
  const { ref, width } = useElementWidth<HTMLDivElement>()
  const [treeOpen, setTreeOpen] = useState(false)
  // Bumped on every layer/file pick so the diff scrolls to the range again.
  const [focusToken, setFocusToken] = useState(0)

  const selectedFilePath = useAppStore((s) => s.selectedFilePath)
  const setSelectedFilePath = useAppStore((s) => s.setSelectedFilePath)
  const fileTreeMode = useAppStore((s) => s.fileTreeMode)
  const setFileTreeMode = useAppStore((s) => s.setFileTreeMode)
  const diffViewMode = useAppStore((s) => s.diffViewMode)
  const setDiffViewMode = useAppStore((s) => s.setDiffViewMode)
  const wordWrap = useAppStore((s) => s.wordWrap)
  const toggleWordWrap = useAppStore((s) => s.toggleWordWrap)
  const activeLayer = useAppStore((s) => s.activeLayer)
  const setActiveLayer = useAppStore((s) => s.setActiveLayer)
  const focusMode = useAppStore((s) => s.walkthroughFocus)
  const closeFocus = useAppStore((s) => s.closeWalkthroughFocus)
  const setCenterTab = useAppStore((s) => s.setCenterTab)
  const reviewKey = prKey(repo, number)
  const verdicts = useAppStore((s) => s.layerVerdicts[reviewKey])
  const setLayerVerdict = useAppStore((s) => s.setLayerVerdict)

  const walkthrough = useWalkthrough(repo, number)
  const layersMode = fileTreeMode === 'layers'
  const flat = useMemo(() => flattenLayers(walkthrough.cohorts ?? []), [walkthrough.cohorts])
  const activeEntry = layersMode ? findFlatLayer(flat, activeLayer) : null
  const activeFiles = useMemo(
    () => (activeEntry ? resolveLayerFiles(activeEntry.layer, files) : null),
    [activeEntry, files],
  )

  // Selecciona el primer archivo automáticamente cuando cargan los archivos
  // del PR (o si el seleccionado ya no existe en la lista actual). A jump
  // from the chat to a removed line of a renamed file names its OLD path:
  // that is the renamed file.
  useEffect(() => {
    if (files.length === 0) return
    const stillExists = selectedFilePath && files.some((f) => f.path === selectedFilePath)
    if (stillExists) return
    const renamed = selectedFilePath
      ? files.find((f) => f.previousPath === selectedFilePath)
      : undefined
    setSelectedFilePath((renamed ?? files[0]).path)
  }, [files, selectedFilePath, setSelectedFilePath])

  function selectLayer(layerRef: LayerRef | null): void {
    const entry = findFlatLayer(flat, layerRef)
    const first = entry ? resolveLayerFiles(entry.layer, files).known[0]?.path : undefined
    setActiveLayer(entry ? entry.ref : null, first)
    setFocusToken((n) => n + 1)
    setTreeOpen(false)
  }

  // Entering layers mode with a walkthrough but no pick yet: start at layer 1.
  useEffect(() => {
    if (!layersMode || flat.length === 0 || activeLayer !== null || files.length === 0) return
    const entry = flat[0]
    setActiveLayer(entry.ref, resolveLayerFiles(entry.layer, files).known[0]?.path)
  }, [layersMode, flat, activeLayer, files, setActiveLayer])

  // J / K: next / previous layer while following the walkthrough. Not while
  // the home dashboard is on screen (the review stays mounted, hidden).
  useEffect(() => {
    if (!layersMode || flat.length === 0) return
    function onKeyDown(event: KeyboardEvent): void {
      if (useAppStore.getState().mainView !== 'review') return
      if (event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) return
      const key = event.key.toLowerCase()
      if (key !== 'j' && key !== 'k') return
      const next = stepLayer(flat, activeLayer, key === 'j' ? 1 : -1)
      if (!next) return
      event.preventDefault()
      selectLayer(next)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `selectLayer` reads the same `flat`/`files` these deps track.
  }, [layersMode, flat, activeLayer, files])

  // Full-screen walkthrough keys: Esc leaves it, 1 / 2 / 3 judge the layer on
  // screen (again = clear). Not while typing, and not when a dialog (the
  // palette, a card's own Esc) already claimed the key.
  useEffect(() => {
    if (!focusMode) return
    function onKeyDown(event: KeyboardEvent): void {
      if (event.defaultPrevented || isTypingTarget(event.target)) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const state = useAppStore.getState()
      if (state.settingsOpen || state.commandPaletteOpen || state.mainView !== 'review') return
      if (event.key === 'Escape') {
        event.preventDefault()
        closeFocus()
        return
      }
      const verdict = VERDICT_KEYS[event.key]
      if (!verdict || !state.activeLayer) return
      event.preventDefault()
      const layerKey = layerVerdictKey(state.activeLayer)
      const current = state.layerVerdicts[reviewKey]?.[layerKey]
      setLayerVerdict(reviewKey, layerKey, current === verdict ? null : verdict)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [focusMode, closeFocus, reviewKey, setLayerVerdict])

  // `width === null` = todavía sin medir: se asume el layout ancho para no
  // parpadear al drawer durante el primer frame.
  const treeIsDrawer = width !== null && width < FILE_TREE_COLUMN_MIN_WIDTH

  if (error) {
    return <p className="p-4 text-sm text-danger">{t('prDetail.files.loadError', { error })}</p>
  }

  if (loading) {
    return <p className="p-4 text-sm text-muted">{t('prDetail.files.loading')}</p>
  }

  if (files.length === 0) {
    return <p className="p-4 text-sm text-muted">{t('prDetail.files.empty')}</p>
  }

  const selectedFile =
    files.find((f) => f.path === selectedFilePath) ??
    files.find((f) => f.previousPath === selectedFilePath) ??
    files[0]

  function handleSelectFile(path: string): void {
    setSelectedFilePath(path)
    setTreeOpen(false)
  }

  function handleSelectLayerFile(path: string): void {
    setSelectedFilePath(path)
    setFocusToken((n) => n + 1)
  }

  const selectedRef = activeFiles?.known.find((f) => f.path === selectedFile.path)
  const focus = selectedRef ? layerFocus(selectedRef, selectedFile) : null
  const previous = activeEntry ? stepLayer(flat, activeEntry.ref, -1) : null
  const next = activeEntry ? stepLayer(flat, activeEntry.ref, 1) : null

  const tree = (
    <FileTree
      files={files}
      mode={fileTreeMode}
      onModeChange={setFileTreeMode}
      selectedPath={selectedFile.path}
      onSelectFile={handleSelectFile}
      overlay={treeIsDrawer}
      layers={
        <LayerNavigator
          cohorts={walkthrough.cohorts}
          status={walkthrough.status}
          error={walkthrough.error}
          files={files}
          threads={threads}
          activeLayer={activeEntry?.ref ?? null}
          selectedPath={selectedFile.path}
          onSelectLayer={selectLayer}
          onSelectUnassignedFile={(path) => {
            setActiveLayer(null, path)
            setTreeOpen(false)
          }}
          onAnalyze={walkthrough.analyze}
          verdicts={verdicts}
        />
      }
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
          {truncatedFilesMessage(files.length, changedFiles, repo.provider, t)}
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
          layerFocus={focus ? { ...focus, token: focusToken } : undefined}
          banner={
            activeEntry && activeFiles ? (
              <LayerContextBar
                entry={activeEntry}
                total={flat.length}
                files={activeFiles.known.flatMap((layerRef) => {
                  const file = files.find((f) => f.path === layerRef.path)
                  return file ? [{ ref: layerRef, file }] : []
                })}
                unknownPaths={activeFiles.unknownPaths}
                selectedPath={selectedFile.path}
                onSelectFile={handleSelectLayerFile}
                onPrevious={previous ? () => selectLayer(previous) : null}
                onNext={next ? () => selectLayer(next) : null}
              />
            ) : null
          }
        />
      </div>
      {focusMode && (
        <WalkthroughFocusBar
          verdict={activeEntry ? (verdicts?.[layerVerdictKey(activeEntry.ref)] ?? null) : null}
          onVerdict={
            activeEntry
              ? (verdict) => setLayerVerdict(reviewKey, layerVerdictKey(activeEntry.ref), verdict)
              : null
          }
          onPrevious={previous ? () => selectLayer(previous) : null}
          onNext={next ? () => selectLayer(next) : null}
          judged={flat.filter((entry) => verdicts?.[layerVerdictKey(entry.ref)]).length}
          total={flat.length}
          onFinish={() => {
            closeFocus()
            setCenterTab('conversation')
          }}
        />
      )}
    </div>
  )
}

/** Keys of the full-screen walkthrough's verdict buttons. */
const VERDICT_KEYS: Record<string, LayerVerdict | undefined> = {
  '1': 'good',
  '2': 'changes',
  '3': 'question',
}
