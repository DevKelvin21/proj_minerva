import { describe, expect, it } from 'vitest'
import { REVIEWER_VOTE_DISPLAY, threadStatusBadge, truncatedFilesMessage } from './scm-labels'

describe('scm-labels', () => {
  it('has a label for every reviewer vote, with tones that read right', () => {
    expect(REVIEWER_VOTE_DISPLAY.approved.tone).toBe('success')
    expect(REVIEWER_VOTE_DISPLAY.approved_with_suggestions.tone).toBe('success')
    expect(REVIEWER_VOTE_DISPLAY.changes_requested.tone).toBe('warning')
    expect(REVIEWER_VOTE_DISPLAY.rejected.tone).toBe('danger')
    expect(REVIEWER_VOTE_DISPLAY.none.tone).toBe('neutral')
  })

  it('shows no badge for active threads and one for every other status', () => {
    expect(threadStatusBadge('active')).toBeNull()
    for (const status of ['pending', 'resolved', 'wont_fix', 'closed', 'by_design'] as const) {
      expect(threadStatusBadge(status)?.label).toBeTruthy()
    }
  })

  it('labels resolved threads in English', () => {
    expect(threadStatusBadge('resolved')).toEqual({ label: 'Resolved', tone: 'success' })
  })

  it('says how many files a capped PR shows, and where to see the rest', () => {
    expect(truncatedFilesMessage(300, 412, 'azure')).toBe(
      'Showing 300 of 412 files: the provider capped the list. Open the pull request in Azure DevOps to see the rest.',
    )
    expect(truncatedFilesMessage(300, null, 'github')).toMatch(/^Showing the first 300 files/)
  })
})
