/**
 * Pure math of `ui/ResizeHandle`: a vertical splitter on the left or right
 * edge of a panel whose value is that panel's width in px.
 */

/** One arrow press moves the edge this far. */
export const RESIZE_STEP_PX = 16

/** Which edge of the panel the handle sits on (the panel grows toward it). */
export type ResizeEdge = 'left' | 'right'

export interface ResizeBounds {
  min?: number
  max?: number
}

export function clampResize(value: number, { min, max }: ResizeBounds): number {
  let next = Math.round(value)
  if (max !== undefined) next = Math.min(next, max)
  if (min !== undefined) next = Math.max(next, min)
  return next
}

/**
 * Width after dragging the edge from `startX` to `clientX`: a right-edge
 * handle grows with the pointer moving right, a left-edge one (the panel
 * grows leftward) with it moving left.
 */
export function dragResizeValue(
  startValue: number,
  startX: number,
  clientX: number,
  edge: ResizeEdge,
  bounds: ResizeBounds = {},
): number {
  const delta = clientX - startX
  return clampResize(startValue + (edge === 'right' ? delta : -delta), bounds)
}

/**
 * Width after a key press, or `null` when the key does nothing. Arrows move
 * the edge the way they point (so ArrowLeft widens a left-edge panel);
 * Home/End jump to the bound when there is one.
 */
export function keyResizeValue(
  key: string,
  value: number,
  edge: ResizeEdge,
  bounds: ResizeBounds = {},
): number | null {
  const grow = edge === 'right' ? 'ArrowRight' : 'ArrowLeft'
  const shrink = edge === 'right' ? 'ArrowLeft' : 'ArrowRight'
  switch (key) {
    case grow:
      return clampResize(value + RESIZE_STEP_PX, bounds)
    case shrink:
      return clampResize(value - RESIZE_STEP_PX, bounds)
    case 'Home':
      return bounds.min ?? null
    case 'End':
      return bounds.max ?? null
    default:
      return null
  }
}
