import { describe, expect, it } from 'vitest'
import { formatRelativeTime } from './relative-time'

const NOW = Date.parse('2026-10-26T12:00:00Z')

describe('formatRelativeTime', () => {
  it('reads naturally across units', () => {
    expect(formatRelativeTime('2026-10-26T11:59:50Z', NOW)).toBe('just now')
    expect(formatRelativeTime('2026-10-26T11:55:00Z', NOW)).toBe('5 minutes ago')
    expect(formatRelativeTime('2026-10-26T09:00:00Z', NOW)).toBe('3 hours ago')
    expect(formatRelativeTime('2026-10-25T12:00:00Z', NOW)).toBe('yesterday')
    expect(formatRelativeTime('2026-10-12T12:00:00Z', NOW)).toBe('2 weeks ago')
    expect(formatRelativeTime('2025-10-26T12:00:00Z', NOW)).toBe('last year')
  })

  it('returns an empty string for an invalid date', () => {
    expect(formatRelativeTime('nope', NOW)).toBe('')
  })
})
