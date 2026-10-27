import { describe, expect, it } from 'vitest'
import { formatAbsoluteTime, formatRelativeTime } from './relative-time'

const NOW = Date.parse('2026-10-26T12:00:00Z')

describe('formatRelativeTime', () => {
  it('reads naturally across units (English)', () => {
    expect(formatRelativeTime('2026-10-26T11:59:50Z', 'en', NOW)).toBe('now')
    expect(formatRelativeTime('2026-10-26T11:55:00Z', 'en', NOW)).toBe('5 minutes ago')
    expect(formatRelativeTime('2026-10-26T09:00:00Z', 'en', NOW)).toBe('3 hours ago')
    expect(formatRelativeTime('2026-10-25T12:00:00Z', 'en', NOW)).toBe('yesterday')
    expect(formatRelativeTime('2026-10-12T12:00:00Z', 'en', NOW)).toBe('2 weeks ago')
    expect(formatRelativeTime('2025-10-26T12:00:00Z', 'en', NOW)).toBe('last year')
  })

  it('follows the locale (Spanish)', () => {
    expect(formatRelativeTime('2026-10-26T11:59:50Z', 'es', NOW)).toBe('ahora')
    expect(formatRelativeTime('2026-10-26T11:55:00Z', 'es', NOW)).toBe('hace 5 minutos')
    expect(formatRelativeTime('2026-10-25T12:00:00Z', 'es', NOW)).toBe('ayer')
  })

  it('returns an empty string for an invalid date', () => {
    expect(formatRelativeTime('nope', 'en', NOW)).toBe('')
  })
})

describe('formatAbsoluteTime', () => {
  it('formats in the given locale and passes invalid input through', () => {
    expect(formatAbsoluteTime('2026-10-26T12:00:00Z', 'en')).toMatch(/Oct/)
    expect(formatAbsoluteTime('2026-10-26T12:00:00Z', 'es')).toMatch(/oct/)
    expect(formatAbsoluteTime('nope', 'en')).toBe('nope')
  })
})
