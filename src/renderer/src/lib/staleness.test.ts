import { describe, expect, it } from 'vitest'
import { isAnalysisLanguageMismatch, isAnalysisStale } from './staleness'
import type { DidacticAnalysis } from '../../../shared/types'

function analysis(headSha: string): DidacticAnalysis {
  return {
    prId: 'owner/repo#1',
    sections: [],
    generatedAt: '2026-07-07T00:00:00.000Z',
    headSha,
    generatedWith: { provider: 'opencode', model: 'opencode/big-pickle', options: {} },
    language: 'en',
  }
}

describe('isAnalysisStale', () => {
  it('is not stale when the sealed headSha matches the current one', () => {
    expect(isAnalysisStale(analysis('abc123'), 'abc123')).toBe(false)
  })

  it('is stale when the sealed headSha differs from the current one', () => {
    expect(isAnalysisStale(analysis('abc123'), 'def456')).toBe(true)
  })

  it('is not stale when the sealed headSha is empty', () => {
    expect(isAnalysisStale(analysis(''), 'def456')).toBe(false)
  })

  it('is not stale when the current headSha is empty', () => {
    expect(isAnalysisStale(analysis('abc123'), '')).toBe(false)
  })

  it('is not stale when the current headSha is null or undefined', () => {
    expect(isAnalysisStale(analysis('abc123'), null)).toBe(false)
    expect(isAnalysisStale(analysis('abc123'), undefined)).toBe(false)
  })

  it('is not stale when there is no analysis yet', () => {
    expect(isAnalysisStale(null, 'abc123')).toBe(false)
  })
})

describe('isAnalysisLanguageMismatch', () => {
  it('is false when the analysis language matches the UI language', () => {
    expect(isAnalysisLanguageMismatch(analysis('abc123'), 'en')).toBe(false)
  })

  it('is true when the analysis was written in another language', () => {
    expect(isAnalysisLanguageMismatch(analysis('abc123'), 'es')).toBe(true)
    expect(isAnalysisLanguageMismatch({ ...analysis('abc123'), language: 'es' }, 'en')).toBe(true)
  })

  it('is false when there is no analysis yet', () => {
    expect(isAnalysisLanguageMismatch(null, 'es')).toBe(false)
  })
})
