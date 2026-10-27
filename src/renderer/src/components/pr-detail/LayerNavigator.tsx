import { useTranslation } from 'react-i18next'
import { Loader2, MessageSquare, Sparkles, TriangleAlert, Workflow } from 'lucide-react'
import type { CommentThread, DiffFile, WalkthroughCohort } from '../../../../shared/types'
import type { WalkthroughStatus } from '../../hooks/use-walkthrough'
import {
  flattenLayers,
  layerThreadCount,
  resolveLayerFiles,
  sameLayerRef,
  unassignedFiles,
  type LayerRef,
} from '../../lib/walkthrough'
import { FileStatusIcon } from './FileStatusIcon'

interface LayerNavigatorProps {
  cohorts: WalkthroughCohort[] | null
  status: WalkthroughStatus
  error: string | null
  files: DiffFile[]
  threads: CommentThread[]
  activeLayer: LayerRef | null
  selectedPath: string | null
  onSelectLayer: (ref: LayerRef) => void
  /** A file outside every layer: shows it with no layer active. */
  onSelectUnassignedFile: (path: string) => void
  onAnalyze: () => void
}

/**
 * Left column of the Files tab in "layers" mode: the AI walkthrough as
 * cohorts of numbered layers (reading order), plus the PR files no layer
 * covers so nothing is hidden from the reviewer. Without an analysis it
 * offers to run one (same analysis the didactic panel shows: one LLM call).
 */
export function LayerNavigator({
  cohorts,
  status,
  error,
  files,
  threads,
  activeLayer,
  selectedPath,
  onSelectLayer,
  onSelectUnassignedFile,
  onAnalyze,
}: LayerNavigatorProps): React.JSX.Element {
  const { t } = useTranslation()

  if (status === 'error') {
    return (
      <div className="flex flex-col gap-2 p-3 text-xs" data-testid="layers-error">
        <p className="flex items-start gap-1.5 text-danger">
          <TriangleAlert size={13} className="mt-0.5 shrink-0" />
          {t('prDetail.layers.failed', { error: error ?? '' })}
        </p>
        <button type="button" onClick={onAnalyze} className={secondaryButton}>
          {t('prDetail.layers.retry')}
        </button>
      </div>
    )
  }

  if (status === 'checking' || status === 'analyzing') {
    return (
      <div className="flex flex-col gap-3 p-3" data-testid="layers-loading">
        <p className="flex items-center gap-2 text-xs text-muted">
          <Loader2 size={13} className="animate-spin text-accent" />
          {status === 'checking' ? t('prDetail.layers.checking') : t('prDetail.layers.analyzing')}
        </p>
        <div className="h-10 animate-pulse rounded-md border border-border bg-border/20" />
        <div className="h-10 animate-pulse rounded-md border border-border bg-border/20" />
      </div>
    )
  }

  if (status === 'idle' || status === 'missing' || !cohorts) {
    const missing = status === 'missing'
    return (
      <div className="flex flex-col gap-2 p-3" data-testid="layers-placeholder">
        <p className="flex items-center gap-1.5 text-sm font-medium text-text">
          <Sparkles size={14} className="text-accent" />
          {missing ? t('prDetail.layers.missingTitle') : t('prDetail.layers.placeholderTitle')}
        </p>
        <p className="text-xs text-muted">
          {missing ? t('prDetail.layers.missingHint') : t('prDetail.layers.placeholderHint')}
        </p>
        <button type="button" onClick={onAnalyze} className={primaryButton}>
          {missing ? t('prDetail.layers.reanalyze') : t('prDetail.layers.analyze')}
        </button>
      </div>
    )
  }

  const flat = flattenLayers(cohorts)
  const leftovers = unassignedFiles(cohorts, files)

  return (
    <nav aria-label={t('prDetail.layers.title')} className="flex flex-col py-1" data-testid="layer-navigator">
      {status === 'streaming' && (
        <p className="flex items-center gap-1.5 px-3 py-1 text-[11px] text-muted">
          <Loader2 size={11} className="animate-spin text-accent" />
          {t('prDetail.layers.streaming')}
        </p>
      )}
      {cohorts.map((cohort, c) => (
        <section key={c} className="mb-1">
          <h3 className="truncate px-3 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-muted uppercase">
            {cohort.title || t('prDetail.layers.defaultCohort')}
          </h3>
          <ol>
            {cohort.layers.map((layer, l) => {
              const ref = { cohort: c, layer: l }
              const entry = flat.find((f) => sameLayerRef(f.ref, ref))
              const active = sameLayerRef(activeLayer, ref)
              const known = resolveLayerFiles(layer, files).known.length
              const comments = layerThreadCount(layer, threads)
              return (
                <li key={l}>
                  <button
                    type="button"
                    onClick={() => onSelectLayer(ref)}
                    aria-current={active ? 'step' : undefined}
                    data-testid="layer-item"
                    className={`flex w-full items-start gap-2 px-3 py-1.5 text-left transition-colors duration-100 ${
                      active ? 'bg-accent/15 text-text' : 'text-muted hover:bg-border/40 hover:text-text'
                    }`}
                  >
                    <span
                      className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold tabular-nums ${
                        active
                          ? 'border-accent bg-accent text-accent-fg'
                          : 'border-border text-muted'
                      }`}
                    >
                      {(entry?.index ?? 0) + 1}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="line-clamp-2 text-sm leading-snug">{layer.title}</span>
                      <span className="flex items-center gap-2 text-[11px] text-muted">
                        <span>{t('prDetail.layers.fileCount', { count: known })}</span>
                        {comments > 0 && (
                          <span className="flex items-center gap-0.5">
                            <MessageSquare size={10} />
                            {t('prDetail.layers.commentCount', { count: comments })}
                          </span>
                        )}
                        {layer.mermaid && <Workflow size={10} aria-hidden />}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ol>
        </section>
      ))}
      {leftovers.length > 0 && (
        <section className="mb-1" data-testid="layers-unassigned">
          <h3 className="truncate px-3 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-muted uppercase">
            {t('prDetail.layers.unassigned')}
          </h3>
          <ul>
            {leftovers.map((file) => {
              const active = activeLayer === null && file.path === selectedPath
              return (
                <li key={file.path}>
                  <button
                    type="button"
                    onClick={() => onSelectUnassignedFile(file.path)}
                    aria-current={active}
                    className={`flex w-full items-center gap-1.5 px-3 py-1 text-left text-sm transition-colors duration-100 ${
                      active ? 'bg-accent/15 text-text' : 'text-muted hover:bg-border/40 hover:text-text'
                    }`}
                  >
                    <FileStatusIcon status={file.status} />
                    <span className="truncate font-mono text-xs">{file.path}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </nav>
  )
}

const primaryButton =
  'self-start rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg transition-opacity hover:opacity-90'
const secondaryButton =
  'self-start rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-border/60 hover:text-text'
