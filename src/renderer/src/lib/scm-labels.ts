/**
 * Display labels and tones for provider-neutral SCM states (reviewer votes,
 * thread statuses). Pure, so every provider's values render the same way.
 */
import type { ReviewerVote, ScmProviderId, ThreadStatus } from '../../../shared/scm'

export const SCM_PROVIDER_LABEL: Record<ScmProviderId, string> = {
  github: 'GitHub',
  azure: 'Azure DevOps',
}

export type ScmTone = 'neutral' | 'accent' | 'success' | 'danger' | 'warning'

export const REVIEWER_VOTE_DISPLAY: Record<ReviewerVote, { label: string; tone: ScmTone }> = {
  approved: { label: 'Approved', tone: 'success' },
  approved_with_suggestions: { label: 'Approved with suggestions', tone: 'success' },
  none: { label: 'No vote yet', tone: 'neutral' },
  changes_requested: { label: 'Changes requested', tone: 'warning' },
  rejected: { label: 'Rejected', tone: 'danger' },
}

/**
 * Badge for a thread status, or `null` for `active` (the default state needs
 * no badge). `resolved` keeps its existing Spanish label until the i18n pass.
 */
export function threadStatusBadge(status: ThreadStatus): { label: string; tone: ScmTone } | null {
  switch (status) {
    case 'active':
      return null
    case 'pending':
      return { label: 'Pending', tone: 'warning' }
    case 'resolved':
      return { label: 'Resuelto', tone: 'success' }
    case 'wont_fix':
      return { label: "Won't fix", tone: 'neutral' }
    case 'closed':
      return { label: 'Closed', tone: 'neutral' }
    case 'by_design':
      return { label: 'By design', tone: 'neutral' }
  }
}
