import type { DidacticSection } from '../../../shared/types'

/**
 * Tabs of the didactic panel. An analysis has up to seven sections; stacked,
 * they made one long scroll. Grouped by the question they answer:
 * what changed and how to follow it, how the system fits together, what the
 * API gains, and what the data model gains.
 */
export type InsightTab = 'overview' | 'architecture' | 'endpoints' | 'data'

export const INSIGHT_TABS: readonly InsightTab[] = ['overview', 'architecture', 'endpoints', 'data']

const TAB_OF: Record<DidacticSection['kind'], InsightTab> = {
  summary: 'overview',
  walkthrough: 'overview',
  setup: 'overview',
  architecture: 'architecture',
  cloud: 'architecture',
  endpoint: 'endpoints',
  schema: 'data',
}

export function insightTabOf(kind: DidacticSection['kind']): InsightTab {
  return TAB_OF[kind]
}

/** The tabs that have at least one section, in display order. */
export function availableInsightTabs(kinds: readonly DidacticSection['kind'][]): InsightTab[] {
  const present = new Set(kinds.map(insightTabOf))
  return INSIGHT_TABS.filter((tab) => present.has(tab))
}

/**
 * The tab to show: the picked one while it has sections, else the first
 * that has some (a streaming analysis fills tabs one by one, and a
 * re-analysis may drop a tab the reviewer had open).
 */
export function resolveInsightTab(picked: InsightTab, available: readonly InsightTab[]): InsightTab {
  if (available.includes(picked)) return picked
  return available[0] ?? 'overview'
}
