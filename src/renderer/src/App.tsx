import { TitleBar } from './components/layout/TitleBar'
import { Sidebar } from './components/layout/Sidebar'
import { CenterPane } from './components/layout/CenterPane'
import { DidacticPanel } from './components/layout/DidacticPanel'
import { HomeView } from './components/home/HomeView'
import { SettingsModal } from './components/settings/SettingsModal'
import { CommandPalette } from './components/layout/CommandPalette'
import { useCommandPaletteShortcut } from './hooks/use-command-palette-shortcut'
import { useSidebarShortcut } from './hooks/use-sidebar-shortcut'
import { useOpenActivityFromNotifications } from './hooks/use-activity'
import { useAppStore } from './stores/app-store'

/**
 * Shell: TitleBar | [Sidebar] | center | [didactic panel]. The center is the
 * home dashboard (`mainView === 'home'`: repos, features, stacks) or the PR
 * review (`CenterPane` + `DidacticPanel`). The Sidebar is a column on wide
 * tiers (hideable, Cmd/Ctrl+B) and a drawer on narrow ones.
 *
 * Going Home keeps the review tree MOUNTED but hidden (`display: none` +
 * `inert`): an unsent comment, the open tab/file/layer and a streaming
 * analysis survive "Continue reviewing #n". `inert` keeps the hidden tree
 * out of focus and clicks; its global key listeners (J/K layers, the
 * resource viewer's Esc) check for themselves that the review is on screen.
 */
function App(): React.JSX.Element {
  // Montaje condicional (no un `display:none`/`open` prop interno): así
  // `SettingsModal` se desmonta por completo al cerrar y su estado local (y
  // el de `ModelPicker`) arranca de cero la próxima vez que se abra, sin
  // necesitar un efecto de reseteo (ver el comentario de `SettingsModal`).
  const settingsOpen = useAppStore((s) => s.settingsOpen)
  const mainView = useAppStore((s) => s.mainView)
  const hasSelection = useAppStore((s) => s.selectedPr !== null)
  const paletteOpen = useAppStore((s) => s.commandPaletteOpen)
  useSidebarShortcut()
  useCommandPaletteShortcut()
  useOpenActivityFromNotifications()

  const onHome = mainView === 'home'

  return (
    <div className="flex h-full flex-col">
      <TitleBar />
      {/* `relative`: en los tiers angostos (F16/T82) la `Sidebar` se pinta como
          drawer `absolute` DENTRO de esta fila — no sobre el TitleBar, que
          conserva el botón para abrirla y cerrarla. */}
      <div className="relative flex flex-1 overflow-hidden">
        <Sidebar />
        {onHome && <HomeView />}
        {(hasSelection || !onHome) && (
          <div
            data-testid="review-view"
            className={onHome ? 'hidden' : 'contents'}
            hidden={onHome}
            inert={onHome}
            aria-hidden={onHome}
          >
            <CenterPane />
            <DidacticPanel />
          </div>
        )}
      </div>
      {paletteOpen && <CommandPalette />}
      {settingsOpen && <SettingsModal />}
    </div>
  )
}

export default App
