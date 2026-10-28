import type { ReactNode } from 'react'
import { ArrowRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ScmListError } from '../../../../shared/types'
import { SCM_PROVIDER_LABEL } from '../../lib/scm-labels'
import { useAppStore } from '../../stores/app-store'
import { Skeleton } from '../ui/Skeleton'
import { Callout } from '../ui/Callout'

/**
 * "Continue reviewing #n": back to the review that stayed mounted (hidden)
 * when the user came Home, with its tab, file, layer and comment drafts.
 * Renders nothing without a selected PR.
 */
export function ContinueReviewButton(): React.JSX.Element | null {
  const { t } = useTranslation()
  const selectedPr = useAppStore((s) => s.selectedPr)
  const showReview = useAppStore((s) => s.showReview)
  if (!selectedPr) return null
  return (
    <button
      type="button"
      data-testid="continue-review"
      onClick={showReview}
      title={t('home.overview.continueReviewTitle', {
        number: selectedPr.number,
        title: selectedPr.title,
      })}
      className="inline-flex max-w-[16rem] items-center gap-1 rounded-md border border-accent/50 bg-accent/10 px-2 py-1 text-xs font-medium text-accent transition-colors duration-150 hover:bg-accent/20"
    >
      <span className="truncate">
        {t('home.overview.continueReview', { number: selectedPr.number })}
      </span>
      <ArrowRight size={12} aria-hidden className="shrink-0" />
    </button>
  )
}

/** One line per provider that failed while the others still answered (typed code + message). */
export function ProviderErrorList({ errors }: { errors: readonly ScmListError[] }): React.JSX.Element | null {
  const { t } = useTranslation()
  if (errors.length === 0) return null
  return (
    <Callout tone="danger">
      <div className="flex flex-col gap-1">
        {errors.map((providerError) => (
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
      {hint && <p className="min-w-0 text-[11px] text-muted/80">{hint}</p>}
      {trailing && <div className="ml-auto flex shrink-0 items-center gap-2">{trailing}</div>}
    </div>
  )
}

/** Grey placeholder blocks while the first dashboard answer is on its way. */
export function CardSkeleton({ count }: { count: number }): React.JSX.Element {
  return (
    <div aria-hidden className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-3">
      {Array.from({ length: count }, (_, index) => (
        <Skeleton key={index} className="h-24" />
      ))}
    </div>
  )
}
