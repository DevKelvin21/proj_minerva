/**
 * Display labels and tones for provider-neutral SCM states (reviewer votes,
 * thread statuses). Pure, so every provider's values render the same way.
 */
import type { TFunction } from 'i18next'
import type { ReviewerVote, ScmProviderId, ThreadStatus } from '../../../shared/scm'

export const SCM_PROVIDER_LABEL: Record<ScmProviderId, string> = {
  github: 'GitHub',
  azure: 'Azure DevOps',
}

/**
 * Provider of a comment/PR web URL, for labels ("Copy URL of the comment on
 * Azure DevOps"). Only a display hint: the URL always comes from main.
 */
export function providerOfWebUrl(url: string): ScmProviderId {
  try {
    const host = new URL(url).hostname
    return host === 'dev.azure.com' || host.endsWith('.visualstudio.com') ? 'azure' : 'github'
  } catch {
    return 'github'
  }
}

/** Why a changed text file shows no diff (`DiffFile.patchOmitted`), or the generic fallback. */
export function noPatchMessage(reason: 'too_large' | 'diff_budget' | undefined, t: TFunction): string {
  if (reason === 'too_large') return t('prDetail.diff.tooLarge')
  if (reason === 'diff_budget') return t('prDetail.diff.overBudget')
  return t('prDetail.diff.noPreview')
}

export type ScmTone = 'neutral' | 'accent' | 'success' | 'danger' | 'warning'

export const REVIEWER_VOTE_TONE: Record<ReviewerVote, ScmTone> = {
  approved: 'success',
  approved_with_suggestions: 'success',
  none: 'neutral',
  changes_requested: 'warning',
  rejected: 'danger',
}

/** Display label of a reviewer vote, in the active UI language. */
export function reviewerVoteLabel(vote: ReviewerVote, t: TFunction): string {
  return t(`prDetail.reviewerVote.${vote}`)
}

/** Display label of a thread status, in the active UI language. */
export function threadStatusLabel(status: ThreadStatus, t: TFunction): string {
  return t(`comments.threadStatus.${status}`)
}

export const THREAD_STATUS_TONE: Record<ThreadStatus, ScmTone> = {
  active: 'accent',
  pending: 'warning',
  resolved: 'success',
  wont_fix: 'neutral',
  closed: 'neutral',
  by_design: 'neutral',
}

/** Badge for a thread status, or `null` for `active` (the default state needs no badge). */
export function threadStatusBadge(
  status: ThreadStatus,
  t: TFunction,
): { label: string; tone: ScmTone } | null {
  if (status === 'active') return null
  return { label: threadStatusLabel(status, t), tone: THREAD_STATUS_TONE[status] }
}

/**
 * Banner of a Files tab whose list the provider capped (`filesTruncated`).
 * `total` is the true file count when the provider knows it.
 */
export function truncatedFilesMessage(
  shown: number,
  total: number | null,
  provider: ScmProviderId,
  t: TFunction,
): string {
  const vars = { shown, provider: SCM_PROVIDER_LABEL[provider] }
  if (total !== null && total > shown) {
    return t('prDetail.files.truncatedOfTotal', { ...vars, total })
  }
  return t('prDetail.files.truncatedFirst', vars)
}
