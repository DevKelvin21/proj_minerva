interface DiffInsertRowProps {
  children: React.ReactNode
}

/**
 * The one shape of anything inserted under a diff row (a thread, the line
 * comment composer, the line chat input), in inline and split alike: full
 * width, the same inset, border and font. Back-to-back inserts share one
 * border line.
 */
export function DiffInsertRow({ children }: DiffInsertRowProps): React.JSX.Element {
  return (
    <div
      data-diff-insert=""
      style={{ gridColumn: '1 / -1' }}
      className="min-w-0 border-y border-border bg-bg px-3 py-1.5 font-sans [[data-diff-insert]+&]:border-t-0"
    >
      {children}
    </div>
  )
}
