import { describe, expect, it } from 'vitest'
import { focusIndexAfterDelete, initialConversationIndex } from './conversation-list'

describe('initialConversationIndex', () => {
  const ids = ['a', 'b', 'c']
  it('opens on the open conversation', () => {
    expect(initialConversationIndex(ids, 'b')).toBe(1)
    expect(initialConversationIndex(ids, 'b', 'last')).toBe(1)
  })
  it('falls back to the first, or the last when opened upward', () => {
    expect(initialConversationIndex(ids, null)).toBe(0)
    expect(initialConversationIndex(ids, 'gone')).toBe(0)
    expect(initialConversationIndex(ids, null, 'last')).toBe(2)
  })
  it('has nothing to focus in an empty list', () => {
    expect(initialConversationIndex([], 'a')).toBeNull()
  })
})

describe('focusIndexAfterDelete', () => {
  it('moves to the row that took the deleted one’s place', () => {
    expect(focusIndexAfterDelete(0, 2)).toBe(0)
    expect(focusIndexAfterDelete(1, 2)).toBe(1)
  })
  it('moves to the new last row when the last one went', () => {
    expect(focusIndexAfterDelete(2, 2)).toBe(1)
  })
  it('returns null when nothing is left', () => {
    expect(focusIndexAfterDelete(0, 0)).toBeNull()
  })
})
