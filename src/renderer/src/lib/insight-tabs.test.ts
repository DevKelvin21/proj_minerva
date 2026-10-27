import { describe, expect, it } from 'vitest'
import { availableInsightTabs, insightTabOf, resolveInsightTab } from './insight-tabs'

describe('insight tabs', () => {
  it('groups every section kind under one tab', () => {
    expect(insightTabOf('summary')).toBe('overview')
    expect(insightTabOf('walkthrough')).toBe('overview')
    expect(insightTabOf('setup')).toBe('overview')
    expect(insightTabOf('architecture')).toBe('architecture')
    expect(insightTabOf('cloud')).toBe('architecture')
    expect(insightTabOf('endpoint')).toBe('endpoints')
    expect(insightTabOf('schema')).toBe('data')
  })

  it('lists only the tabs that have sections, in display order', () => {
    expect(availableInsightTabs(['schema', 'summary', 'cloud'])).toEqual([
      'overview',
      'architecture',
      'data',
    ])
    expect(availableInsightTabs([])).toEqual([])
  })

  it('keeps the picked tab while it has sections, else falls back to the first', () => {
    expect(resolveInsightTab('data', ['overview', 'data'])).toBe('data')
    expect(resolveInsightTab('endpoints', ['overview', 'data'])).toBe('overview')
    expect(resolveInsightTab('endpoints', [])).toBe('overview')
  })
})
