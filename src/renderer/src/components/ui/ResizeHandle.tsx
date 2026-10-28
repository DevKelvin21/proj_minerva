import { useRef } from 'react'
import { dragResizeValue, keyResizeValue, type ResizeEdge } from '../../lib/resize-handle'

interface ResizeHandleProps {
  /** Edge of the panel the strip sits on; the panel grows toward it. */
  edge: ResizeEdge
  /** The panel's painted width in px (`aria-valuenow`). */
  value: number
  min?: number
  max?: number
  onChange: (width: number) => void
  /** Double-click: back to the default width. */
  onReset?: () => void
  label: string
  title?: string
  'data-testid'?: string
}

const EDGE_CLASS: Record<ResizeEdge, string> = {
  left: '-left-[3px]',
  right: '-right-[3px]',
}

/**
 * 6px drag strip on a panel edge (a focusable window splitter). Pointer
 * capture keeps the drag alive when the pointer leaves the strip; arrows
 * nudge it, Home/End jump to the bounds, double-click resets. Its parent
 * must be `relative`. Callers' stores still clamp what they persist.
 */
export function ResizeHandle({
  edge,
  value,
  min,
  max,
  onChange,
  onReset,
  label,
  title,
  'data-testid': testId,
}: ResizeHandleProps): React.JSX.Element {
  const drag = useRef<{ startX: number; startValue: number } | null>(null)
  const bounds = { min, max }

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      title={title}
      data-testid={testId}
      className={`absolute inset-y-0 z-10 w-1.5 cursor-col-resize touch-none transition-colors duration-150 hover:bg-accent/50 focus-visible:bg-accent/70 focus-visible:outline-none active:bg-accent/70 ${EDGE_CLASS[edge]}`}
      onPointerDown={(e) => {
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
        drag.current = { startX: e.clientX, startValue: value }
      }}
      onPointerMove={(e) => {
        const start = drag.current
        if (!start || !e.currentTarget.hasPointerCapture(e.pointerId)) return
        onChange(dragResizeValue(start.startValue, start.startX, e.clientX, edge, bounds))
      }}
      onPointerUp={() => {
        drag.current = null
      }}
      onLostPointerCapture={() => {
        drag.current = null
      }}
      onDoubleClick={onReset}
      onKeyDown={(e) => {
        const next = keyResizeValue(e.key, value, edge, bounds)
        if (next === null) return
        e.preventDefault()
        onChange(next)
      }}
    />
  )
}
