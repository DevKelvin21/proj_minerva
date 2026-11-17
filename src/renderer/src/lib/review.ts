/**
 * Pure helpers for the Review control (`pr-detail/ReviewControl.tsx`): which
 * verdicts to offer, which one starts selected, whether the form can be sent,
 * and what a refused review means (by typed SCM code). Main re-validates
 * everything before writing (`main/scm/review.ts`); this only drives the form.
 */
import {
  REVIEW_VERDICTS,
  reviewVerdictNeedsBody,
  type ReviewVerdict,
  type ScmErrorCode,
  type ScmProviderId,
} from '../../../shared/scm'
import { decodeScmErrorMessage } from '../../../shared/scm-errors'
import type { PullRequestDetail } from '../../../shared/types'

/** The i18n sub-key of a verdict: Azure DevOps calls a -5 vote "Wait for author". */
export type ReviewVerdictKey = ReviewVerdict | 'changes_requestedAzure'

export function reviewVerdictKey(
  verdict: ReviewVerdict,
  provider: ScmProviderId,
): ReviewVerdictKey {
  return verdict === 'changes_requested' && provider === 'azure'
    ? 'changes_requestedAzure'
    : verdict
}

export interface VerdictOption {
  verdict: ReviewVerdict
  /** `own`: GitHub refuses a vote on your own PR (a plain comment is fine). */
  disabledReason: 'own' | null
}

/** Every verdict the PR's provider knows, in its order, with what rules one out. */
export function reviewVerdictOptions(pr: PullRequestDetail): VerdictOption[] {
  const ownGithubPr = pr.repo.provider === 'github' && pr.viewer?.isAuthor === true
  return REVIEW_VERDICTS[pr.repo.provider].map((verdict) => ({
    verdict,
    disabledReason: ownGithubPr && verdict !== 'comment' ? 'own' : null,
  }))
}

/** The verdict the form starts on: Approve when the user may vote, else a comment. */
export function initialReviewVerdict(pr: PullRequestDetail): ReviewVerdict {
  const approve = reviewVerdictOptions(pr).find((option) => option.verdict === 'approved')
  return approve && approve.disabledReason === null ? 'approved' : 'comment'
}

/** Whether the summary is enough for the verdict (main checks it again). */
export function canSubmitReview(
  provider: ScmProviderId,
  verdict: ReviewVerdict,
  body: string,
): boolean {
  return !reviewVerdictNeedsBody(provider, verdict) || body.trim().length > 0
}

export type ReviewFailureReason = 'stale' | 'forbidden' | 'signIn' | 'other'

export interface ReviewFailure {
  code: ScmErrorCode | null
  /** Main's own text (already without the `[SCM:CODE]` marker). */
  detail: string
  reason: ReviewFailureReason
  /** The PR changed behind the UI: refetch it before trying again. */
  shouldRefresh: boolean
}

/** Our explanation of a refused review; the component translates `reason`. */
export function describeReviewError(error: unknown): ReviewFailure {
  const raw = error instanceof Error ? error.message : String(error)
  const { code, message } = decodeScmErrorMessage(raw)
  const failure = (reason: ReviewFailureReason, shouldRefresh = false): ReviewFailure => ({
    code,
    detail: message.replace(/^Error invoking remote method '[^']*': (?:\w*Error: )?/, ''),
    reason,
    shouldRefresh,
  })
  switch (code) {
    case 'CONFLICT':
      return failure('stale', true)
    case 'FORBIDDEN':
      return failure('forbidden')
    case 'UNAUTHENTICATED':
    case 'CLI_UNAVAILABLE':
      return failure('signIn')
    default:
      return failure('other')
  }
}
