import { ExternalLink, GraduationCap, MessageCircle, Sparkles, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAppStore, type AiPanelTab } from '../../stores/app-store'
import { prKey } from '../../../../shared/scm'
import { useLayoutTier } from '../../hooks/use-layout-tier'
import {
  clampDidacticWidth,
  DIDACTIC_PANEL_DEFAULT_WIDTH,
  DIDACTIC_PANEL_MIN_WIDTH,
  DRAWER_WIDTH,
  drawerWidth,
  sidebarFootprint,
} from '../../lib/layout'
import { Drawer } from '../ui/Drawer'
import { IconButton } from '../ui/IconButton'
import { ResizeHandle } from '../ui/ResizeHandle'
import { DidacticAnalysisArea } from '../didactic/DidacticAnalysisArea'
import { DidacticPlaceholder } from '../didactic/DidacticPlaceholder'
import { AskTab } from '../chat/AskTab'
import { useRovingTabs, type RovingTabProps } from '../../hooks/use-roving-tabs'

const AI_PANEL_TABS: readonly AiPanelTab[] = ['ask', 'analysis']

/**
 * Right-hand AI panel, two tabs: **Ask** (default; the side-panel chat,
 * `components/chat/`) and **Analysis** (the didactic analysis below). The
 * chosen tab is remembered (`aiPanelTab`). Both stay mounted while the panel
 * is open, so switching keeps a half-typed question and a streaming analysis.
 * The detached window (`#didactic/…`) shows the analysis only.
 *
 * Panel didáctico (F3): resumen + diagramas Mermaid (C4/ER) + snippets
 * copiables de endpoint, generados por `ai:analyzePullRequest`. Detrás de
 * un `AiService` mock por ahora (T9 mock/T10); la implementación real con
 * Anthropic se enchufa detrás de la misma interfaz en T9-final.
 *
 * Sin PR seleccionado: placeholder con el botón "Analizar PR" deshabilitado.
 * Con PR seleccionado: `DidacticAnalysisArea` (keyed por `selectedPr.id`, ver
 * ahí por qué) maneja loading/error/análisis/placeholder habilitado, además
 * del hint del modelo activo y el botón "Re-analizar" (T14, se muestran
 * junto al contenido en cuanto hay un resultado, no en este header estático).
 *
 * "Abrir en ventana" (T14, icono `ExternalLink`) solo aparece con un PR
 * seleccionado: pide `window:openDidactic`, que abre (o reenfoca, si ya hay
 * una) la ventana didáctica desacoplada sobre el MISMO análisis (cacheado o
 * en curso — T22, `useDidacticAnalysis` se engancha al streaming en la
 * ventana nueva si el análisis todavía no terminó). Reportado por Edilson
 * (T22): dejar el panel acoplado abierto además de la ventana desacoplada
 * mostraba el mismo análisis dos veces sin motivo — este botón ahora CIERRA
 * el panel acoplado (`toggleDidacticPanel`, sabemos que está abierto porque
 * este botón solo se renderiza en esa rama) justo después de pedir la
 * ventana, para que quede una sola superficie mostrando el PR desacoplado.
 *
 * Resize (T23): the left edge is a `ResizeHandle` (drag, arrow keys,
 * Home/End, double-click back to the default width). The width lives in the
 * store (`didacticPanelWidth`, clamped and persisted in `localStorage` by
 * `setDidacticPanelWidth`).
 */
