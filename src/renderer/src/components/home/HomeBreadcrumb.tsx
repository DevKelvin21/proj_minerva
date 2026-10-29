import type { ReactNode } from 'react'
import { ArrowLeft, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { IconButton } from '../ui/IconButton'

export interface Crumb {
  key: string
  label: ReactNode
  /** Plain-text version for `title` (the label may carry markup). */
  text: string
  /** Absent = context only (where the page lives), not a place to go. */
  onClick?: () => void
}

/**
 * "← Home › contoso / Platform": the back button and the trail above a page
 * title (`HomePageHeader`). Crumbs with `onClick` are buttons, the others
 * say where the page lives (the page itself is the title below); each one
 * truncates on narrow panes. No border or band of its own: it is the first
 * line of the page header.
 */
export function HomeBreadcrumb({
  crumbs,
  onBack,
}: {
  crumbs: Crumb[]
  onBack: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <nav
      aria-label={t('home.breadcrumb.ariaLabel')}
      className="-ml-1 flex min-w-0 items-center gap-1 text-xs"
    >
      <IconButton
        size="xs"
        icon={<ArrowLeft size={13} />}
        label={t('home.breadcrumb.back')}
        onClick={onBack}
        data-testid="home-back"
      />
      <ol className="flex min-w-0 flex-1 items-center gap-1">
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
                  className="min-w-0 truncate rounded px-0.5 text-muted transition-colors duration-150 hover:text-text"
                >
                  {crumb.label}
                </button>
              ) : (
                <span
                  title={crumb.text}
                  className="min-w-0 truncate px-0.5 text-muted"
                >
                  {crumb.label}
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
