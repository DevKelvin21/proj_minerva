import type { ReactNode } from 'react'
import { ArrowLeft, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { IconButton } from '../ui/IconButton'

export interface Crumb {
  key: string
  label: ReactNode
  /** Plain-text version for `title` (the label may carry markup). */
  text: string
  /** Absent = the current page (not clickable). */
  onClick?: () => void
}

/**
 * "Home › repo › …" trail with a back button. Every crumb but the last is a
 * button; the trail truncates from the middle on narrow panes.
 */
export function HomeBreadcrumb({
  crumbs,
  onBack,
  trailing,
}: {
  crumbs: Crumb[]
  onBack: () => void
  /** Right-aligned extras (refresh, counts). */
  trailing?: ReactNode
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <nav
      aria-label={t('home.breadcrumb.ariaLabel')}
      className="flex min-w-0 shrink-0 items-center gap-1 border-b border-border px-3 py-1.5"
    >
      <IconButton
        icon={<ArrowLeft size={16} />}
        label={t('home.breadcrumb.back')}
        onClick={onBack}
        data-testid="home-back"
      />
      <ol className="flex min-w-0 flex-1 items-center gap-1 text-sm">
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1
          return (
            <li key={crumb.key} className="flex min-w-0 items-center gap-1">
              {index > 0 && <ChevronRight size={12} className="shrink-0 text-muted/60" aria-hidden />}
              {crumb.onClick && !last ? (
                <button
                  type="button"
                  onClick={crumb.onClick}
                  title={crumb.text}
                  className="min-w-0 truncate rounded px-1 text-muted transition-colors duration-150 hover:text-text"
                >
                  {crumb.label}
                </button>
              ) : (
                <span
                  aria-current={last ? 'page' : undefined}
                  title={crumb.text}
                  className="min-w-0 truncate px-1 font-medium text-text"
                >
                  {crumb.label}
                </span>
              )}
            </li>
          )
        })}
      </ol>
      {trailing && <div className="ml-auto flex shrink-0 items-center gap-1">{trailing}</div>}
    </nav>
  )
}
