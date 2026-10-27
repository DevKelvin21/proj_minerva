import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { prKey } from '../../../../shared/scm'
import type { PullRequestSummary } from '../../../../shared/types'
import { useWalkthrough } from '../../hooks/use-walkthrough'
import { findFlatLayer, flattenLayers, layerVerdictKey, sameLayerRef } from '../../lib/walkthrough'
import { useAppStore, type LayerVerdict } from '../../stores/app-store'

const SEGMENT: Record<LayerVerdict, string> = {
  good: 'bg-success',
  changes: 'bg-danger',
  question: 'bg-warning',
}

/**
 * Title bar progress of the full-screen walkthrough: "Layer 3 of 5" and one
 * segment per layer, colored by the reviewer's verdict (accent = on screen).
 * Same analysis as the Files tab (`useWalkthrough`), no extra request.
 */
export function WalkthroughProgress({ pr }: { pr: PullRequestSummary }): React.JSX.Element | null {
  const { t } = useTranslation()
  const { cohorts } = useWalkthrough(pr.repo, pr.number)
  const activeLayer = useAppStore((s) => s.activeLayer)
  const verdicts = useAppStore((s) => s.layerVerdicts[prKey(pr.repo, pr.number)])
  const flat = useMemo(() => flattenLayers(cohorts ?? []), [cohorts])
  if (flat.length === 0) return null
  const current = findFlatLayer(flat, activeLayer)
  const judged = flat.filter((entry) => verdicts?.[layerVerdictKey(entry.ref)]).length
  const label = current
    ? t('prDetail.focus.progress', { current: current.index + 1, total: flat.length })
    : t('prDetail.focus.progressNone', { total: flat.length })

  return (
    <div
      data-testid="walkthrough-progress"
      className="flex min-w-0 items-center gap-3"
      role="img"
      aria-label={label + ' · ' + t('prDetail.focus.judged', { count: judged, total: flat.length })}
    >
      <span className="shrink-0 text-xs font-semibold text-text">{label}</span>
      <span className="flex min-w-0 gap-1" aria-hidden>
        {flat.map((entry) => {
          const verdict = verdicts?.[layerVerdictKey(entry.ref)]
          const onScreen = sameLayerRef(entry.ref, activeLayer)
          return (
            <span
              key={layerVerdictKey(entry.ref)}
              className={`h-1 w-7 min-w-2 shrink rounded-full ${
                onScreen ? 'bg-accent' : verdict ? SEGMENT[verdict] : 'bg-border'
              }`}
            />
          )
        })}
      </span>
    </div>
  )
}
