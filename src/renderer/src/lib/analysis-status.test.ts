import { describe, expect, it } from 'vitest'
import { formatModelName, pickAnalysisNotice } from './analysis-status'

describe('pickAnalysisNotice', () => {
  it('prefers new commits over the language', () => {
    expect(pickAnalysisNotice(true, true)).toBe('commits')
    expect(pickAnalysisNotice(true, false)).toBe('commits')
    expect(pickAnalysisNotice(false, true)).toBe('language')
    expect(pickAnalysisNotice(false, false)).toBeNull()
  })
})

describe('formatModelName', () => {
  it('puts the model first, then the provider, then the effort', () => {
    expect(formatModelName('Big Pickle', 'OpenCode')).toBe('Big Pickle · OpenCode')
    expect(formatModelName('Opus', 'Claude Code', 'High')).toBe('Opus · Claude Code · High')
    expect(formatModelName('Opus', 'Claude Code', '')).toBe('Opus · Claude Code')
  })
})
