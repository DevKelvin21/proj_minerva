import { useState } from 'react'
import { GraduationCap, PanelLeft, Search, Settings, X } from 'lucide-react'
import { useAppStore } from '../../stores/app-store'
import { useConnectionStatus } from '../../hooks/use-connection-status'
import { useScmAuth } from '../../hooks/use-scm-auth'
import { useLayoutTier } from '../../hooks/use-layout-tier'
import { sidebarIsDrawer } from '../../lib/layout'
import { useSettings } from '../../hooks/use-settings'
import { useUpdater } from '../../hooks/use-updater'
import { getModelOption } from '../../../../shared/ai-providers'
import { resolveModelHintLabels } from '../../lib/model-labels'
import { IconButton } from '../ui/IconButton'
import { Badge } from '../ui/Badge'

/**
 * Chip resumen "Proveedor · Modelo" en el engrane de Settings (T63, F12):
 * reemplaza el botón cuadrado de solo-icono para que la config vigente sea
 * visible SIN abrir el modal (pedido de Edilson, ver `PLAN.md` § F12).
 * SIEMPRE mantiene el icono `Settings` de `lucide-react` DENTRO del botón —
 * los specs e2e (`e2e/settings.spec.ts`, `e2e/scm-access.spec.ts`) localizan
 * el engrane por `svg.lucide-settings`, no
 * puede sacarse de acá — y agrega el texto recién cuando `useSettings().info`
 * ya cargó (antes de eso solo el icono, igual que el `IconButton` viejo).
 *
 * Los labels salen de `resolveModelHintLabels` (extraída a
 * `lib/model-labels.ts` en T62 para que este chip, `ActiveConfigSummary` del
 * modal y `ActiveModelHint` del panel didáctico nunca diverjan) y de
 * `getModelOption` para el label humano del modelo (`info.model` crudo si no
 * está en el catálogo, p. ej. un slug "avanzado" de OpenCode).
 *
 * `useSettings()` ya cachea la selección en el store zustand compartido con
 * `SettingsModal` — abrir/cerrar el modal no dispara un fetch nuevo, y un
 * cambio hecho ahí se refleja acá al instante (mismo estado).
 *
 * Badge discreto (T93, F17): un punto sobre el engrane cuando
 * `UpdaterStatus.phase` es `available` o `downloaded` — mismo patrón visual
 * que el dot de "no leído" de `PrListItem` (`h-1.5 w-1.5 rounded-full`), solo
 * que posicionado `absolute` en la esquina del botón para no sumar ancho: en
 * el tier `sm` la TitleBar no tiene lugar para nada más que este punto (F16),
 * nunca un banner.
 */
function SettingsChip({ compact }: { compact: boolean }): React.JSX.Element {
  const openSettings = useAppStore((s) => s.openSettings)
  const { info } = useSettings()
  const { status: updaterStatus } = useUpdater()

  const showUpdateBadge =
    updaterStatus?.phase === 'available' || updaterStatus?.phase === 'downloaded'
  const updateDot = showUpdateBadge ? (
    <span
      className="pointer-events-none absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-accent ring-2 ring-panel"
      aria-hidden
      title="Hay una actualización disponible"
    />
  ) : null

  // Compacto (F16/T83): en ventanas angostas el chip vuelve a ser solo el
  // engrane — el texto "Proveedor · Modelo" es lo primero que sobra cuando el
  // TitleBar no da para todo. El icono `lucide-settings` NUNCA sale del botón
  // (los specs e2e localizan Settings por `svg.lucide-settings`).
  if (!info || compact) {
    return (
      <span className="relative inline-flex">
        <IconButton icon={<Settings size={16} />} label="Configuración" onClick={openSettings} />
        {updateDot}
      </span>
    )
  }

  const modelLabel = getModelOption(info.catalog, info.provider, info.model)?.label ?? info.model
  const effortValue = info.selectedOptions?.[info.provider]?.effort
  const { providerLabel, effortLabel } = resolveModelHintLabels(
    info.catalog,
    info.provider,
    info.model,
    effortValue,
  )

  const title =
    'Configuración — ' +
    providerLabel +
    ' · ' +
    info.model +
    (effortLabel ? ' · Razonamiento: ' + effortLabel : '') +
    ' · origen ' +
    info.modelSource

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        title={title}
        aria-label={title}
        onClick={openSettings}
        className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-muted transition-colors duration-150 hover:border-accent hover:text-text"
      >
        <Settings size={16} />
        <span className="text-xs">
          {providerLabel} · {modelLabel}
        </span>
      </button>
      {updateDot}
    </span>
  )
}

