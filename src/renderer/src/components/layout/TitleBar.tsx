import { useState } from 'react'
import { GraduationCap, PanelLeft, Search, Settings, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '../../stores/app-store'
import { useLayoutTier } from '../../hooks/use-layout-tier'
import { sidebarIsDrawer } from '../../lib/layout'
import { useSettings } from '../../hooks/use-settings'
import { useUpdater } from '../../hooks/use-updater'
import { getModelOption } from '../../../../shared/ai-providers'
import { resolveModelHintLabels } from '../../lib/model-labels'
import { IconButton } from '../ui/IconButton'
import { ScmAuthChips, ScmConnectionIndicator, type AuthChipDensity } from './ScmAuthChips'

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
  const { t } = useTranslation()
  const openSettings = useAppStore((s) => s.openSettings)
  const { info } = useSettings()
  const { status: updaterStatus } = useUpdater()

  const showUpdateBadge =
    updaterStatus?.phase === 'available' || updaterStatus?.phase === 'downloaded'
  const updateDot = showUpdateBadge ? (
    <span
      className="pointer-events-none absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-accent ring-2 ring-panel"
      aria-hidden
      title={t('layout.settingsChip.updateAvailable')}
    />
  ) : null

  // Compacto (F16/T83): en ventanas angostas el chip vuelve a ser solo el
  // engrane — el texto "Proveedor · Modelo" es lo primero que sobra cuando el
  // TitleBar no da para todo. El icono `lucide-settings` NUNCA sale del botón
  // (los specs e2e localizan Settings por `svg.lucide-settings`).
  if (!info || compact) {
    return (
      <span className="relative inline-flex">
        <IconButton
          icon={<Settings size={16} />}
          label={t('layout.settingsChip.settings')}
          onClick={openSettings}
        />
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

  const source = t(`layout.settingsChip.modelSource.${info.modelSource}`)
  const title = effortLabel
    ? t('layout.settingsChip.titleWithEffort', {
        provider: providerLabel,
        model: info.model,
        effort: effortLabel,
        source,
      })
    : t('layout.settingsChip.title', { provider: providerLabel, model: info.model, source })

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

/**
 * Barra superior. Divulgación progresiva por tier (F16/T83) — el orden en que
 * se sacrifica el contenido cuando la ventana se angosta al tilearla:
 *
 * 1. `lg`: el TEXTO del estado de conexión (queda el punto de color + title)
 *    y el badge "via …" de cada proveedor (queda la identidad).
 * 2. `md`: el chip de Settings pierde su texto "Proveedor · Modelo" (queda el
 *    engrane) y aparece el botón de la lista
 *    de PRs (que en ese tier pasa a drawer, ver `Sidebar`); cada chip de
 *    proveedor queda en su icono + punto de estado (todo lo demás en el title).
 * 3. `sm`: el buscador colapsa a un icono que despliega el campo sobre la
 *    barra, y el nombre "Minerva" cede el paso al logo.
 *
 * Con la ventana baja (`short`/`xshort`) la barra pasa de `h-12` a `h-9`: son
 * 12px que en 540px de alto se notan en el contenido de abajo.
 */
export function TitleBar(): React.JSX.Element {
  const { t } = useTranslation()
  const searchQuery = useAppStore((s) => s.searchQuery)
  const setSearchQuery = useAppStore((s) => s.setSearchQuery)
  const didacticPanelOpen = useAppStore((s) => s.didacticPanelOpen)
  const toggleDidacticPanel = useAppStore((s) => s.toggleDidacticPanel)
  const sidebarOpen = useAppStore((s) => s.sidebarOpen)
  const toggleSidebar = useAppStore((s) => s.toggleSidebar)
  const tier = useLayoutTier()
  const [searchExpanded, setSearchExpanded] = useState(false)

  const showDrawerToggle = sidebarIsDrawer(tier.w)
  const compact = tier.w === 'md' || tier.w === 'sm'
  const collapseSearch = tier.w === 'sm'
  const showConnectionLabel = tier.w === 'xl'
  const authDensity: AuthChipDensity =
    tier.w === 'xl' ? 'full' : tier.w === 'lg' ? 'identity' : 'icon'

  const searchInput = (
    <input
      type="search"
      value={searchQuery}
      onChange={(e) => setSearchQuery(e.target.value)}
      placeholder={t('layout.titleBar.searchPlaceholder')}
      aria-label={t('layout.titleBar.searchPrs')}
      title={t('layout.titleBar.searchPlaceholder')}
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
          label={t('layout.titleBar.prListToggle')}
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
          label={t('layout.titleBar.searchPrs')}
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
            label={t('layout.titleBar.closeSearch')}
            onClick={() => setSearchExpanded(false)}
          />
        </div>
      )}

      <div className="ml-auto flex min-w-0 items-center gap-2">
        <SettingsChip compact={compact} />

        <ScmAuthChips density={authDensity} />

        <ScmConnectionIndicator showLabel={showConnectionLabel} />

        <IconButton
          icon={<GraduationCap size={16} />}
          label={t('layout.titleBar.didacticPanel')}
          active={didacticPanelOpen}
          onClick={toggleDidacticPanel}
        />
      </div>
    </header>
  )
}
