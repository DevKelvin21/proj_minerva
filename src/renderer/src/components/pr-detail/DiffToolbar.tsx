import { AlignJustify, Columns2, Files, WrapText } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { DiffFile } from '../../../../shared/types'
import type { DiffViewMode } from '../../stores/app-store'
import { SPLIT_DIFF_MIN_WIDTH } from '../../lib/layout'
import { IconButton } from '../ui/IconButton'

interface DiffToolbarProps {
  file: DiffFile
  /** Modo EFECTIVO (ya resuelto por `DiffView`), no la preferencia cruda del store. */
  mode: DiffViewMode
  onModeChange: (mode: DiffViewMode) => void
  wordWrap: boolean
  onToggleWordWrap: () => void
  /** El panel no da el ancho mínimo para split (F16/T86): el botón queda deshabilitado y explicado. */
  splitTooNarrow?: boolean
  /** Abre/cierra el árbol de archivos cuando es drawer (F16/T85). */
  fileTreeToggle?: { open: boolean; count: number; onToggle: () => void }
  /** Panel angosto: solo el nombre del archivo, sin la ruta completa. */
  compact?: boolean
}

/** Barra superior del panel de diff: path del archivo, toggles de vista y conteo +/-. */
export function DiffToolbar({
  file,
  mode,
  onModeChange,
  wordWrap,
  onToggleWordWrap,
  splitTooNarrow = false,
  fileTreeToggle,
  compact = false,
}: DiffToolbarProps): React.JSX.Element {
  const { t } = useTranslation()
  // Compacto (F16/T86): el path completo es lo primero que sobra cuando la
  // toolbar no entra; el nombre del archivo alcanza para saber dónde estás y la
  // ruta entera sigue disponible en el `title`.
  const basename = file.path.slice(file.path.lastIndexOf('/') + 1)

  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5">
      {fileTreeToggle && (
        <button
          type="button"
          onClick={fileTreeToggle.onToggle}
          aria-expanded={fileTreeToggle.open}
          title={t('prDetail.toolbar.showFiles')}
          aria-label={t('prDetail.toolbar.showFilesCount', { count: fileTreeToggle.count })}
          className={`flex shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 text-xs transition-colors duration-150 ${
            fileTreeToggle.open
              ? 'border-accent/50 bg-accent/10 text-accent'
              : 'border-border text-muted hover:border-accent/40 hover:text-text'
          }`}
        >
          <Files size={13} />
          {fileTreeToggle.count}
        </button>
      )}

      <span className="min-w-0 flex-1 truncate font-mono text-xs text-text" title={file.path}>
        {compact ? (
          basename
        ) : file.status === 'renamed' && file.previousPath ? (
          <>
            <span className="text-muted line-through">{file.previousPath}</span>
            <span className="text-muted"> → </span>
            {file.path}
          </>
        ) : (
          file.path
        )}
      </span>

      <span className="flex shrink-0 items-center gap-1.5 font-mono text-xs">
        <span className="text-success">+{file.additions}</span>
        <span className="text-danger">-{file.deletions}</span>
      </span>

      <div className="flex shrink-0 gap-0.5 border-l border-border pl-2">
        <IconButton
          icon={<Columns2 size={15} />}
          label={
            splitTooNarrow
              ? t('prDetail.toolbar.splitTooNarrow', { width: SPLIT_DIFF_MIN_WIDTH })
              : t('prDetail.toolbar.split')
          }
          active={mode === 'split'}
          disabled={splitTooNarrow}
          onClick={() => onModeChange('split')}
        />
        <IconButton
          icon={<AlignJustify size={15} />}
          label={t('prDetail.toolbar.inline')}
          active={mode === 'inline'}
          onClick={() => onModeChange('inline')}
        />
        <IconButton
          icon={<WrapText size={15} />}
          label={t('prDetail.toolbar.wordWrap')}
          active={wordWrap}
          onClick={onToggleWordWrap}
        />
      </div>
    </div>
  )
}
