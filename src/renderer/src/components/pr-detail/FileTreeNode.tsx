import { ChevronDown, ChevronRight } from 'lucide-react'
import type { FileTreeNode as FileTreeNodeModel } from '../../lib/file-tree'
import { FileRow } from '../ui/FileRow'
import { FileStatusIcon } from './FileStatusIcon'

interface FileTreeNodeProps {
  node: FileTreeNodeModel
  depth: number
  selectedPath: string | null
  collapsedFolders: ReadonlySet<string>
  onSelectFile: (path: string) => void
  onToggleFolder: (path: string) => void
}

/** Un nodo (carpeta o archivo) del árbol de archivos, renderizado recursivamente. */
export function FileTreeNode({
  node,
  depth,
  selectedPath,
  collapsedFolders,
  onSelectFile,
  onToggleFolder,
}: FileTreeNodeProps): React.JSX.Element {
  const paddingLeft = 8 + depth * 14

  if (node.type === 'folder') {
    const collapsed = collapsedFolders.has(node.path)
    return (
      <li>
        <button
          type="button"
          onClick={() => onToggleFolder(node.path)}
          aria-expanded={!collapsed}
          style={{ paddingLeft }}
          className="flex w-full items-center gap-1 py-1 pr-2 text-left text-sm text-muted hover:text-text"
        >
          {collapsed ? (
            <ChevronRight size={13} className="shrink-0" />
          ) : (
            <ChevronDown size={13} className="shrink-0" />
          )}
          <span className="truncate">{node.name}</span>
        </button>
        {!collapsed && (
          <ul>
            {node.children.map((child) => (
              <FileTreeNode
                key={child.path}
                node={child}
                depth={depth + 1}
                selectedPath={selectedPath}
                collapsedFolders={collapsedFolders}
                onSelectFile={onSelectFile}
                onToggleFolder={onToggleFolder}
              />
            ))}
          </ul>
        )}
      </li>
    )
  }

  return (
    <li>
      <FileRow
        icon={<FileStatusIcon status={node.file.status} />}
        name={node.file.path.split('/').pop() ?? node.file.path}
        path={node.file.path}
        additions={node.file.additions}
        deletions={node.file.deletions}
        selected={node.path === selectedPath}
        onSelect={() => onSelectFile(node.path)}
        indent={paddingLeft}
      />
    </li>
  )
}
