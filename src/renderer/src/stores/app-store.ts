/**
 * Estado global de la UI (layout + selección), no de datos de dominio: los
 * datos de PRs viven en `main` y se piden vía IPC (T4, ver `src/renderer/src/hooks`).
 *
 * Se guarda el `PullRequestSummary` seleccionado completo (no solo su id):
 * los canales `scm:getPullRequestDetail/Files/CommentThreads` piden
 * `{ repo, number }`, no un id de string, así que el selector de la lista ya
 * tiene todo lo necesario para pedir el detalle sin tener que volver a buscarlo.
 *
 * Los componentes deben consumir slices vía selector (`useAppStore((s) => s.x)`)
 * en vez de desestructurar el store completo, para no re-renderizar de más.
 */
import { create } from 'zustand'
import {
  clampDidacticWidth,
  DIDACTIC_PANEL_DEFAULT_WIDTH,
  DIDACTIC_PANEL_MIN_WIDTH,
} from '../lib/layout'
import type {
  AiSettingsInfo,
  PrStateFilter,
  PullRequestSummary,
  ScmSettingsInfo,
} from '../../../shared/types'
import { prKey, type ScmAuthStatus, type ScmProviderId } from '../../../shared/scm'

export type CenterTab = 'conversation' | 'files' | 'comments'
export type DiffViewMode = 'split' | 'inline'
export type FileTreeMode = 'tree' | 'list'
/** What the left column shows: the PR list or the stacked-PR view. */
export type SidebarView = 'list' | 'stacks'

const DIDACTIC_PANEL_WIDTH_KEY = 'minerva.didacticPanelWidth'

/**
 * Ancho del panel didáctico acoplado (T23, resize por arrastre): el clamp real
 * vive en `lib/layout.ts` (F16/T79) y es tier-aware — la MISMA función la usa
 * `DidacticPanel` al pintar, para que arrastrar y renderizar no discrepen (si
 * no, el panel saltaría al soltar el handle).
 *
 * El valor persistido es el PREFERIDO del usuario, no el efectivo: al achicar
 * la ventana el panel se pinta clampeado, pero el número guardado no se pisa —
 * vuelve solo al ensanchar. Por eso el clamp NO se aplica al leer de
 * `localStorage`, solo se sanea el número.
 */
function clampDidacticPanelWidth(width: number): number {
  return clampDidacticWidth(width, window.innerWidth)
}

/** Ancho persistido en `localStorage` (sobrevive reinicios del renderer); inválido o ausente → default. */
function readInitialDidacticPanelWidth(): number {
  const raw = window.localStorage.getItem(DIDACTIC_PANEL_WIDTH_KEY)
  const parsed = raw === null ? Number.NaN : Number(raw)
  if (!Number.isFinite(parsed)) return DIDACTIC_PANEL_DEFAULT_WIDTH
  return Math.max(Math.round(parsed), DIDACTIC_PANEL_MIN_WIDTH)
}

/**
 * Foco pendiente al navegar desde un chip `path:line` en ConversationTab hacia
 * el tab Archivos: `FilesTab`/`DiffView` lo consumen para hacer scroll al hilo
 * una vez que el archivo correspondiente terminó de montarse, y lo limpian
 * (`clearPendingThreadFocus`) para no repetir el scroll en renders futuros.
 */
interface PendingThreadFocus {
  path: string
  line: number
  threadId: string
}

interface AppState {
  selectedPr: PullRequestSummary | null
  searchQuery: string
  /**
   * Filtro de estado de la lista de PRs (T52, F10): `'open'` por defecto
   * (comportamiento previo). Vive SOLO en sesión — a diferencia de
   * `didacticPanelWidth`, no se persiste en `localStorage` (decisión de
   * diseño de PLAN.md: no hay razón para recordar "Cerrados" entre arranques).
   */
  prStateFilter: PrStateFilter
  centerTab: CenterTab
  /**
   * Drawer de la lista de PRs (F16/T82): SOLO tiene efecto en los tiers donde
   * la sidebar no está acoplada (`md`/`sm`, ver `sidebarIsDrawer`). En `xl`/`lg`
   * la lista es una columna fija y este flag se ignora — así, al ensanchar la
   * ventana, no queda un overlay abierto encima de la columna.
   */
  sidebarOpen: boolean
  didacticPanelOpen: boolean
  /** Ancho en px del panel didáctico acoplado (T23); se arrastra desde su borde izquierdo y persiste en `localStorage`. */
  didacticPanelWidth: number

  /** Archivo seleccionado en el tab "Archivos" (T7); se resetea al cambiar de PR. */
  selectedFilePath: string | null
  diffViewMode: DiffViewMode
  fileTreeMode: FileTreeMode
  wordWrap: boolean

  /**
   * Thread focused in the diff (jumped to from the Comments view, a `path:line`
   * chip, or just created): its card is open and its line range highlighted.
   * Threads themselves always show under their line.
   */
  expandedThreadId: string | null
  pendingThreadFocus: PendingThreadFocus | null

  /**
   * Per-provider SCM auth status: single source of truth for TitleBar,
   * Sidebar, Settings and the data hooks. Written by `useScmAuth`
   * (initial fetch + polling). `null` until the first answer.
   * `usePullRequests` refetches when it changes, so signing in clears the
   * "not authenticated" list without reloading the app.
   */
  scmAuth: Record<ScmProviderId, ScmAuthStatus> | null
  /** Last `scm:getSettings` / `scm:setGithubAccount` answer; `null` until loaded. */
  scmSettings: ScmSettingsInfo | null

