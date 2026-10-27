/**
 * Display labels and tones for provider-neutral SCM states (reviewer votes,
 * thread statuses). Pure, so every provider's values render the same way.
 */
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
export function noPatchMessage(reason: 'too_large' | 'diff_budget' | undefined): string {
  if (reason === 'too_large') return 'Diff not shown: the file is too large to diff here.'
  if (reason === 'diff_budget') {
    return 'Diff not shown: this pull request is too large to diff every file. Open it on the provider to see this one.'
  }
  return 'No preview available.'
}

export type ScmTone = 'neutral' | 'accent' | 'success' | 'danger' | 'warning'

export const REVIEWER_VOTE_DISPLAY: Record<ReviewerVote, { label: string; tone: ScmTone }> = {
  approved: { label: 'Approved', tone: 'success' },
  approved_with_suggestions: { label: 'Approved with suggestions', tone: 'success' },
  none: { label: 'No vote yet', tone: 'neutral' },
  changes_requested: { label: 'Changes requested', tone: 'warning' },
  rejected: { label: 'Rejected', tone: 'danger' },
}

export const THREAD_STATUS_LABEL: Record<ThreadStatus, string> = {
  active: 'Active',
  pending: 'Pending',
  resolved: 'Resolved',
  wont_fix: "Won't fix",
  closed: 'Closed',
  by_design: 'By design',
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
export function threadStatusBadge(status: ThreadStatus): { label: string; tone: ScmTone } | null {
  if (status === 'active') return null
  return { label: THREAD_STATUS_LABEL[status], tone: THREAD_STATUS_TONE[status] }
}

/**
 * Banner of a Files tab whose list the provider capped (`filesTruncated`).
 * `total` is the true file count when the provider knows it.
 */
export function truncatedFilesMessage(
  shown: number,
  total: number | null,
  provider: ScmProviderId,
): string {
  const where = 'Open the pull request in ' + SCM_PROVIDER_LABEL[provider] + ' to see the rest.'
  if (total !== null && total > shown) {
    return 'Showing ' + shown + ' of ' + total + ' files: the provider capped the list. ' + where
  }
  return 'Showing the first ' + shown + ' files: the provider capped the list. ' + where
}
