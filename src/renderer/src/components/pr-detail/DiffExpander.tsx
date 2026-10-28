import { ArrowDownToLine, ArrowUpToLine, UnfoldVertical } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { EXPAND_STEP, gapLength, type HiddenGap } from '../../lib/expand-context'
import { Button } from '../ui/Button'

interface DiffExpanderProps {
  gap: HiddenGap
  /** Total hunks of the file: tells whether code sits above/below the gap. */
  hunkCount: number
  /** The file is being fetched (first expand). */
  loading: boolean
  /** Fetching the file failed: expanding can't work. */
  error: string | null
  onExpand: (direction: 'up' | 'down' | 'all') => void
}

/**
 * Full-width row standing for lines the patch does not show. "Down" reveals
 * lines right after the code above, "up" the lines right before the code
 * below, and "all" the whole run. The length of the run after the last hunk
 * is unknown until the file is fetched.
 */
export function DiffExpander({
  gap,
  hunkCount,
  loading,
  error,
  onExpand,
}: DiffExpanderProps): React.JSX.Element {
  const { t } = useTranslation()
  const length = gapLength(gap)
  const hasAbove = gap.beforeHunk > 0 || gap.newStart > 1
  const hasBelow = gap.beforeHunk < hunkCount
  const small = length !== null && length <= EXPAND_STEP

  return (
    <div
      data-testid="diff-expander"
      data-gap-start={gap.newStart}
      className="flex min-h-6 flex-wrap items-center gap-2 border-y border-border bg-accent/5 px-3 font-sans text-[11px] text-muted"
    >
      <UnfoldVertical size={12} className="shrink-0" />
      <span>
        {length === null
          ? t('prDetail.expander.moreBelow')
          : t('prDetail.expander.hiddenLines', { count: length })}
      </span>
      {error ? (
        <span className="text-danger">{t('prDetail.expander.loadError', { error })}</span>
      ) : small || length === null ? (
        <Button
          variant="ghost"
          size="xs"
          disabled={loading}
          onClick={() => onExpand(length === null ? 'down' : 'all')}
        >
          {loading
            ? t('common.loading')
            : length === null
              ? t('prDetail.expander.showMore', { count: EXPAND_STEP })
              : t('prDetail.expander.show')}
        </Button>
      ) : (
        <>
          {hasAbove && (
            <Button
              variant="ghost"
              size="xs"
              disabled={loading}
              title={t('prDetail.expander.downTitle', { count: EXPAND_STEP })}
              aria-label={t('prDetail.expander.downLabel', { count: EXPAND_STEP })}
              onClick={() => onExpand('down')}
              icon={<ArrowDownToLine size={11} aria-hidden />}
            >
              {EXPAND_STEP}
            </Button>
          )}
          {hasBelow && (
            <Button
              variant="ghost"
              size="xs"
              disabled={loading}
              title={t('prDetail.expander.upTitle', { count: EXPAND_STEP })}
              aria-label={t('prDetail.expander.upLabel', { count: EXPAND_STEP })}
              onClick={() => onExpand('up')}
              icon={<ArrowUpToLine size={11} aria-hidden />}
            >
              {EXPAND_STEP}
            </Button>
          )}
          <Button variant="ghost" size="xs" disabled={loading} onClick={() => onExpand('all')}>
            {loading ? t('common.loading') : t('prDetail.expander.showAll', { count: length })}
          </Button>
        </>
      )}
    </div>
  )
}
