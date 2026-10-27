import { ArrowDownToLine, ArrowUpToLine, UnfoldVertical } from 'lucide-react'
import { EXPAND_STEP, gapLength, type HiddenGap } from '../../lib/expand-context'

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

const BUTTON =
  'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-muted transition-colors hover:bg-border/60 hover:text-text disabled:cursor-wait disabled:opacity-60'

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
  const length = gapLength(gap)
  const hasAbove = gap.beforeHunk > 0 || gap.newStart > 1
  const hasBelow = gap.beforeHunk < hunkCount
  const small = length !== null && length <= EXPAND_STEP

  return (
    <div
      data-testid="diff-expander"
      data-gap-start={gap.newStart}
      className="flex flex-wrap items-center gap-2 border-y border-border bg-accent/5 px-3 py-0.5 font-sans text-[11px] text-muted"
    >
      <UnfoldVertical size={12} className="shrink-0" />
      <span>
        {length === null
          ? 'More lines below'
          : `${length} hidden ${length === 1 ? 'line' : 'lines'}`}
      </span>
      {error ? (
        <span className="text-danger">Could not load the file: {error}</span>
      ) : small || length === null ? (
        <button
          type="button"
          disabled={loading}
          className={BUTTON}
          onClick={() => onExpand(length === null ? 'down' : 'all')}
        >
          {loading ? 'Loading…' : length === null ? `Show ${EXPAND_STEP} more` : 'Show'}
        </button>
      ) : (
        <>
          {hasAbove && (
            <button
              type="button"
              disabled={loading}
              className={BUTTON}
              title={`Show ${EXPAND_STEP} more lines after the code above`}
              aria-label={`Expand down ${EXPAND_STEP} lines`}
              onClick={() => onExpand('down')}
            >
              <ArrowDownToLine size={11} /> {EXPAND_STEP}
            </button>
          )}
          {hasBelow && (
            <button
              type="button"
              disabled={loading}
              className={BUTTON}
              title={`Show ${EXPAND_STEP} more lines before the code below`}
              aria-label={`Expand up ${EXPAND_STEP} lines`}
              onClick={() => onExpand('up')}
            >
              <ArrowUpToLine size={11} /> {EXPAND_STEP}
            </button>
          )}
          <button
            type="button"
            disabled={loading}
            className={BUTTON}
            onClick={() => onExpand('all')}
          >
            {loading ? 'Loading…' : `Show all ${length}`}
          </button>
        </>
      )}
    </div>
  )
}
