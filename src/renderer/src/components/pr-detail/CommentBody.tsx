import { useMemo } from 'react'
import { Lightbulb } from 'lucide-react'
import { Markdown } from '../ui/Markdown'
import { diffSuggestion, splitSuggestionBlocks } from '../../lib/suggestions'

interface SuggestionDiffProps {
  suggested: readonly string[]
  /** The lines the suggestion replaces, when known (`null` = unknown: only the new lines show). */
  original: readonly string[] | null
  /** The thread is outdated: the original lines come from newer code and may not match. */
  outdated?: boolean
}

const ROW_CLASS = {
  context: 'text-text/80',
  del: 'bg-[#3f1d24] text-text',
  add: 'bg-[#1d3a28] text-text',
} as const

const ROW_MARK = { context: ' ', del: '-', add: '+' } as const

/** A suggested change as a mini-diff (original lines vs suggested), never raw fence text. */
export function SuggestionDiff({
  suggested,
  original,
  outdated = false,
}: SuggestionDiffProps): React.JSX.Element {
  const rows = useMemo(
    () =>
      original
        ? diffSuggestion(original, suggested)
        : suggested.map((text) => ({ kind: 'add' as const, text })),
    [original, suggested],
  )
  return (
    <figure data-testid="suggestion-diff" className="overflow-hidden rounded border border-border">
      <figcaption className="flex items-center gap-1.5 border-b border-border bg-panel px-2 py-1 text-xs text-muted">
        <Lightbulb size={12} className="text-warning" />
        <span className="font-medium text-text">Suggested change</span>
        {suggested.length === 0 && <span>(remove these lines)</span>}
        {original === null && <span>· original lines unavailable</span>}
        {outdated && original !== null && <span>· the code may have changed since</span>}
      </figcaption>
      <div className="overflow-x-auto bg-code-bg font-mono text-xs leading-5">
        {rows.map((row, i) => (
          <div
            key={i}
            data-suggestion-row={row.kind}
            className={`grid grid-cols-[1.5rem_minmax(0,1fr)] ${ROW_CLASS[row.kind]}`}
          >
            <span
              className={`select-none text-center ${
                row.kind === 'add'
                  ? 'text-success'
                  : row.kind === 'del'
                    ? 'text-danger'
                    : 'text-muted'
              }`}
            >
              {ROW_MARK[row.kind]}
            </span>
            <span className="whitespace-pre-wrap break-words pr-2">{row.text || ' '}</span>
          </div>
        ))}
      </div>
    </figure>
  )
}

interface CommentBodyProps {
  body: string
  /** Lines a suggestion in this body replaces (the thread's anchored lines), when known. */
  originalLines: readonly string[] | null
  outdated?: boolean
}

/**
 * A comment body: Markdown through the shared safe renderer (no raw HTML), with
 * each ```suggestion block replaced by a `SuggestionDiff`.
 */
export function CommentBody({
  body,
  originalLines,
  outdated,
}: CommentBodyProps): React.JSX.Element {
  const parts = useMemo(() => splitSuggestionBlocks(body), [body])
  if (!parts.some((part) => part.kind === 'suggestion')) return <Markdown content={body} />
  return (
    <div className="flex flex-col gap-2">
      {parts.map((part, i) =>
        part.kind === 'markdown' ? (
          <Markdown key={i} content={part.text} />
        ) : (
          <SuggestionDiff
            key={i}
            suggested={part.lines}
            original={originalLines}
            outdated={outdated}
          />
        ),
      )}
    </div>
  )
}
