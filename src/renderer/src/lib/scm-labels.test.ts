import { beforeAll, describe, expect, it } from 'vitest'
import i18next, { type TFunction } from 'i18next'
import { en } from '../i18n/locales/en'
import { es } from '../i18n/locales/es'
import {
  noPatchMessage,
  REVIEWER_VOTE_TONE,
  reviewDecisionLabelKey,
  reviewerVoteLabel,
  threadStatusBadge,
  truncatedFilesMessage,
} from './scm-labels'

let t: TFunction
let tEs: TFunction

beforeAll(async () => {
  const instance = i18next.createInstance()
  await instance.init({
    lng: 'en',
    resources: { en: { translation: en }, es: { translation: es } },
    interpolation: { escapeValue: false },
  })
  t = instance.getFixedT('en')
  tEs = instance.getFixedT('es')
})

describe('scm-labels', () => {
  it('has a tone for every reviewer vote that reads right, and a label', () => {
    expect(REVIEWER_VOTE_TONE.approved).toBe('success')
    expect(REVIEWER_VOTE_TONE.approved_with_suggestions).toBe('success')
    expect(REVIEWER_VOTE_TONE.changes_requested).toBe('warning')
    expect(REVIEWER_VOTE_TONE.rejected).toBe('danger')
    expect(REVIEWER_VOTE_TONE.none).toBe('neutral')
    expect(reviewerVoteLabel('approved_with_suggestions', t)).toBe('Approved with suggestions')
    expect(reviewerVoteLabel('changes_requested', tEs)).toBe('Cambios solicitados')
    // Azure's own term for a -5 vote.
    expect(reviewerVoteLabel('changes_requested', t, 'azure')).toBe('Waiting for author')
    expect(reviewerVoteLabel('changes_requested', tEs, 'azure')).toBe('Esperando al autor')
    expect(reviewerVoteLabel('rejected', t, 'azure')).toBe('Rejected')
  })

  it('shows no badge for active threads and one for every other status', () => {
    expect(threadStatusBadge('active', t)).toBeNull()
    for (const status of ['pending', 'resolved', 'wont_fix', 'closed', 'by_design'] as const) {
      expect(threadStatusBadge(status, t)?.label).toBeTruthy()
    }
  })

  it('labels resolved threads in the active language', () => {
    expect(threadStatusBadge('resolved', t)).toEqual({ label: 'Resolved', tone: 'success' })
    expect(threadStatusBadge('resolved', tEs)).toEqual({ label: 'Resuelto', tone: 'success' })
  })

  it('says how many files a capped PR shows, and where to see the rest', () => {
    expect(truncatedFilesMessage(300, 412, 'azure', t)).toBe(
      'Showing 300 of 412 files: the provider capped the list. Open the pull request in Azure DevOps to see the rest.',
    )
    expect(truncatedFilesMessage(300, null, 'github', t)).toMatch(/^Showing the first 300 files/)
    expect(truncatedFilesMessage(300, 412, 'github', tEs)).toMatch(
      /^Se muestran 300 de 412 archivos/,
    )
  })

  it('explains why a file has no diff', () => {
    expect(noPatchMessage('too_large', t)).toBe(
      'Diff not shown: the file is too large to diff here.',
    )
    expect(noPatchMessage(undefined, t)).toBe('No preview available.')
  })

  it("labels the PR-list review chip in each provider's terms", () => {
    expect(t(reviewDecisionLabelKey('changes_requested', 'github'))).toBe('Changes requested')
    expect(t(reviewDecisionLabelKey('changes_requested', 'azure'))).toBe('Waiting for author')
    expect(t(reviewDecisionLabelKey('rejected', 'azure'))).toBe('Rejected')
    expect(tEs(reviewDecisionLabelKey('review_required', 'azure'))).toBe('Revisión pendiente')
  })
})