const CONNECTION_LABEL: Record<ReturnType<typeof useConnectionStatus>, string> = {
  connected: 'Conectado',
  error: 'Sin conexión',
  checking: 'Comprobando…',
}

/**
 * GitHub auth chip, from `scm:getAuthStatus` (the `gh` token bridge):
 * - `signed_in`: login + discreet "via GitHub CLI" badge + Settings shortcut
 *   (there is no sign-out: the session belongs to `gh`, not Minerva).
 * - `cli_unavailable`: `gh` not on PATH — short text + Settings button.
 * - `cli_unauthenticated`: copyable `gh auth login` chip + spinner; the
 *   declarative poll in `use-scm-auth.ts` notices when the user finishes the
 *   login in a terminal.
 * Azure DevOps gets its own chip in Phase 2; today it's always `disabled`.
 */
function AuthControls(): React.JSX.Element | null {
  const { statuses } = useScmAuth()
  const openSettings = useAppStore((s) => s.openSettings)
  const status = statuses?.github

  if (status === undefined || status.state === 'disabled') return null

  if (status.state === 'signed_in') {
    return (
      <div className="flex min-w-0 items-center gap-2 text-xs">
        <span className="max-w-[120px] truncate text-text">{status.user?.login}</span>
        <Badge tone="neutral">via GitHub CLI</Badge>
        <IconButton
          icon={<Settings size={13} />}
          label="Access is managed by GitHub CLI; change the account in Settings"
          onClick={openSettings}
        />
      </div>
    )
  }

  if (status.state === 'cli_unavailable') {
    return (
      <div className="flex items-center gap-2 text-xs">
        <span className="text-muted">GitHub CLI not found</span>
        <button
          type="button"
          onClick={openSettings}
          className="rounded-md border border-border px-2 py-1 text-muted transition-colors duration-150 hover:border-accent hover:text-text"
        >
          Open settings
        </button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 text-xs" title={status.detail}>
      <span
        className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-accent border-t-transparent"
        aria-hidden
      />
      <button
        type="button"
        title="Copy command"
        onClick={() => void navigator.clipboard?.writeText('gh auth login').catch(() => {})}
        className="rounded-md border border-accent/50 bg-accent/10 px-2 py-1 font-mono text-sm font-semibold text-accent transition-colors duration-150 hover:bg-accent/20"
      >
        gh auth login
      </button>
      <span className="text-muted">Waiting for session…</span>
    </div>
  )
}

/**
 * Barra superior. Divulgación progresiva por tier (F16/T83) — el orden en que
 * se sacrifica el contenido cuando la ventana se angosta al tilearla:
 *
 * 1. `lg`: el TEXTO del estado de conexión (queda el punto de color + title).
 * 2. `md`: el chip de Settings pierde su texto "Proveedor · Modelo" (queda el
 *    engrane) y aparece el botón de la lista
 *    de PRs (que en ese tier pasa a drawer, ver `Sidebar`).
 * 3. `sm`: el buscador colapsa a un icono que despliega el campo sobre la
 *    barra, y el nombre "Minerva" cede el paso al logo.
 *
 * Con la ventana baja (`short`/`xshort`) la barra pasa de `h-12` a `h-9`: son
 * 12px que en 540px de alto se notan en el contenido de abajo.
 */
export function TitleBar(): React.JSX.Element {
  const searchQuery = useAppStore((s) => s.searchQuery)
  const setSearchQuery = useAppStore((s) => s.setSearchQuery)
  const didacticPanelOpen = useAppStore((s) => s.didacticPanelOpen)
  const toggleDidacticPanel = useAppStore((s) => s.toggleDidacticPanel)
  const sidebarOpen = useAppStore((s) => s.sidebarOpen)
  const toggleSidebar = useAppStore((s) => s.toggleSidebar)
  const connectionStatus = useConnectionStatus()
  const tier = useLayoutTier()
  const [searchExpanded, setSearchExpanded] = useState(false)

  const showDrawerToggle = sidebarIsDrawer(tier.w)
  const compact = tier.w === 'md' || tier.w === 'sm'
  const collapseSearch = tier.w === 'sm'
  const showConnectionLabel = tier.w === 'xl'

  const searchInput = (
    <input
      type="search"
      value={searchQuery}
      onChange={(e) => setSearchQuery(e.target.value)}
      placeholder="Search by title, repo, branch or #number"
      aria-label="Search pull requests"
      title="Search by title, repo, branch or #number"
      className="w-full rounded-md border border-border bg-bg py-1 pl-8 pr-3 text-sm text-text placeholder:text-muted transition-colors duration-150 focus:border-accent"
    />
  )

  return (
    <header
      className={`relative flex ${
        tier.h === 'tall' ? 'h-12' : 'h-9'
      } shrink-0 items-center gap-2 border-b border-border bg-panel px-3`}
    >
      {showDrawerToggle && (
        <IconButton
          icon={<PanelLeft size={16} />}
          label="Lista de PRs"
          active={sidebarOpen}
          onClick={toggleSidebar}
        />
      )}

      <span className="flex shrink-0 items-center gap-1.5 text-sm font-semibold text-text">
        <span aria-hidden>🦉</span>
        {!collapseSearch && 'Minerva'}
      </span>

      {collapseSearch ? (
        <IconButton
          icon={<Search size={16} />}
          label="Buscar PRs"
          active={searchQuery.length > 0}
          onClick={() => setSearchExpanded(true)}
        />
      ) : (
        <div className="relative ml-2 min-w-0 max-w-md flex-1">
          <Search
            size={14}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"
          />
          {searchInput}
        </div>
      )}

      {/* Buscador desplegado sobre la barra en `sm`: el campo necesita el ancho
          entero, y en ese tier no queda ancho que compartir. */}
      {collapseSearch && searchExpanded && (
        <div className="absolute inset-x-2 z-30 flex items-center gap-1 rounded-md bg-panel">
          <div className="relative min-w-0 flex-1">
            <Search
              size={14}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"
            />
            {searchInput}
          </div>
          <IconButton
            icon={<X size={16} />}
            label="Cerrar búsqueda"
            onClick={() => setSearchExpanded(false)}
          />
        </div>
      )}

      <div className="ml-auto flex min-w-0 items-center gap-2">
        <SettingsChip compact={compact} />

        <AuthControls />

        <span
          className="flex shrink-0 items-center gap-1.5 text-xs text-muted"
          title={`Estado de la conexión IPC con el proceso principal: ${CONNECTION_LABEL[connectionStatus]}`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              connectionStatus === 'connected'
                ? 'bg-success'
                : connectionStatus === 'error'
                  ? 'bg-danger'
                  : 'bg-warning'
            }`}
          />
          {showConnectionLabel && CONNECTION_LABEL[connectionStatus]}
        </span>

        <IconButton
          icon={<GraduationCap size={16} />}
          label="Panel didáctico"
          active={didacticPanelOpen}
          onClick={toggleDidacticPanel}
        />
      </div>
    </header>
  )
}
