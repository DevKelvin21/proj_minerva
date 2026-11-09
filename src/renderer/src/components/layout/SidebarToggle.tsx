import { useTranslation } from 'react-i18next'
import { MOD_KEY_LABEL } from '../../lib/platform'
import { useAppStore } from '../../stores/app-store'
import { Icon } from '../ui/Icon'
import { icons } from '../ui/icons'

/** "⌘B" / "CtrlB": the shortcut named next to the toggle. */
export const SIDEBAR_SHORTCUT_LABEL = MOD_KEY_LABEL + 'B'

/**
 * The ONE show/hide control of the PR list, at the sidebar's bottom-left in
 * both states (same 40x36 box, same 8px insets): "Collapse" in the expanded
 * sidebar's footer, "Expand" at the bottom of the rail. Cmd/Ctrl+B and the
 * palette do the same thing (`toggleSidebarPanel`). `testId` is off only
 * for the rail's copy while the drawer covers it, so exactly one
 * `sidebar-toggle` is ever on screen.
 */
export function SidebarToggle({
  expanded,
  testId = true,
}: {
  expanded: boolean
  testId?: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const toggle = useAppStore((s) => s.toggleSidebarPanel)
  const label = expanded
    ? t('layout.sidebar.collapse', { shortcut: SIDEBAR_SHORTCUT_LABEL })
    : t('layout.sidebar.expand', { shortcut: SIDEBAR_SHORTCUT_LABEL })
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      aria-expanded={expanded}
      data-testid={testId ? 'sidebar-toggle' : undefined}
      className="flex h-9 w-10 shrink-0 items-center justify-center rounded-md text-muted transition-colors duration-150 hover:bg-border/60 hover:text-text"
    >
      <Icon icon={expanded ? icons.sidebarCollapse : icons.sidebar} size="md" />
    </button>
  )
}
