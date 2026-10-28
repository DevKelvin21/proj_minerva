import type { KeyboardEvent } from 'react'
import { rovingTarget } from '../lib/roving-focus'

interface RovingTabsOptions<K extends string> {
  keys: readonly K[]
  value: K
  onChange: (key: K) => void
  /** DOM id of a tab (also what its panel points back to). */
  tabId: (key: K) => string
  /** DOM id of the tab's panel, when the panels are rendered with `panelProps`. */
  panelId?: (key: K) => string
}

export interface RovingTabProps {
  id: string
  role: 'tab'
  'aria-selected': boolean
  'aria-controls'?: string
  tabIndex: 0 | -1
  onClick: () => void
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void
}

export interface RovingPanelProps {
  id: string
  role: 'tabpanel'
  'aria-labelledby': string
  hidden: boolean
}

/**
 * A tablist with automatic activation (WAI-ARIA APG): one Tab stop (the
 * selected tab), Left/Right move focus AND switch with wrap-around, Home/End
 * jump to the ends. The component keeps its own look; it spreads
 * `tabProps(key)` on each tab button and `panelProps(key)` on each panel.
 */
export function useRovingTabs<K extends string>({
  keys,
  value,
  onChange,
  tabId,
  panelId,
}: RovingTabsOptions<K>): {
  tabProps: (key: K) => RovingTabProps
  panelProps: (key: K) => RovingPanelProps
} {
  function tabProps(key: K): RovingTabProps {
    return {
      id: tabId(key),
      role: 'tab',
      'aria-selected': key === value,
      ...(panelId ? { 'aria-controls': panelId(key) } : {}),
      tabIndex: key === value ? 0 : -1,
      onClick: () => onChange(key),
      onKeyDown: (event) => {
        const target = rovingTarget(event.key, keys.indexOf(key), keys.length, 'horizontal')
        if (target === null) return
        event.preventDefault()
        const next = keys[target]
        onChange(next)
        event.currentTarget.ownerDocument.getElementById(tabId(next))?.focus()
      },
    }
  }

  function panelProps(key: K): RovingPanelProps {
    return {
      id: panelId ? panelId(key) : `${tabId(key)}-panel`,
      role: 'tabpanel',
      'aria-labelledby': tabId(key),
      hidden: key !== value,
    }
  }

  return { tabProps, panelProps }
}
