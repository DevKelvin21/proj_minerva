import type { ReactNode, RefObject } from 'react'
import { useModalLayer } from '../../hooks/use-modal-layer'
import { Scrim } from './Scrim'

interface DrawerProps {
  onClose: () => void
  /** Accessible name of the drawer. */
  label: string
  /** Edge it slides from. */
  side: 'left' | 'right'
  /** Painted width (px), already clamped to the container (`drawerWidth` in `lib/layout.ts`). */
  width: number
  /**
   * Render the children inline instead (a wider tier docks the panel): no
   * scrim, no modal behaviour, and the children stay mounted across the switch.
   */
  docked?: boolean
  /** Gets focus on open instead of the first tabbable. */
  initialFocus?: RefObject<HTMLElement | null>
  testId?: string
  children: ReactNode
}

/**
 * Narrow-tier overlay panel (the PR list, the Files tab's file column, the
 * AI panel): the same modal behaviour as `Dialog` (focus in and trapped, Esc
 * and the scrim close it, focus back to the opener), docked to one edge of
 * its positioned container rather than the whole window, so the title bar
 * stays reachable.
 */
export function Drawer({
  onClose,
  label,
  side,
  width,
  docked = false,
  initialFocus,
  testId,
  children,
}: DrawerProps): React.JSX.Element {
  const { ref: layerRef, onKeyDown: onLayerKeyDown } = useModalLayer({
    onClose,
    initialFocus,
    active: !docked,
  })
  // Same element in both modes, so switching tiers never remounts the children.
  return (
    <>
      {!docked && <Scrim onDismiss={onClose} className="z-30" />}
      <div
        ref={layerRef}
        role={docked ? undefined : 'dialog'}
        aria-modal={docked ? undefined : true}
        aria-label={docked ? undefined : label}
        tabIndex={docked ? undefined : -1}
        data-testid={testId}
        onKeyDown={onLayerKeyDown}
        style={docked ? undefined : { width }}
        className={
          docked
            ? 'contents'
            : 'absolute inset-y-0 z-40 flex min-w-0 flex-col bg-panel shadow-2xl outline-none ' +
              (side === 'left' ? 'left-0 border-r border-border' : 'right-0 border-l border-border')
        }
      >
        {children}
      </div>
    </>
  )
}
