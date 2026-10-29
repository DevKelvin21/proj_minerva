import type { ReactNode } from 'react'
import { RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useLocale } from '../../i18n/use-locale'
import { formatRelativeTime } from '../../lib/relative-time'
import { IconButton } from '../ui/IconButton'
import { Skeleton } from '../ui/Skeleton'
import { HomeBreadcrumb, type Crumb } from './HomeBreadcrumb'
import { ContinueReviewButton } from './HomeShared'

/** The page's one `h1`, in the header's title style (also used by an inline name editor). */
export function PageTitle({
  children,
  text,
}: {
  children: ReactNode
  /** Full text for `title` when it truncates. */
  text?: string
}): React.JSX.Element {
  return (
    <h1 className="min-w-0 truncate text-lg font-semibold leading-7 text-text" title={text}>
      {children}
    </h1>
  )
}

interface HomePageHeaderProps {
  /** Trail above the title, with a back button (absent on the overview). */
  crumbs?: Crumb[]
  onBack?: () => void
  /** Small muted icon before the title (the provider). */
  icon?: ReactNode
  /** The `h1`; `null` while the page's data is on its way (a skeleton stands in). */
  title: ReactNode | null
  titleText?: string
  /** Replaces the `h1` + title (an inline editor that renders its own `PageTitle`). */
  heading?: ReactNode
  /** Short muted line after the title: counts, where the page lives. */
  meta?: ReactNode
  /** Page-specific actions, before the shared ones (Updated, Refresh, Continue). */
  actions?: ReactNode
  fetchedAt: string | null
  busy: boolean
  onRefresh: () => void
  /** The row under the title: totals, filters, progress. */
  children?: ReactNode
}

/**
 * One header for every Home page (overview, repository, feature): the trail
 * and back button, the title with its meta line, then the actions in the
 * same order and place everywhere ("Updated …", Refresh, and "Continue
 * reviewing", the page's only filled button), and an optional row under it.
 * It does not scroll with the page.
 */
export function HomePageHeader({
  crumbs,
  onBack,
  icon,
  title,
  titleText,
  heading,
  meta,
  actions,
  fetchedAt,
  busy,
  onRefresh,
  children,
}: HomePageHeaderProps): React.JSX.Element {
  const { t } = useTranslation()
  const { locale } = useLocale()
  return (
    <header
      data-testid="home-page-header"
      className="flex shrink-0 flex-col gap-2 border-b border-border bg-panel px-4 py-3"
    >
      {crumbs && onBack && <HomeBreadcrumb crumbs={crumbs} onBack={onBack} />}
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-1 basis-56 items-center gap-2">
          {icon && <span className="flex shrink-0 text-muted">{icon}</span>}
          {heading ??
            (title === null ? (
              <>
                <h1 className="sr-only">{t('home.overview.loading')}</h1>
                <Skeleton className="h-6 w-40 max-w-full" />
              </>
            ) : (
              <PageTitle text={titleText}>{title}</PageTitle>
            ))}
          {meta && (
            <span className="min-w-0 shrink truncate text-xs text-muted">{meta}</span>
          )}
        </div>
        <div className="ml-auto flex min-w-0 shrink-0 items-center gap-2">
          {actions}
          {fetchedAt && (
            <span className="hidden whitespace-nowrap text-[11px] text-muted sm:inline" title={fetchedAt}>
              {t('home.overview.updatedAt', { time: formatRelativeTime(fetchedAt, locale) })}
            </span>
          )}
          <IconButton
            size="sm"
            icon={<RefreshCw size={14} className={busy ? 'animate-spin motion-reduce:animate-none' : ''} />}
            label={t('home.overview.refresh')}
            onClick={onRefresh}
            disabled={busy}
          />
          <ContinueReviewButton />
        </div>
      </div>
      {children}
    </header>
  )
}
