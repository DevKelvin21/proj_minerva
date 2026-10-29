/**
 * Pages of the Settings dialog: which exist, how the left list groups them,
 * which one a request lands on, and which carry a status dot. Pure, so the
 * modal, the store and the call sites that open Settings agree.
 */
import type { ScmProviderId } from '../../../shared/scm'
import type { AiProviderStatus, UpdaterStatus } from '../../../shared/types'
import type { WidthTier } from './layout'
import type { ProviderAuthView } from './scm-connection'

export const SETTINGS_PAGE_IDS = [
  'general',
  'appearance',
  'github',
  'azure',
  'ai-providers',
  'ai-model',
  'notifications',
  'updates',
] as const

export type SettingsPageId = (typeof SETTINGS_PAGE_IDS)[number]

/** Heading of a block of the page list; `null` = the ungrouped pages at the top. */
export type SettingsPageGroup = 'sourceControl' | 'ai' | 'app'

export const SETTINGS_PAGE_GROUP: Record<SettingsPageId, SettingsPageGroup | null> = {
  general: null,
  appearance: null,
  github: 'sourceControl',
  azure: 'sourceControl',
  'ai-providers': 'ai',
  'ai-model': 'ai',
  notifications: 'app',
  updates: 'app',
}

export const DEFAULT_SETTINGS_PAGE: SettingsPageId = 'general'

export function isSettingsPageId(value: unknown): value is SettingsPageId {
  return typeof value === 'string' && (SETTINGS_PAGE_IDS as readonly string[]).includes(value)
}

/** Pages shown in the list. Updates only while the updater is not `disabled` (dev, e2e, unpackaged). */
export function visibleSettingsPages(options: { updates: boolean }): SettingsPageId[] {
  return SETTINGS_PAGE_IDS.filter((id) => id !== 'updates' || options.updates)
}

/** The page to paint: the requested one while it is listed, else the default. */
export function resolveSettingsPage(
  requested: SettingsPageId,
  visible: readonly SettingsPageId[],
): SettingsPageId {
  return visible.includes(requested) ? requested : DEFAULT_SETTINGS_PAGE
}

export interface SettingsNavSection {
  group: SettingsPageGroup | null
  pages: SettingsPageId[]
}

/** The visible pages in list order, cut into blocks by group (one block per run of a group). */
export function settingsNavSections(visible: readonly SettingsPageId[]): SettingsNavSection[] {
  const sections: SettingsNavSection[] = []
  for (const page of visible) {
    const group = SETTINGS_PAGE_GROUP[page]
    const last = sections[sections.length - 1]
    if (last && last.group === group) last.pages.push(page)
    else sections.push({ group, pages: [page] })
  }
  return sections
}

/** The Settings page about a source-control provider (its sign-in chips and hints open it). */
export function settingsPageForScm(provider: ScmProviderId): SettingsPageId {
  return provider === 'github' ? 'github' : 'azure'
}

/**
 * Page list and page side by side from `lg` up; below (a window tiled to half
 * a 1080p screen or less) the list and one page take turns.
 */
export function settingsSplitView(tier: WidthTier): boolean {
  return tier === 'xl' || tier === 'lg'
}

export type SettingsDot = 'warning' | 'accent'

export interface SettingsDotInput {
  /** Enabled source-control providers and their readiness (`useProviderAuthViews`). */
  scm: readonly ProviderAuthView[] | null
  /** Status of the ACTIVE AI provider; `undefined` while it is being checked. */
  activeAiStatus: AiProviderStatus | undefined
  updater: UpdaterStatus | null
}

const NEEDS_USER: ReadonlySet<ProviderAuthView['readiness']> = new Set([
  'signed_out',
  'cli_unavailable',
  'not_configured',
])

/** Same rule as the title bar's Settings dot: a version to download, or one waiting to install on quit. */
export function updateAvailable(status: UpdaterStatus | null): boolean {
  return status?.phase === 'available' || status?.phase === 'downloaded'
}

/**
 * Dots of the page list, only from state the app already has: a warning on
 * a source-control page whose provider is on but not ready (the same states
 * the accounts menu flags), on AI › Providers while the active provider is
 * not signed in, and an accent dot on Updates when a newer version exists.
 */
export function settingsPageDots(
  input: SettingsDotInput,
): Partial<Record<SettingsPageId, SettingsDot>> {
  const dots: Partial<Record<SettingsPageId, SettingsDot>> = {}
  for (const view of input.scm ?? []) {
    if (NEEDS_USER.has(view.readiness)) dots[settingsPageForScm(view.provider)] = 'warning'
  }
  if (input.activeAiStatus && input.activeAiStatus.status !== 'authenticated') {
    dots['ai-providers'] = 'warning'
  }
  if (updateAvailable(input.updater)) dots.updates = 'accent'
  return dots
}
