/**
 * One look for every segmented control (Queue | Inbox, Unread | All, Ask |
 * Analysis, Open | Closed | All, the repo page's viewer filter): a sunken
 * track and an accent-filled selected segment. Each control keeps its own
 * semantics (toggle buttons with `aria-pressed`, or roving tabs) and layout;
 * only the track and the segment states come from here.
 */

export const SEGMENTED_TRACK = 'rounded-md border border-border bg-bg p-0.5'

const SEGMENT_BASE = 'rounded text-xs font-medium transition-colors duration-150'

export function segmentClasses(selected: boolean): string {
  return `${SEGMENT_BASE} ${
    selected ? 'bg-accent/15 text-accent' : 'text-muted hover:bg-border/60 hover:text-text'
  }`
}
