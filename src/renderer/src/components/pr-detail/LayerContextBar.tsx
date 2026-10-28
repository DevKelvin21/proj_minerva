import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight, TriangleAlert, Workflow } from 'lucide-react'
import type { DiffFile, WalkthroughFileRef } from '../../../../shared/types'
import { rangeLabel, rangeLineCount, type FlatLayer } from '../../lib/walkthrough'
import { Markdown } from '../ui/Markdown'
import { Chip } from '../ui/Chip'
import { IconButton } from '../ui/IconButton'
import { ExpandableResource } from '../didactic/ExpandableResource'
import { MermaidDiagram } from '../didactic/MermaidDiagram'
import { ResourceViewer, type ViewerResource } from '../didactic/ResourceViewer'
import { FileStatusIcon } from './FileStatusIcon'

interface LayerContextBarProps {
  entry: FlatLayer
  total: number
  /** The layer's files that exist in the PR, with the matching `DiffFile`. */
  files: Array<{ ref: WalkthroughFileRef; file: DiffFile }>
  unknownPaths: string[]
  selectedPath: string
  onSelectFile: (path: string) => void
  onPrevious: (() => void) | null
  onNext: (() => void) | null
}

/**
 * Context strip above the diff while following a walkthrough layer: where we
 * are (layer N of M, cohort), the layer title and AI summary, one chip per
 * file with its line ranges (click to switch file), and the layer diagram
 * when the model emitted one (collapsed by default: the diff is the point).
 */
export function LayerContextBar({
  entry,
  total,
  files,
  unknownPaths,
  selectedPath,
  onSelectFile,
  onPrevious,
  onNext,
}: LayerContextBarProps): React.JSX.Element {
  const { t } = useTranslation()
  const [diagramOpen, setDiagramOpen] = useState(false)
  const [viewer, setViewer] = useState<ViewerResource | null>(null)
  const { layer } = entry
  const diagramTitle = t('prDetail.layers.diagramTitle', { title: layer.title })

  return (
    <div
      className="flex shrink-0 flex-col gap-1.5 border-b border-border bg-panel/60 px-3 py-2"
      data-testid="layer-context"
    >
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-[11px] font-medium text-muted tabular-nums">
          {t('prDetail.layers.layerOf', { index: entry.index + 1, total })}
        </span>
        {entry.cohortTitle && (
          <span className="min-w-0 truncate text-[11px] text-muted" title={entry.cohortTitle}>
            · {entry.cohortTitle}
          </span>
        )}
        <span className="flex-1" />
        <span className="hidden text-[11px] text-muted sm:inline" aria-hidden>
          {t('prDetail.layers.keyboardHint')}
        </span>
        <IconButton
          icon={<ChevronLeft size={15} />}
          label={t('prDetail.layers.previous')}
          disabled={onPrevious === null}
          onClick={onPrevious ?? undefined}
          className="h-7 w-7"
        />
        <IconButton
          icon={<ChevronRight size={15} />}
          label={t('prDetail.layers.next')}
          disabled={onNext === null}
          onClick={onNext ?? undefined}
          className="h-7 w-7"
        />
      </div>

      <h2 className="text-sm font-semibold text-text" data-testid="layer-title">
        {layer.title}
      </h2>

      {layer.markdown.trim().length > 0 && (
        <div className="text-xs text-muted" aria-label={t('prDetail.layers.summaryLabel')}>
          <Markdown content={layer.markdown} images={false} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        {files.map(({ ref, file }) => {
          const active = file.path === selectedPath
          const basename = file.path.slice(file.path.lastIndexOf('/') + 1)
          const lines = rangeLineCount(ref.ranges)
          return (
            <Chip
              key={file.path}
              onClick={() => onSelectFile(file.path)}
              selected={active}
              title={file.path}
              data-testid="layer-file-chip"
              icon={<FileStatusIcon status={file.status} />}
            >
              <span className="truncate font-mono">{basename}</span>
              <span className="shrink-0 font-mono text-[11px] text-muted tabular-nums">
                {ref.ranges.length > 0
                  ? `${rangeLabel(ref.ranges)} · ${t('prDetail.layers.lineCount', { count: lines })}`
                  : t('prDetail.layers.wholeFile')}
              </span>
            </Chip>
          )
        })}
        {layer.mermaid && (
          <Chip
            onClick={() => setDiagramOpen((open) => !open)}
            aria-expanded={diagramOpen}
            icon={<Workflow size={12} aria-hidden />}
            className="ml-auto"
          >
            {diagramOpen ? t('prDetail.layers.hideDiagram') : t('prDetail.layers.showDiagram')}
          </Chip>
        )}
      </div>

      {unknownPaths.length > 0 && (
        <p className="flex items-start gap-1.5 text-[11px] text-warning">
          <TriangleAlert size={12} className="mt-0.5 shrink-0" />
          {t('prDetail.layers.unknownFiles', { files: unknownPaths.join(', ') })}
        </p>
      )}

      {layer.mermaid && diagramOpen && (
        <div className="max-h-72 overflow-auto rounded-md border border-border bg-bg p-2">
          <ExpandableResource
            label={t('didactic.resources.expandDiagram')}
            onExpand={() =>
              setViewer({ kind: 'mermaid', title: diagramTitle, code: layer.mermaid ?? '' })
            }
          >
            <MermaidDiagram key={layer.mermaid} code={layer.mermaid} />
          </ExpandableResource>
        </div>
      )}

      {viewer && <ResourceViewer resource={viewer} onClose={() => setViewer(null)} />}
    </div>
  )
}
