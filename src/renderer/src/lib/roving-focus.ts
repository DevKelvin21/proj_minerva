/**
 * Keyboard rules shared by tablists and menus (WAI-ARIA APG): arrows move to
 * the neighbour with wrap-around, Home/End jump to the ends. Pure, so the
 * components only map the result to a focus() call.
 */
export type RovingOrientation = 'horizontal' | 'vertical'

/** The index `key` moves to from `index` among `count` items, or `null` when the key is not a move. */
export function rovingTarget(
  key: string,
  index: number,
  count: number,
  orientation: RovingOrientation,
): number | null {
  if (count <= 0) return null
  const prev = orientation === 'horizontal' ? 'ArrowLeft' : 'ArrowUp'
  const next = orientation === 'horizontal' ? 'ArrowRight' : 'ArrowDown'
  if (key === next) return (index + 1 + count) % count
  if (key === prev) return (index - 1 + count) % count
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  return null
}

export interface AnchorRect {
  top: number
  bottom: number
  left: number
  right: number
}

export interface MenuPlacement {
  top?: number
  bottom?: number
  left?: number
  right?: number
  maxHeight: number
  maxWidth: number
}

/** Below this much room under the anchor a menu opens upward, if there is more room above. */
const MIN_ROOM_BELOW = 160

/**
 * Where a menu with `position: fixed` goes next to its trigger: below it
 * unless the room there is short and the room above is larger, aligned to
 * the trigger's left edge, or its right edge when the trigger sits in the
 * right half of the window. The max sizes keep it inside the viewport, so a
 * scrolling container can never clip it.
 */
export function placeMenu(
  anchor: AnchorRect,
  viewport: { width: number; height: number },
  gap = 4,
  margin = 8,
): MenuPlacement {
  const below = viewport.height - anchor.bottom - gap - margin
  const above = anchor.top - gap - margin
  const openUp = below < MIN_ROOM_BELOW && above > below
  const alignRight = anchor.left > viewport.width / 2
  return {
    ...(openUp ? { bottom: viewport.height - anchor.top + gap } : { top: anchor.bottom + gap }),
    ...(alignRight ? { right: viewport.width - anchor.right } : { left: anchor.left }),
    maxHeight: Math.max(0, openUp ? above : below),
    maxWidth: Math.max(0, alignRight ? anchor.right - margin : viewport.width - anchor.left - margin),
  }
}
