import type { ReactNode } from 'react'
import { Dialog } from '../../ui/Dialog'

interface OverlayDialogProps {
  title: string
  testId: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  /** Wide dialogs (the editor) get more room. */
  wide?: boolean
}

/**
 * Dialog on top of the Settings modal (`ui/Dialog`, nested layer). Esc closes
 * only this dialog: it is the topmost layer, so Settings ignores the key.
 */
export function OverlayDialog({
  title,
  testId,
  onClose,
  children,
  footer,
  wide = false,
}: OverlayDialogProps): React.JSX.Element {
  return (
    <Dialog
      onClose={onClose}
      title={title}
      layer="nested"
      testId={testId}
      className={
        'max-h-full w-full ' +
        (wide ? 'h-[min(92vh,760px)] max-w-3xl' : 'max-h-[min(88vh,640px)] max-w-xl')
      }
    >
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      {footer && (
        <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-2.5">
          {footer}
        </footer>
      )}
    </Dialog>
  )
}
