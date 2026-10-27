import type { CommentThread } from '../../../../shared/types'
import { useThreadFileLines } from '../../hooks/thread-actions'
import { excerptWindow, threadLineRange, threadSide } from '../../lib/line-threads'

interface CodeExcerptProps {
  lines: readonly string[]
  from: number
  to: number
  highlight: { start: number; end: number }
}

/** A few numbered lines of a file with the commented range highlighted. Plain text (untrusted). */
export function CodeExcerpt({ lines, from, to, highlight }: CodeExcerptProps): React.JSX.Element {
  const rows: React.ReactNode[] = []
  for (let n = from; n <= to; n++) {
    const marked = n >= highlight.start && n <= highlight.end
    rows.push(
      <div
        key={n}
        data-excerpt-line={n}
        data-highlighted={marked || undefined}
        className={`grid grid-cols-[max-content_minmax(0,1fr)] ${
          marked ? 'bg-accent/15 shadow-[inset_2px_0_0_var(--color-accent)]' : ''
        }`}
      >
        <span className="select-none px-2 text-right text-muted/70">{n}</span>
        <span className="whitespace-pre-wrap break-words px-2 text-text">
          {lines[n - 1] === '' ? ' ' : lines[n - 1]}
        </span>
      </div>,
    )
  }
  return (
    <div
      data-testid="code-excerpt"
      className="overflow-x-auto rounded border border-border bg-code-bg py-1 font-mono text-xs leading-5"
    >
      {rows}
    </div>
  )
}

interface ThreadCodeExcerptProps {
  thread: CommentThread
}

/**
 * The code a line thread points at, read from the PR (head for RIGHT, base
 * for LEFT), so a comment is never shown without its code: in the Comments
 * view, for outdated threads, and for threads the diff can't place. Outdated
 * threads say the code may have moved since.
 */
export function ThreadCodeExcerpt({ thread }: ThreadCodeExcerptProps): React.JSX.Element | null {
  const range = threadLineRange(thread)
  const state = useThreadFileLines(thread, Boolean(thread.path && range))
  if (!thread.path || !range) return null

  const sideLabel = threadSide(thread) === 'LEFT' ? 'base (before the change)' : 'latest version'
  const note = thread.isOutdated ? (
    <p className="text-xs text-warning" data-testid="outdated-note">
      This comment was left on an earlier version of the file. The code below is from the latest
      version around line {range.start}; it may have changed since.
    </p>
  ) : null

  let body: React.ReactNode
  if (state.status === 'loading' || state.status === 'idle') {
    body = <p className="text-xs text-muted">Loading code…</p>
  } else if (state.status === 'error') {
    body = <p className="text-xs text-danger">Could not load the code: {state.error}</p>
  } else if (state.status === 'unavailable') {
    body = <p className="text-xs text-muted">{state.reason}</p>
  } else {
    const win = excerptWindow(range.start, range.end, state.lines.length)
    body = win ? (
      <CodeExcerpt lines={state.lines} from={win.from} to={win.to} highlight={range} />
    ) : (
      <p className="text-xs text-muted">
        Line {range.start} is past the end of the file in its {sideLabel}.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-1.5" aria-label={`Code at ${thread.path}:${range.start}`}>
      {note}
      {body}
    </div>
  )
}
