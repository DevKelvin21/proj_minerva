import { useId, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useModalLayer } from '../../hooks/use-modal-layer'
import { IconButton } from './IconButton'
import { Scrim } from './Scrim'

interface DialogProps {
  onClose: () => void
  /** Visible heading: a header with it and a close button, and the dialog's name. */
  title?: ReactNode
  /** Accessible name when there is no visible title (the command palette). */
  label?: string
  /** Name of the header's close button; "Close" by default. */
  closeLabel?: string
  /** A click on the scrim closes the dialog (default `true`). */
  dismissible?: boolean
  /** Gets focus on open instead of the first tabbable. */
  initialFocus?: RefObject<HTMLElement | null>
  /** `top`: anchored near the top (the palette) instead of centered. */
  placement?: 'center' | 'top'
  /** `nested` stacks over another dialog (a dialog opened from Settings). */
  layer?: 'base' | 'nested'
  /** Size of the card (`w-full max-w-xl …`). */
  className?: string
  testId?: string
  /** Runs before the dialog's own keys; `preventDefault()` claims the key. */
  onKeyDown?: (event: KeyboardEvent) => void
  children: ReactNode
}

/**
 * Modal dialog over the whole window (WAI-ARIA APG): `role="dialog"` named
 * by its title, focus moved in on open and trapped while open, Esc and a
 * click on the scrim close it, and focus returns to whatever opened it
 * (`useModalLayer`). Rendered in place, not portaled: a dialog inside the
 * review hides with it when home is on screen.
 */
export function Dialog({
  onClose,
  title,
  label,
  closeLabel,
  dismissible = true,
  initialFocus,
  placement = 'center',
  layer = 'base',
  className = '',
  testId,
  onKeyDown,
  children,
}: DialogProps): React.JSX.Element {
  const { t } = useTranslation()
  const titleId = useId()
  const { ref: layerRef, onKeyDown: onLayerKeyDown } = useModalLayer({ onClose, initialFocus })
  const hasTitle = title !== undefined

  return (
    <div
      className={
        'app-no-drag fixed inset-0 flex justify-center ' +
        (layer === 'nested' ? 'z-[60] ' : 'z-50 ') +
        (placement === 'top' ? 'items-start px-4 pt-16' : 'items-center p-2 sm:p-4')
      }
    >
      <Scrim onDismiss={dismissible ? onClose : undefined} />
      <div
        ref={layerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={hasTitle ? titleId : undefined}
        aria-label={hasTitle ? undefined : label}
        tabIndex={-1}
        data-testid={testId}
        onKeyDown={(event) => {
          onKeyDown?.(event)
          onLayerKeyDown(event)
        }}
        className={
          'relative flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-panel shadow-xl outline-none ' +
          className
        }
      >
        {hasTitle && (
          <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-2.5">
            <h2 id={titleId} className="min-w-0 truncate text-sm font-semibold text-text">
              {title}
            </h2>
            <IconButton
              icon={<X size={16} />}
              label={closeLabel ?? t('common.close')}
              onClick={onClose}
            />
          </header>
        )}
        {children}
      </div>
    </div>
  )
}