  /**
   * Modal de settings (T12, engrane en TitleBar; forma multi-proveedor desde
   * T26). `aiModelInfo` es la última respuesta conocida de
   * `settings:get`/`settings:setAiProvider`/`settings:setProviderModel`
   * (selección efectiva de proveedor+modelo + catálogo): se guarda en el
   * store en vez de en estado local de un solo hook para que todos los
   * consumidores (el modal y el hint sutil del panel didáctico, `useSettings`
   * en ambos) compartan el mismo valor sin refetchear cada uno por su lado
   * innecesariamente.
   */
  settingsOpen: boolean
  aiModelInfo: AiSettingsInfo | null

  /** Left column: PR list or stacks. Session only. */
  sidebarView: SidebarView
  /**
   * Bumped after a write that changes PR data (a retarget): the PR list, the
   * open PR's detail and the stacks refetch when it changes.
   */
  scmDataVersion: number

  selectPr: (pr: PullRequestSummary | null) => void
  /**
   * Swaps in a fresher summary of the SELECTED PR (same `prKey`) without the
   * reset `selectPr` does (tab, file, threads). No-op for any other PR.
   */
  replaceSelectedPr: (pr: PullRequestSummary) => void
  setSidebarView: (view: SidebarView) => void
  bumpScmData: () => void
  setSearchQuery: (query: string) => void
  setPrStateFilter: (filter: PrStateFilter) => void
  setCenterTab: (tab: CenterTab) => void
  toggleSidebar: () => void
  closeSidebar: () => void
  toggleDidacticPanel: () => void
  /** Fija el ancho del panel didáctico acoplado (clampeado y persistido); ver `clampDidacticPanelWidth`. */
  setDidacticPanelWidth: (width: number) => void
  setSelectedFilePath: (path: string | null) => void
  setDiffViewMode: (mode: DiffViewMode) => void
  setFileTreeMode: (mode: FileTreeMode) => void
  toggleWordWrap: () => void
  setExpandedThreadId: (threadId: string | null) => void
  /** Navega al tab Archivos, selecciona `path` y deja el hilo `threadId` expandido/enfocado. */
  openLineThread: (path: string, line: number, threadId: string) => void
  clearPendingThreadFocus: () => void
  setScmAuth: (statuses: Record<ScmProviderId, ScmAuthStatus>) => void
  setScmSettings: (info: ScmSettingsInfo) => void
  openSettings: () => void
  closeSettings: () => void
  setAiModelInfo: (info: AiSettingsInfo) => void
}

export const useAppStore = create<AppState>((set) => ({
  selectedPr: null,
  searchQuery: '',
  prStateFilter: 'open',
  centerTab: 'conversation',
  sidebarOpen: false,
  didacticPanelOpen: true,
  didacticPanelWidth: readInitialDidacticPanelWidth(),

  selectedFilePath: null,
  diffViewMode: 'split',
  fileTreeMode: 'tree',
  // Wrap activado por defecto (T49): sin wrap las líneas largas obligan a
  // scroll horizontal y en split el lado nuevo arranca fuera de la vista.
  wordWrap: true,

  expandedThreadId: null,
  pendingThreadFocus: null,

  scmAuth: null,
  scmSettings: null,

  settingsOpen: false,
  aiModelInfo: null,

  sidebarView: 'list',
  scmDataVersion: 0,

  selectPr: (pr) =>
    set({
      selectedPr: pr,
      centerTab: 'conversation',
      selectedFilePath: null,
      expandedThreadId: null,
      pendingThreadFocus: null,
      // Elegir un PR cierra el drawer de la lista (F16/T82): en `md`/`sm` la
      // lista tapa el centro, y el gesto natural tras elegir es ver el PR.
      sidebarOpen: false,
    }),
  replaceSelectedPr: (pr) =>
    set((state) =>
      state.selectedPr &&
      prKey(state.selectedPr.repo, state.selectedPr.number) === prKey(pr.repo, pr.number)
        ? { selectedPr: { ...state.selectedPr, ...pr } }
        : {},
    ),
  setSidebarView: (view) => set({ sidebarView: view }),
  bumpScmData: () => set((state) => ({ scmDataVersion: state.scmDataVersion + 1 })),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setPrStateFilter: (filter) => set({ prStateFilter: filter }),
  setCenterTab: (tab) => set({ centerTab: tab }),
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  closeSidebar: () => set({ sidebarOpen: false }),
  toggleDidacticPanel: () => set((state) => ({ didacticPanelOpen: !state.didacticPanelOpen })),
  setDidacticPanelWidth: (width) => {
    const clamped = clampDidacticPanelWidth(width)
    // Best-effort: si `localStorage` fallara (cuota, modo raro), el resize
    // sigue funcionando dentro de la sesión.
    try {
      window.localStorage.setItem(DIDACTIC_PANEL_WIDTH_KEY, String(clamped))
    } catch {
      // sin persistencia, pero sin romper el arrastre
    }
    set({ didacticPanelWidth: clamped })
  },
  setSelectedFilePath: (path) => set({ selectedFilePath: path }),
  setDiffViewMode: (mode) => set({ diffViewMode: mode }),
  setFileTreeMode: (mode) => set({ fileTreeMode: mode }),
  toggleWordWrap: () => set((state) => ({ wordWrap: !state.wordWrap })),
  setExpandedThreadId: (threadId) => set({ expandedThreadId: threadId }),
  openLineThread: (path, line, threadId) =>
    set({
      centerTab: 'files',
      selectedFilePath: path,
      expandedThreadId: threadId,
      pendingThreadFocus: { path, line, threadId },
    }),
  clearPendingThreadFocus: () => set({ pendingThreadFocus: null }),
  setScmAuth: (statuses) => set({ scmAuth: statuses }),
  setScmSettings: (info) => set({ scmSettings: info }),
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  setAiModelInfo: (info) => set({ aiModelInfo: info }),
}))
