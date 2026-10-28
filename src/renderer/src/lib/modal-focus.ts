/**
 * Focus rules shared by `Dialog` and `Drawer` (WAI-ARIA APG modal dialog):
 * Tab and Shift+Tab wrap inside the open layer, only the topmost visible
 * layer answers the keyboard, and closing hands focus back to whatever
 * opened it. Pure, so the components only map the results to `focus()`.
 */

/** Elements Tab can land on (filtered further for visibility by the caller). */
export const TABBABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]',
  '[contenteditable=""]',
  '[contenteditable="true"]',
]
  .map((selector) => selector + ':not([tabindex="-1"])')
  .join(',')

/**
 * Where Tab goes from the tabbable at `index` (-1 = focus is on the layer
 * itself or outside it) among `count`: the other end when it would leave the
 * layer, `'container'` when nothing inside is tabbable, `null` when the
 * browser's own move stays inside.
 */
export function trapStep(
  index: number,
  count: number,
  backwards: boolean,
): number | 'container' | null {
  if (count <= 0) return 'container'
  if (index < 0 || index >= count) return backwards ? count - 1 : 0
  if (backwards && index === 0) return count - 1
  if (!backwards && index === count - 1) return 0
  return null
}

/**
 * The layer that answers the keyboard: the last opened one that is on
 * screen. A layer inside the review stays mounted (and in the stack) while
 * the home dashboard hides it, so "last opened" alone is not enough.
 */
export function topmostLayer<T>(layers: readonly T[], isVisible: (layer: T) => boolean): T | null {
  for (let i = layers.length - 1; i >= 0; i--) {
    if (isVisible(layers[i])) return layers[i]
  }
  return null
}

export interface RestoreFocusState {
  /** The layer left the DOM (closed), rather than docking inline on a wider tier. */
  layerRemoved: boolean
  /** Focus was dropped with it (on `body`, or nowhere). */
  focusLost: boolean
  /** The element that had focus when the layer opened is still in the document. */
  openerConnected: boolean
}

/**
 * Whether closing gives focus back to the opener: only when the layer is
 * really gone, the opener still exists and nothing else claimed focus
 * meanwhile (a palette command focusing a file, another dialog opening, win).
 */
export function shouldRestoreFocus(state: RestoreFocusState): boolean {
  return state.layerRemoved && state.openerConnected && state.focusLost
}
