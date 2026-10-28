import {
  useEffect,
  useEffectEvent,
  useInsertionEffect,
  useLayoutEffect,
  useRef,
  type KeyboardEvent,
  type RefObject,
} from 'react'
import { shouldRestoreFocus, TABBABLE_SELECTOR, topmostLayer, trapStep } from '../lib/modal-focus'

/** Open layers, oldest first. Module-wide: nested dialogs must agree on who is on top. */
const layers: HTMLElement[] = []

/** `display: none` (the review hidden under home) leaves no client rects. */
function isVisible(element: HTMLElement): boolean {
  return element.getClientRects().length > 0
}

function isTop(element: HTMLElement): boolean {
  return topmostLayer(layers, isVisible) === element
}

function tabbables(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(TABBABLE_SELECTOR)).filter(
    (element) => isVisible(element) && element.closest('[inert]') === null,
  )
}

/** Wraps Tab at the layer's ends; `false` when the browser's own move stays inside. */
function moveTab(container: HTMLElement, backwards: boolean): boolean {
  const items = tabbables(container)
  const active = document.activeElement
  const step = trapStep(
    items.findIndex((item) => item === active),
    items.length,
    backwards,
  )
  if (step === null) return false
  ;(step === 'container' ? container : items[step]).focus()
  return true
}

interface ModalLayerOptions {
  onClose: () => void
  /** Gets focus on open; otherwise the first tabbable, otherwise the layer itself (unless a child focused itself). */
  initialFocus?: RefObject<HTMLElement | null>
  /** `false` while the layer is docked inline (a wide tier): no trap, no Esc. Default `true`. */
  active?: boolean
}

/**
 * Modal behaviour for `Dialog` and `Drawer`: focus moves in on open, Tab and
 * Shift+Tab wrap inside, Esc closes, and closing hands focus back to the
 * element that opened it. Only the topmost visible layer answers, so a dialog
 * on top of Settings closes alone. Spread `onKeyDown` on the layer (it needs
 * `tabIndex={-1}`): handling the keys there, in React's own pass, runs before
 * any document listener (a dashboard page's Esc-goes-back), and a nested
 * popover that stops Esc (a menu, a color field's draft) keeps the layer open.
 */
export function useModalLayer({ onClose, initialFocus, active = true }: ModalLayerOptions): {
  ref: RefObject<HTMLDivElement | null>
  onKeyDown: (event: KeyboardEvent) => void
} {
  const ref = useRef<HTMLDivElement>(null)
  const openerRef = useRef<HTMLElement | null>(null)
  const close = useEffectEvent(onClose)

  // The opener, read before any layout effect or `autoFocus` inside the
  // layer moves focus: insertion effects run first in the commit.
  useInsertionEffect(() => {
    if (!active) return
    const focused = document.activeElement
    openerRef.current = focused instanceof HTMLElement ? focused : null
  }, [active])

  // Open: join the stack and take focus before paint, unless something
  // inside already took it (a control that focuses itself on mount).
  useLayoutEffect(() => {
    const container = ref.current
    if (!active || !container) return
    layers.push(container)
    if (!container.contains(document.activeElement)) {
      ;(initialFocus?.current ?? tabbables(container)[0] ?? container).focus()
    }
    return () => {
      layers.splice(layers.indexOf(container), 1)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `initialFocus` is read once, on open.
  }, [active])

  // Close: a passive cleanup runs after the commit, when the layer is gone
  // from the DOM and any layer opened in the same commit (the palette
  // running "Settings") already took focus — that one keeps it.
  useEffect(() => {
    const container = ref.current
    if (!active || !container) return
    return () => {
      const opener = openerRef.current
      const focused = document.activeElement
      if (
        opener &&
        shouldRestoreFocus({
          layerRemoved: !container.isConnected,
          focusLost: focused === null || focused === document.body,
          openerConnected: opener.isConnected,
        })
      ) {
        opener.focus()
      }
    }
  }, [active])

  // Keys with focus outside the layer (dropped on `body`, or on a title bar
  // button clicked while a drawer is open): Esc still closes, Tab comes back in.
  useEffect(() => {
    if (!active) return
    function onDocumentKeyDown(event: globalThis.KeyboardEvent): void {
      const container = ref.current
      if (!container || event.defaultPrevented || !isTop(container)) return
      if (event.target instanceof Node && container.contains(event.target)) return
      if (event.key === 'Escape') {
        event.preventDefault()
        close()
      } else if (event.key === 'Tab' && (event.target === document.body || event.target === null)) {
        event.preventDefault()
        moveTab(container, event.shiftKey)
      }
    }
    document.addEventListener('keydown', onDocumentKeyDown)
    return () => document.removeEventListener('keydown', onDocumentKeyDown)
  }, [active])

  function onKeyDown(event: KeyboardEvent): void {
    const container = ref.current
    if (!active || !container || event.defaultPrevented || !isTop(container)) return
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onClose()
    } else if (event.key === 'Tab' && moveTab(container, event.shiftKey)) {
      event.preventDefault()
    }
  }

  return { ref, onKeyDown }
}
