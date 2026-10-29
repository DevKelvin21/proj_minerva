/**
 * Focus rules of the Ask tab's conversation list (a menu of saved
 * conversations). Pure, so the component only maps the result to focus().
 */

/** The row that gets focus when the list opens: the open conversation, else the first (or the last, opened with ArrowUp). */
export function initialConversationIndex(
  ids: readonly string[],
  activeId: string | null,
  from: 'first' | 'last' = 'first',
): number | null {
  if (ids.length === 0) return null
  const active = activeId === null ? -1 : ids.indexOf(activeId)
  if (active >= 0) return active
  return from === 'first' ? 0 : ids.length - 1
}

/**
 * The row that gets focus once the row at `deletedIndex` is gone and
 * `remaining` rows are left: the one that took its place (the next), or the
 * new last row when the last one went; `null` when the list is empty (focus
 * goes back to the toggle).
 */
export function focusIndexAfterDelete(deletedIndex: number, remaining: number): number | null {
  if (remaining <= 0) return null
  return Math.min(Math.max(deletedIndex, 0), remaining - 1)
}
