import { useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { FolderTree, Layers, List } from 'lucide-react'
import type { DiffFile } from '../../../../shared/types'
import type { FileTreeMode } from '../../stores/app-store'
import { buildFileTree } from '../../lib/file-tree'
import { IconButton } from '../ui/IconButton'
import { FileRow } from '../ui/FileRow'
import { FileStatusIcon } from './FileStatusIcon'
import { FileTreeNode } from './FileTreeNode'

interface FileTreeProps {
  files: DiffFile[]
  mode: FileTreeMode
  onModeChange: (mode: FileTreeMode) => void
  selectedPath: string | null
  onSelectFile: (path: string) => void
  /** Drawer sobre el diff en vez de columna (F16/T85, panel angosto). */
  overlay?: boolean
  /** Body of the `layers` mode (the AI walkthrough navigator), rendered instead of the tree/list. */
  layers: ReactNode
}

/**
 * Panel izquierdo del tab "Archivos": toggle tree/list + árbol o lista plana.
 * Con `overlay` se pinta como drawer flotante sobre el diff — es lo que hace
 * `FilesTab` cuando el tab no da el ancho para tener las dos cosas a la vez.
 */
export function FileTree({
  files,
  mode,
  onModeChange,
  selectedPath,
  onSelectFile,
  overlay = false,
  layers,
}: FileTreeProps): React.JSX.Element {
  const { t } = useTranslation()
  const [collapsedFolders, setCollapsedFolders] = useState<ReadonlySet<string>>(new Set())

  const tree = useMemo(() => buildFileTree(files), [files])
  const sortedFlatFiles = useMemo(
    () => [...files].sort((a, b) => a.path.localeCompare(b.path)),
    [files],
  )

  function toggleFolder(path: string): void {
    setCollapsedFolders((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  return (
    <aside
      className={
        overlay
          ? 'absolute inset-y-0 left-0 z-40 flex w-[260px] max-w-[85%] flex-col border-r border-border bg-panel shadow-2xl'
          : 'flex w-[260px] shrink-0 flex-col border-r border-border'
      }
    >
      <div className="flex shrink-0 items-center justify-between gap-1 border-b border-border px-2 py-1.5">
        <span className="px-1 text-xs font-medium text-muted">
          {t('prDetail.fileTree.fileCount', { count: files.length })}
        </span>
        <div className="flex gap-0.5">
          <IconButton
            icon={<FolderTree size={15} />}
            label={t('prDetail.fileTree.treeView')}
            active={mode === 'tree'}
            onClick={() => onModeChange('tree')}
          />
          <IconButton
            icon={<List size={15} />}
            label={t('prDetail.fileTree.listView')}
            active={mode === 'list'}
            onClick={() => onModeChange('list')}
          />
          <IconButton
            icon={<Layers size={15} />}
            label={t('prDetail.fileTree.layersView')}
            active={mode === 'layers'}
            onClick={() => onModeChange('layers')}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {mode === 'layers' ? (
          layers
        ) : mode === 'tree' ? (
          <ul>
            {tree.map((node) => (
              <FileTreeNode
                key={node.path}
                node={node}
                depth={0}
                selectedPath={selectedPath}
                collapsedFolders={collapsedFolders}
                onSelectFile={onSelectFile}
                onToggleFolder={toggleFolder}
              />
            ))}
          </ul>
        ) : (
          <ul>
            {sortedFlatFiles.map((file) => {
              return (
                <li key={file.path}>
                  <FileRow
                    icon={<FileStatusIcon status={file.status} />}
                    name={file.path}
                    path={file.path}
                    additions={file.additions}
                    deletions={file.deletions}
                    selected={file.path === selectedPath}
                    onSelect={() => onSelectFile(file.path)}
                  />
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </aside>
  )
}
