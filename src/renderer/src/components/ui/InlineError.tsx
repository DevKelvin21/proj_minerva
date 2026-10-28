import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from './Button'
import { IconButton } from './IconButton'

interface InlineErrorProps {
  message: ReactNode
  /** Shows a Retry button; leave it out when there is nothing to retry. */
  onRetry?: () => void
  /** Shows a dismiss (X) button. */
  onDismiss?: () => void
  /** Padding, borders or a background for where it sits. */
  className?: string
  'data-testid'?: string
  'data-error-code'?: string
}

/** One failure, said where it happened, with Retry when it can be retried. */
export function InlineError({
  message,
  onRetry,
  onDismiss,
  className = '',
  ...data
}: InlineErrorProps): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div
      role="alert"
      className={`flex items-start gap-2 text-xs text-danger ${className}`}
      {...data}
    >
      <p className="min-w-0 flex-1 break-words">{message}</p>
      {onRetry && (
        <Button size="xs" onClick={onRetry}>
          {t('common.retry')}
        </Button>
      )}
      {onDismiss && (
        <IconButton
          size="xs"
          onClick={onDismiss}
          label={t('common.dismiss')}
          icon={<X size={12} />}
        />
      )}
    </div>
  )
}