export function DidacticPanel(): React.JSX.Element {
  const { t } = useTranslation()
  const didacticPanelOpen = useAppStore((s) => s.didacticPanelOpen)
  const walkthroughFocus = useAppStore((s) => s.walkthroughFocus)
  const toggleDidacticPanel = useAppStore((s) => s.toggleDidacticPanel)
  const selectedPr = useAppStore((s) => s.selectedPr)
  const preferredWidth = useAppStore((s) => s.didacticPanelWidth)
  const setPanelWidth = useAppStore((s) => s.setDidacticPanelWidth)
  const openLayer = useAppStore((s) => s.openLayer)
  const sidebarWidth = useAppStore((s) => s.sidebarWidth)
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed)
  const tab = useAppStore((s) => s.aiPanelTab)
  const setTab = useAppStore((s) => s.setAiPanelTab)
  const tabs = useRovingTabs<AiPanelTab>({
    keys: AI_PANEL_TABS,
    value: tab,
    onChange: setTab,
    tabId: (key) => `ai-panel-tab-${key}`,
    panelId: (key) => `ai-panel-${key}`,
  })
  const askPanel = tabs.panelProps('ask')
  const analysisPanel = tabs.panelProps('analysis')
  const tier = useLayoutTier()

  // F16/T87: el ancho PINTADO es el preferido clampeado contra el viewport
  // ACTUAL. Antes el clamp solo corría al arrastrar, así que un ancho guardado
  // en un monitor grande sobrevivía al tilear la ventana y se comía el centro.
  // El valor del store no se toca: al ensanchar de nuevo, el panel recupera su
  // ancho preferido solo.
  // The center's share also depends on the left column's real width (dragged or folded).
  const footprint = sidebarFootprint(sidebarWidth, sidebarCollapsed, tier.width)
  const panelWidth = clampDidacticWidth(preferredWidth, tier.width, footprint)
  const maxPanelWidth = clampDidacticWidth(Number.POSITIVE_INFINITY, tier.width, footprint)

  // The full-screen walkthrough shows the layer's explanation inline instead.
  // Closed, it takes no room at all: the title bar's toggle (and the command
  // palette) reopen it.
  if (walkthroughFocus || !didacticPanelOpen) return <></>

  // F16/T87: en el tier más angosto (`sm`, p. ej. media pantalla de una laptop)
  // el panel abierto se pinta como OVERLAY sobre el centro en vez de robarle
  // ancho — a 700px de ventana, acoplarlo dejaba el diff sin espacio útil. El
  // resize no aplica ahí (el ancho lo fija el overlay).
  const isOverlay = tier.w === 'sm'

  return (
    <Drawer
      side="right"
      docked={!isOverlay}
      label={t('chat.panel.title')}
      width={drawerWidth(DRAWER_WIDTH.didactic, tier.width)}
      onClose={toggleDidacticPanel}
    >
      <aside
        style={isOverlay ? undefined : { width: panelWidth }}
        className={
          isOverlay
            ? 'flex h-full min-w-0 flex-col bg-panel'
            : 'relative flex shrink-0 flex-col border-l border-border bg-panel'
        }
      >
        {/* Resize handle (T23) on the left edge: the panel grows leftward;
          the store still clamps what it persists. */}
        {!isOverlay && (
          <ResizeHandle
            edge="left"
            value={panelWidth}
            min={DIDACTIC_PANEL_MIN_WIDTH}
            max={maxPanelWidth}
            onChange={setPanelWidth}
            onReset={() => setPanelWidth(DIDACTIC_PANEL_DEFAULT_WIDTH)}
            label={t('didactic.panel.resize')}
            title={t('didactic.panel.resizeHint')}
          />
        )}
        <header className="flex min-w-0 items-center gap-2 border-b border-border px-3 py-1.5">
          <span className="flex shrink-0 items-center gap-1.5 text-sm font-semibold text-text">
            <Sparkles size={14} className="text-muted" aria-hidden />
            {t('chat.panel.title')}
          </span>
          <div
            role="tablist"
            aria-label={t('chat.panel.tabsLabel')}
            className="flex min-w-0 items-center gap-0.5 rounded-md bg-bg p-0.5"
          >
            <PanelTab
              tabProps={tabs.tabProps('ask')}
              icon={<MessageCircle size={12} aria-hidden />}
              label={t('chat.panel.tabs.ask')}
            />
            <PanelTab
              tabProps={tabs.tabProps('analysis')}
              icon={<GraduationCap size={12} aria-hidden />}
              label={t('chat.panel.tabs.analysis')}
            />
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            {selectedPr && tab === 'analysis' && (
              <IconButton
                size="sm"
                icon={<ExternalLink size={14} />}
                label={t('didactic.panel.openInWindow')}
                onClick={() => {
                  void window.minerva.window.openDidactic({
                    repo: selectedPr.repo,
                    number: selectedPr.number,
                    title: selectedPr.title,
                  })
                  toggleDidacticPanel()
                }}
              />
            )}
            <IconButton
              size="sm"
              icon={<X size={14} />}
              label={t('didactic.panel.close')}
              onClick={toggleDidacticPanel}
            />
          </div>
        </header>

        <div
          {...askPanel}
          className={`min-h-0 flex-1 flex-col ${tab === 'ask' ? 'flex' : 'hidden'}`}
        >
          {selectedPr ? (
            <AskTab
              key={prKey(selectedPr.repo, selectedPr.number)}
              repo={selectedPr.repo}
              number={selectedPr.number}
            />
          ) : (
            <p className="p-4 text-sm text-muted">{t('chat.noPr')}</p>
          )}
        </div>
        <div
          {...analysisPanel}
          className={`min-h-0 flex-1 flex-col gap-3 overflow-y-auto bg-bg ${tab === 'analysis' ? 'flex' : 'hidden'} ${tier.w === 'xl' ? 'p-4' : 'p-3'}`}
        >
          {selectedPr ? (
            <DidacticAnalysisArea
              key={selectedPr.id}
              repo={selectedPr.repo}
              number={selectedPr.number}
              currentHeadSha={selectedPr.headSha}
              onOpenLayer={openLayer}
            />
          ) : (
            <DidacticPlaceholder />
          )}
        </div>
      </aside>
    </Drawer>
  )
}

function PanelTab({
  tabProps,
  icon,
  label,
}: {
  tabProps: RovingTabProps
  icon: React.ReactNode
  label: string
}): React.JSX.Element {
  return (
    <button
      type="button"
      {...tabProps}
      className={`flex min-w-0 items-center gap-1 rounded px-2 py-0.5 text-xs font-medium transition-colors duration-150 ${
        tabProps['aria-selected'] ? 'bg-panel text-text shadow-sm' : 'text-muted hover:text-text'
      }`}
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  )
}
