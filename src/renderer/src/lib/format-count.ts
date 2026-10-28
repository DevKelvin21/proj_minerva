/** Past this a count badge shows "99+": the exact number stays in the parent's label. */
export const COUNT_BADGE_MAX = 99

export function formatCount(count: number): string {
  return count > COUNT_BADGE_MAX ? `${COUNT_BADGE_MAX}+` : String(count)
}
