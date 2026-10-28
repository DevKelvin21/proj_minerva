import type { ReactNode } from 'react'
import { ArrowRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ScmListError } from '../../../../shared/types'
import { uniqueProviderErrors } from '../../lib/dashboard'
import { SCM_PROVIDER_LABEL } from '../../lib/scm-labels'
import { useAppStore } from '../../stores/app-store'
import { Button } from '../ui/Button'
import { EmptyState } from '../ui/EmptyState'
import { Skeleton } from '../ui/Skeleton'
import { Callout } from '../ui/Callout'

/**
 * "Continue reviewing #n": back to the review that stayed mounted (hidden)
 * when the user came Home, with its tab, file, layer and comment drafts.
 * The one filled button of every Home page. Renders nothing without a
 * selected PR.
 */
export function ContinueReviewButton(): React.JSX.Element | null {
  const { t } = useTranslation()
  const selectedPr = useAppStore((s) => s.selectedPr)
  const showReview = useAppStore((s) => s.showReview)
  if (!selectedPr) return null
  return (
    <Button
      variant="primary"
      size="sm"
      data-testid="continue-review"
      onClick={showReview}
      title={t('home.overview.continueReviewTitle', {
        number: selectedPr.number,
        title: selectedPr.title,
      })}
      className="max-w-[16rem]"
    >
      <span className="min-w-0 truncate">
        {t('home.overview.continueReview', { number: selectedPr.number })}
      </span>
      <ArrowRight size={12} aria-hidden className="shrink-0" />
    </Button>
  )
}

/**
 * One line per provider that failed while the others still answered (typed
 * code + message). A provider listed by several fetches (PRs and stacks) is
 * said once.
 */
export function ProviderErrorList({ errors }: { errors: readonly ScmListError[] }): React.JSX.Element | null {
  const { t } = useTranslation()
  const unique = uniqueProviderErrors(errors)
  if (unique.length === 0) return null
  return (
    <Callout tone="danger">
      <div className="flex flex-col gap-1">
        {unique.map((providerError) => (
          <p key={providerError.provider} data-error-code={providerError.code}>
            {t('home.overview.providerError', {
              provider: SCM_PROVIDER_LABEL[providerError.provider],
              message: providerError.message,
            })}
          </p>
        ))}
      </div>
    </Callout>
  )
}

/** Section title + hint, with optional right-aligned extras. */
export function SectionHeading({
  title,
  hint,
  trailing,
}: {
  title: string
  hint?: string
  trailing?: ReactNode
}): React.JSX.Element {
  return (
    <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</h2>
      {hint && <p className="min-w-0 text-[11px] text-muted">{hint}</p>}
      {trailing && <div className="ml-auto flex shrink-0 items-center gap-2">{trailing}</div>}
    </div>
  )
}

/** Grey placeholder blocks while the first dashboard answer is on its way. */
export function CardSkeleton({ count, className = 'h-24' }: { count: number; className?: string }): React.JSX.Element {
  return (
    <div aria-hidden className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-3">
      {Array.from({ length: count }, (_, index) => (
        <Skeleton key={index} className={className} />
      ))}
    </div>
  )
}

/** The loading state of every Home page: one status line and the card skeleton. */
export function PageSkeleton({ hint }: { hint?: string }): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-4">
      <div role="status" className="flex flex-col gap-1 text-xs text-muted">
        <p>{t('home.overview.loading')}</p>
        {hint && <p>{hint}</p>}
      </div>
      <CardSkeleton count={6} />
    </div>
  )
}

/** The whole-page empty state of a Home page (nothing enabled, signed out, gone). */
export function PageEmpty(props: React.ComponentProps<typeof EmptyState> & { 'data-testid'?: string }): React.JSX.Element {
  const { 'data-testid': testId, ...rest } = props
  return (
    <div data-testid={testId} className="py-10">
      <EmptyState {...rest} />
    </div>
  )
}

/** A section with nothing to list: the same quiet box on every Home page. */
export function SectionEmpty({ title, hint }: { title: string; hint?: string }): React.JSX.Element {
  return (
    <div className="rounded-lg border border-dashed border-border py-5">
      <EmptyState compact title={title} hint={hint} />
    </div>
  )
}
