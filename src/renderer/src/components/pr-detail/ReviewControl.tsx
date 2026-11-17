import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ReviewVerdict } from '../../../../shared/scm'
import type { PullRequestDetail } from '../../../../shared/types'
import {
  canSubmitReview,
  describeReviewError,
  initialReviewVerdict,
  reviewVerdictKey,
  reviewVerdictOptions,
  type ReviewFailure,
} from '../../lib/review'
import { reviewerVoteLabel } from '../../lib/scm-labels'
import { MOD_KEY_LABEL } from '../../lib/platform'
import { useAppStore } from '../../stores/app-store'
import { Button } from '../ui/Button'
import { Callout } from '../ui/Callout'
import { Radio } from '../ui/Checkbox'
import { Icon } from '../ui/Icon'
import { icons, type IconGlyph } from '../ui/icons'
import { Kbd } from '../ui/Kbd'
import { Spinner } from '../ui/Spinner'
import { TextArea } from '../ui/TextArea'

/** Cmd/Ctrl+Enter submits from the summary box. Decorative (`Kbd`). */
const SUBMIT_SHORTCUT = MOD_KEY_LABEL + '↵'

interface ReviewControlProps {
  pr: PullRequestDetail
  /** Narrow bar: the trigger shows its icon only. */
  compact: boolean
}

/** The trigger's glyph and color for the user's own standing vote. */
function voteLook(pr: PullRequestDetail): { icon: IconGlyph; className: string } {
  switch (pr.viewer?.vote) {
    case 'approved':
    case 'approved_with_suggestions':
      return { icon: icons.approved, className: 'text-success' }
    case 'changes_requested':
      return { icon: icons.changesRequested, className: 'text-warning' }
    case 'rejected':
      return { icon: icons.error, className: 'text-danger' }
    default:
      return { icon: icons.review, className: '' }
  }
}

/**
 * The Review control in the PR bar, next to Merge (T3 Code's review
 * composer): a verdict (Approve / Request changes / Comment; Azure DevOps
 * also Approve with suggestions and Reject), an optional summary, and Submit
 * review. Main re-checks the PR, asks with a native dialog before a vote and
 * writes; this control never writes on its own. The trigger shows the user's
 * own standing vote.
 *
 * Remounted per PR by `PrHeader` (`key`), so a draft never leaks to another PR.
 */
export function ReviewControl({ pr, compact }: ReviewControlProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverId = useId()

  // Outside click and Escape close the popover (focus back on the trigger for Escape).
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      setOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  if (pr.state !== 'open') return null

  const vote = pr.viewer?.vote
  const voted = vote !== undefined && vote !== 'none'
  const label = voted ? reviewerVoteLabel(vote, t, pr.repo.provider) : t('prDetail.review.review')
  const title = voted
    ? t('prDetail.review.yourVote', { vote: reviewerVoteLabel(vote, t, pr.repo.provider) })
    : t('prDetail.review.review')
  const look = voteLook(pr)

  return (
    <div ref={wrapperRef} className="relative shrink-0" data-no-drag>
      <Button
        ref={triggerRef}
        variant="secondary"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        aria-label={compact ? title : undefined}
        title={title}
        onClick={() => setOpen((value) => !value)}
        data-testid="review-trigger"
        data-vote={vote ?? 'unknown'}
        icon={<Icon icon={look.icon} size="sm" className={look.className} />}
      >
        {!compact && label}
      </Button>
      {open && (
        <div
          id={popoverId}
          role="dialog"
          aria-label={t('prDetail.review.title', { number: pr.number })}
          className="absolute right-0 z-30 mt-2 flex max-h-[75vh] w-[23rem] max-w-[calc(100vw-2rem)] flex-col gap-3 overflow-y-auto rounded-lg border border-border bg-panel p-4 text-left shadow-2xl"
          data-testid="review-popover"
        >
          <ReviewPanel pr={pr} onSubmitted={() => setOpen(false)} />
        </div>
      )}
    </div>
  )
}

interface ReviewPanelProps {
  pr: PullRequestDetail
  onSubmitted: () => void
}

/**
 * The form. It stays mounted only while the popover is open; the summary
 * draft lives here, so closing the popover after a refusal keeps nothing
 * stale, and a refusal keeps the draft for another try.
 */
