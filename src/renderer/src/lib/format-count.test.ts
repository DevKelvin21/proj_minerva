import { describe, expect, it } from 'vitest'
import { COUNT_BADGE_MAX, formatCount } from './format-count'

describe('formatCount', () => {
  it('shows the number up to the cap and "99+" past it', () => {
    expect(formatCount(1)).toBe('1')
    expect(formatCount(COUNT_BADGE_MAX)).toBe('99')
    expect(formatCount(COUNT_BADGE_MAX + 1)).toBe('99+')
  })
})
