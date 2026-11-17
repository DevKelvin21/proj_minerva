import { describe, expect, it } from 'vitest'
import { githubRepo } from '../../../shared/scm-guards'
import type { AzureRepoRef } from '../../../shared/scm'
import type { PullRequestDetail } from '../../../shared/types'
import {
  canSubmitReview,
  describeReviewError,
  initialReviewVerdict,
  reviewVerdictKey,
  reviewVerdictOptions,
} from './review'

const az: AzureRepoRef = {
  provider: 'azure',
  organization: 'contoso',
  project: 'Platform',
  name: 'orders-api',
  repositoryId: '11111111-1111-4111-8111-111111111111',
  fullName: 'contoso/Platform/orders-api',
}

function pr(overrides: Partial<PullRequestDetail> = {}): PullRequestDetail {
  return {
    repo: githubRepo('acme', 'api'),
    viewer: { isAuthor: false, reviewer: 'required', vote: 'none' },
    ...overrides,
  } as PullRequestDetail
}

describe('review helpers', () => {
  it('GitHub offers comment / approve / request changes, starting on Approve', () => {
    expect(reviewVerdictOptions(pr())).toEqual([
      { verdict: 'comment', disabledReason: null },
      { verdict: 'approved', disabledReason: null },
      { verdict: 'changes_requested', disabledReason: null },
    ])
    expect(initialReviewVerdict(pr())).toBe('approved')
  })

  it('your own GitHub PR: only a comment, and the form starts there', () => {
    const own = pr({ viewer: { isAuthor: true, reviewer: null } })
    expect(
      reviewVerdictOptions(own)
        .filter((o) => o.disabledReason === 'own')
        .map((o) => o.verdict),
    ).toEqual(['approved', 'changes_requested'])
    expect(initialReviewVerdict(own)).toBe('comment')
  })

  it('Azure DevOps: five verdicts, the author may vote, -5 reads "wait for author"', () => {
    const azPr = pr({ repo: az, viewer: { isAuthor: true, reviewer: null } })
    expect(reviewVerdictOptions(azPr).map((o) => o.verdict)).toEqual([
      'comment',
      'approved',
      'approved_with_suggestions',
      'changes_requested',
      'rejected',
    ])
    expect(reviewVerdictOptions(azPr).every((o) => o.disabledReason === null)).toBe(true)
    expect(initialReviewVerdict(azPr)).toBe('approved')
    expect(reviewVerdictKey('changes_requested', 'azure')).toBe('changes_requestedAzure')
    expect(reviewVerdictKey('changes_requested', 'github')).toBe('changes_requested')
  })

  it('a summary is required for a comment and for GitHub request changes only', () => {
    expect(canSubmitReview('github', 'approved', '')).toBe(true)
    expect(canSubmitReview('github', 'comment', '  ')).toBe(false)
    expect(canSubmitReview('github', 'comment', 'x')).toBe(true)
    expect(canSubmitReview('github', 'changes_requested', '')).toBe(false)
    expect(canSubmitReview('azure', 'changes_requested', '')).toBe(true)
    expect(canSubmitReview('azure', 'rejected', '')).toBe(true)
  })

  it("explains refusals by typed code, without Electron's wrapper", () => {
    const stale = describeReviewError(
      new Error(
        "Error invoking remote method 'scm:submitReview': Error: [SCM:CONFLICT] New commits were pushed",
      ),
    )
    expect(stale).toMatchObject({
      reason: 'stale',
      shouldRefresh: true,
      detail: 'New commits were pushed',
    })
    expect(describeReviewError(new Error('[SCM:FORBIDDEN] no')).reason).toBe('forbidden')
    expect(describeReviewError(new Error('[SCM:UNAUTHENTICATED] no')).reason).toBe('signIn')
    expect(describeReviewError(new Error('boom')).reason).toBe('other')
  })
})