function ReviewPanel({ pr, onSubmitted }: ReviewPanelProps): React.JSX.Element {
  const { t } = useTranslation()
  const provider = pr.repo.provider
  const options = reviewVerdictOptions(pr)
  const [verdict, setVerdict] = useState<ReviewVerdict>(() => initialReviewVerdict(pr))
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<ReviewFailure | null>(null)
  const [summaryFailed, setSummaryFailed] = useState(false)
  const bumpScmData = useAppStore((s) => s.bumpScmData)
  const replaceSelectedPr = useAppStore((s) => s.replaceSelectedPr)
  const groupName = useId()
  const summaryId = useId()

  const selectedDisabled = options.find((option) => option.verdict === verdict)?.disabledReason
  const ready = !busy && !selectedDisabled && canSubmitReview(provider, verdict, body)
  const bodyRequired = !canSubmitReview(provider, verdict, '')
  const isVote = verdict !== 'comment'

  async function submit(): Promise<void> {
    if (!ready) return
    setBusy(true)
    setFailure(null)
    setSummaryFailed(false)
    try {
      const result = await window.minerva.scm.submitReview({
        repo: pr.repo,
        number: pr.number,
        expectedHeadSha: pr.headSha,
        verdict,
        body,
      })
      if (result.outcome === 'cancelled') return
      if (result.pr) replaceSelectedPr(result.pr)
      bumpScmData()
      // The vote stands but the summary did not post: say so and keep the draft.
      if (result.summaryFailed) setSummaryFailed(true)
      else onSubmitted()
    } catch (err: unknown) {
      const described = describeReviewError(err)
      setFailure(described)
      if (described.shouldRefresh) bumpScmData()
    } finally {
      setBusy(false)
    }
  }

  const ownVote = pr.viewer?.vote

  return (
    <>
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="text-sm font-semibold text-text">
          {t('prDetail.review.title', { number: pr.number })}
        </p>
        <p className="font-mono text-[11px] text-muted">
          {t('prDetail.review.head', { sha: pr.headSha.slice(0, 7) })}
        </p>
        {ownVote && ownVote !== 'none' && (
          <p className="text-xs text-muted" data-testid="review-current-vote">
            {t('prDetail.review.yourVote', {
              vote: reviewerVoteLabel(ownVote, t, provider),
            })}
          </p>
        )}
      </div>
      {failure && (
        <Callout
          tone="danger"
          role="alert"
          data-testid="review-failure"
          data-reason={failure.reason}
        >
          <p className="font-medium">{t(`prDetail.review.failures.${failure.reason}`)}</p>
          <p className="text-muted">{failure.detail}</p>
        </Callout>
      )}
      {summaryFailed && (
        <Callout tone="warning" role="alert" data-testid="review-summary-failed">
          {t('prDetail.review.summaryFailed')}
        </Callout>
      )}
      <fieldset className="flex flex-col gap-1.5" disabled={busy}>
        <legend className="pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
          {t('prDetail.review.verdictLabel')}
        </legend>
        {options.map((option) => {
          const key = reviewVerdictKey(option.verdict, provider)
          return (
            <Radio
              key={option.verdict}
              name={groupName}
              value={option.verdict}
              checked={verdict === option.verdict}
              disabled={option.disabledReason !== null}
              onChange={() => setVerdict(option.verdict)}
              label={t(`prDetail.review.verdict.${key}`)}
              hint={
                option.disabledReason === 'own'
                  ? t('prDetail.review.ownPullRequest')
                  : t(`prDetail.review.verdictHint.${key}`)
              }
              data-verdict={option.verdict}
            />
          )
        })}
      </fieldset>
      <label htmlFor={summaryId} className="sr-only">
        {t('prDetail.review.summaryLabel')}
      </label>
      <TextArea
        id={summaryId}
        rows={3}
        value={body}
        disabled={busy}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            void submit()
          }
        }}
        placeholder={
          bodyRequired ? t('prDetail.review.summaryRequired') : t('prDetail.review.summaryOptional')
        }
        className="resize-y"
        data-testid="review-summary"
      />
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Kbd>{SUBMIT_SHORTCUT}</Kbd>
        <Button
          variant="primary"
          disabled={!ready}
          onClick={() => void submit()}
          icon={busy ? <Spinner size="xs" /> : <Icon icon={icons.review} size="sm" />}
          data-testid="review-submit"
        >
          {busy ? t('prDetail.review.submitting') : t('prDetail.review.submit')}
        </Button>
      </div>
      {isVote && <p className="text-[11px] text-muted">{t('prDetail.review.confirmNote')}</p>}
    </>
  )
}
