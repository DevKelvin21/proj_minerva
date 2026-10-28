import { useTranslation } from 'react-i18next'
import { MessageSquare, Sparkles, Workflow } from 'lucide-react'
import type { CommentThread, DiffFile, WalkthroughCohort } from '../../../../shared/types'
import type { WalkthroughStatus } from '../../hooks/use-walkthrough'
import type { LayerVerdict } from '../../stores/app-store'
import {
  flattenLayers,
  layerThreadCount,
  resolveLayerFiles,
  sameLayerRef,
  unassignedFiles,
  type LayerRef,
  layerVerdictKey,
} from '../../lib/walkthrough'
import { Button } from '../ui/Button'
import { FileRow } from '../ui/FileRow'
import { FileStatusIcon } from './FileStatusIcon'
import { InlineError } from '../ui/InlineError'
import { Spinner } from '../ui/Spinner'
import { Skeleton } from '../ui/Skeleton'

/** Number badge of a layer the reviewer already judged (status roles, never a hard-coded color). */
const VERDICT_BADGE: Record<LayerVerdict, string> = {
  good: 'border-success bg-success/15 text-success',
  changes: 'border-danger bg-danger/15 text-danger',
  question: 'border-warning bg-warning/15 text-warning',
}

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
  /** The reviewer's verdict per layer (`layerVerdictKey`), shown on its number. */
  verdicts?: Record<string, LayerVerdict>
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
  verdicts,
}: LayerNavigatorProps): React.JSX.Element {
  const { t } = useTranslation()

  if (status === 'error') {
    return (
      <InlineError
        className="p-3"
        data-testid="layers-error"
        message={t('prDetail.layers.failed', { error: error ?? '' })}
        onRetry={onAnalyze}
      />
    )
  }

  if (status === 'checking' || status === 'analyzing') {
    return (
      <div className="flex flex-col gap-3 p-3" data-testid="layers-loading">
        <p className="flex items-center gap-2 text-xs text-muted">
          <Spinner size={13} />
          {status === 'checking' ? t('prDetail.layers.checking') : t('prDetail.layers.analyzing')}
        </p>
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
      </div>
    )
  }

  if (status === 'idle' || status === 'missing' || !cohorts) {
    const missing = status === 'missing'
    return (
      <div className="flex flex-col gap-2 p-3" data-testid="layers-placeholder">
        <p className="flex items-center gap-1.5 text-sm font-medium text-text">
          <Sparkles size={14} className="text-muted" aria-hidden />
          {missing ? t('prDetail.layers.missingTitle') : t('prDetail.layers.placeholderTitle')}
        </p>
        <p className="text-xs text-muted">
          {missing ? t('prDetail.layers.missingHint') : t('prDetail.layers.placeholderHint')}
        </p>
        <Button variant="primary" onClick={onAnalyze} className="self-start">
          {missing ? t('prDetail.layers.reanalyze') : t('prDetail.layers.analyze')}
        </Button>
      </div>
    )
  }

  const flat = flattenLayers(cohorts)
  const leftovers = unassignedFiles(cohorts, files)

  return (
    <nav aria-label={t('prDetail.layers.title')} className="flex flex-col py-1" data-testid="layer-navigator">
      {status === 'streaming' && (
        <p className="flex items-center gap-1.5 px-3 py-1 text-[11px] text-muted">
          <Spinner size={11} />
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
              const verdict = verdicts?.[layerVerdictKey(ref)]
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
                      data-verdict={verdict}
                      title={verdict ? t(`prDetail.layers.verdict.${verdict}`) : undefined}
                      className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold tabular-nums ${
                        active
                          ? 'border-accent bg-accent text-accent-fg'
                          : verdict
                            ? VERDICT_BADGE[verdict]
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
            {leftovers.map((file) => (
              <li key={file.path}>
                <FileRow
                  icon={<FileStatusIcon status={file.status} />}
                  name={file.path}
                  path={file.path}
                  additions={file.additions}
                  deletions={file.deletions}
                  selected={activeLayer === null && file.path === selectedPath}
                  onSelect={() => onSelectUnassignedFile(file.path)}
                  indent={12}
                />
              </li>
            ))}
          </ul>
        </section>
      )}
    </nav>
  )
}
