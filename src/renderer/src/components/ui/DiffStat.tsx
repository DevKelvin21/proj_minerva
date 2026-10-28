import { useTranslation } from 'react-i18next'

const sizeClasses = {
  xs: 'text-[10px]',
  sm: 'text-[11px]',
  md: 'text-xs',
}

const PLUS = '+'
/** U+2212: a real minus sign, the width of the plus. */
const MINUS = '−'

interface DiffStatProps {
  additions: number
  deletions: number
  /** `xs` fits a dense card, `sm` a file row, `md` a toolbar. */
  size?: keyof typeof sizeClasses
  className?: string
}

/**
 * Lines added/removed as `+n −n` (status colors, mono). Screen readers get
 * the sentence ("6 additions, 2 deletions") instead of "+6 -2".
 */
export function DiffStat({
  additions,
  deletions,
  size = 'sm',
  className = '',
}: DiffStatProps): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 font-mono tabular-nums ${sizeClasses[size]} ${className}`}
    >
      <span aria-hidden className="text-success">
        {PLUS}
        {additions}
      </span>
      <span aria-hidden className="text-danger">
        {MINUS}
        {deletions}
      </span>
      <span className="sr-only">{t('diffStat.summary', { additions, deletions })}</span>
    </span>
  )
}
