import { useEffect, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { IconButton } from '../../ui/IconButton'

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
 * Dialog on top of the Settings modal. Esc closes only this dialog: the
 * capture-phase listener stops the event before the modal's own handler.
 */
export function OverlayDialog({
  title,
  testId,
  onClose,
  children,
  footer,
  wide = false,
}: OverlayDialogProps): React.JSX.Element {
  const { t } = useTranslation()
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-2 sm:p-4"
      onClick={(event) => {
        event.stopPropagation()
        onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid={testId}
        onClick={(event) => event.stopPropagation()}
        className={
          'flex max-h-full min-h-0 w-full flex-col overflow-hidden rounded-lg border border-border bg-panel shadow-xl ' +
          (wide ? 'h-[min(92vh,760px)] max-w-3xl' : 'max-h-[min(88vh,640px)] max-w-xl')
        }
      >
        <header className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2.5">
          <h2 className="truncate text-sm font-semibold text-text">{title}</h2>
          <IconButton icon={<X size={16} />} label={t('common.close')} onClick={onClose} />
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        {footer && (
          <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-2.5">
            {footer}
          </footer>
        )}
      </div>
    </div>
  )
}
