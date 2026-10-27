/** Sections of the command palette. */
export type PaletteGroup = 'commands' | 'pullRequests' | 'files'

/** Listing order: jumping somewhere is the palette's main job, commands come last. */
export const PALETTE_GROUPS: readonly PaletteGroup[] = ['pullRequests', 'files', 'commands']

export interface PaletteItem {
  /** Unique across the whole palette (the option's DOM id derives from it). */
  id: string
  group: PaletteGroup
  label: string
  /** Second line: repo, path, branch… Searched too. */
  detail?: string
  /** Extra words that match but are not shown (synonyms, the PR number). */
  keywords?: string
  /** Keyboard hint shown on the right, e.g. "⌘B". */
  shortcut?: string
  run: () => void
}

/** How many entries each group shows (the list stays a glance, not a scroll). */
export const PALETTE_GROUP_LIMIT: Record<PaletteGroup, number> = {
  commands: 8,
  pullRequests: 8,
  files: 8,
}

function tokensOf(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean)
}

/**
 * Items whose text contains EVERY word of the query (case-insensitive; a
 * leading `#` is ignored, so `#103` finds PR 103). Within a group, items
 * whose label alone matches come first; otherwise the input order (the
 * caller's relevance) is kept. Each group is capped at its limit.
 */
export function filterPaletteItems(
  items: readonly PaletteItem[],
  query: string,
  limits: Record<PaletteGroup, number> = PALETTE_GROUP_LIMIT,
): PaletteItem[] {
  const tokens = tokensOf(query).map((token) => token.replace(/^#(?=.)/, ''))
  const result: PaletteItem[] = []
  for (const group of PALETTE_GROUPS) {
    const ranked = items
      .filter((item) => item.group === group)
      .map((item, index) => {
        const label = item.label.toLowerCase()
        const haystack = [label, item.detail ?? '', item.keywords ?? ''].join('\n').toLowerCase()
        if (!tokens.every((token) => haystack.includes(token))) return null
        const labelHit = tokens.length > 0 && tokens.every((token) => label.includes(token))
        return { item, index, rank: labelHit ? 0 : 1 }
      })
      .filter((entry): entry is { item: PaletteItem; index: number; rank: number } => entry !== null)
      .sort((a, b) => a.rank - b.rank || a.index - b.index)
    result.push(...ranked.slice(0, limits[group]).map((entry) => entry.item))
  }
  return result
}

/** The next active index for an arrow key, wrapping at both ends. */
export function stepIndex(current: number, delta: 1 | -1, length: number): number {
  if (length === 0) return 0
  return (current + delta + length) % length
}
