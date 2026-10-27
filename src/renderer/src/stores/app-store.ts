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
import type { LayerRef } from '../lib/walkthrough'
import type { ViewerFilter } from '../lib/dashboard'

export type CenterTab = 'conversation' | 'files' | 'comments'
export type DiffViewMode = 'split' | 'inline'
/** Left column of the Files tab: folder tree, flat list, or the AI walkthrough's layers. */
export type FileTreeMode = 'tree' | 'list' | 'layers'
/** What the left column shows: the review queue, the PR list by repo, or the stacked-PR view. */
/** How many recently opened PRs the collapsed sidebar rail keeps. */
const MAX_RECENT_PRS = 5

export type SidebarView = 'queue' | 'list' | 'stacks'
/** The reviewer's call on one walkthrough layer (full-screen walkthrough footer). */
export type LayerVerdict = 'good' | 'changes' | 'question'

/**
 * What the center shows: the home dashboard (repos, features, stacks) or the
 * review of `selectedPr`. The app opens on `home`; picking a PR anywhere
 * switches to `review`; "Home" goes back WITHOUT dropping `selectedPr`, so
 * returning to the PR is a re-render, not a refetch.
 */
export type MainView = 'home' | 'review'

/** Page inside the home dashboard. `repoKey` / `featureKey` are opaque ids (see `lib/dashboard.ts`). */
export type HomeRoute =
  | { kind: 'overview' }
  | { kind: 'repo'; repoKey: string }
  | { kind: 'feature'; featureKey: string }

/**
 * Set when a PR was opened from a stack (board, "Review stack" button): the
 * review view then offers "i of n" with previous/next over `keys`, the
 * stack's PRs root-first depth-first. Kept while the user moves between PRs
 * of that same stack; dropped when a PR outside it is opened.
 */
export interface StackNavContext {
  /** `prKey` of the stack's root (identifies the stack). */
  rootKey: string
  keys: string[]
}

const DIDACTIC_PANEL_WIDTH_KEY = 'minerva.didacticPanelWidth'
const SIDEBAR_COLLAPSED_KEY = 'minerva.sidebarCollapsed'

/** Persisted "docked sidebar hidden" flag; anything but the literal 'true' = shown. */
function readInitialSidebarCollapsed(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true'
  } catch {
    return false
  }
}

function sameRoute(a: HomeRoute, b: HomeRoute): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'repo' && b.kind === 'repo') return a.repoKey === b.repoKey
  if (a.kind === 'feature' && b.kind === 'feature') return a.featureKey === b.featureKey
  return true
}

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
   * Layer of the guided walkthrough the reviewer is following (Files tab in
   * `layers` mode): its ranges are highlighted in the diff and its summary
   * shows above it. Reset per PR; `null` = no layer picked (or a file outside
   * every layer was chosen).
   */
  activeLayer: LayerRef | null

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
  /** The Cmd/Ctrl+K command palette (title bar "Jump to…" button). Session only. */
  commandPaletteOpen: boolean
  /**
   * Full-screen walkthrough of `selectedPr`: the Files tab in layers mode
   * with the sidebar, the PR bar and the didactic panel out of the way, and a
   * verdict bar. Cleared whenever the review is left. Session only.
   */
  walkthroughFocus: boolean
  /** The last PRs opened this session, newest first (the collapsed sidebar rail). */
  recentPrs: PullRequestSummary[]
  /** Verdicts per PR (`prKey`) and layer (`layerVerdictKey`). Session only, never sent anywhere. */
  layerVerdicts: Record<string, Record<string, LayerVerdict>>
  aiModelInfo: AiSettingsInfo | null

  /** Left column: PR list or stacks. Session only. */
  sidebarView: SidebarView
  /**
   * Docked sidebar (`xl`/`lg`) hidden by the user (TitleBar toggle or
   * Cmd/Ctrl+B). Persisted in `localStorage`. Ignored on the drawer tiers,
   * where `sidebarOpen` rules.
   */
  sidebarCollapsed: boolean
  /**
   * Bumped after a write that changes PR data (a retarget): the PR list, the
   * open PR's detail and the stacks refetch when it changes.
   */
  scmDataVersion: number

  mainView: MainView
  homeRoute: HomeRoute
  /** Viewer filter of the repo page. Session only (like `prStateFilter`). */
  repoFilter: ViewerFilter
  stackNav: StackNavContext | null

  selectPr: (pr: PullRequestSummary | null) => void
  /**
   * Back to the dashboard OVERVIEW (the Home buttons), keeping `selectedPr` for a
   * cheap return. Breadcrumb crumbs use `navigateHome` for a specific page.
   */
  goHome: () => void
  /** Shows a dashboard page (and the home view, if the review was on screen). */
  navigateHome: (route: HomeRoute) => void
  /** Back to the review of `selectedPr`; no-op without one. */
  showReview: () => void
  setRepoFilter: (filter: ViewerFilter) => void
  /**
   * Arms (or clears) the stack navigation BEFORE `selectPr`: `selectPr` keeps
   * it only while the picked PR is one of `keys`.
   */
  setStackNav: (nav: StackNavContext | null) => void
  toggleSidebarCollapsed: () => void
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
  /** Picks a layer (and the file to show with it); `null` clears the selection. */
  setActiveLayer: (ref: LayerRef | null, path?: string) => void
  /** From the didactic panel: jump to the Files tab in layers mode on `ref`. */
  openLayer: (ref: LayerRef, path: string | null) => void
  setExpandedThreadId: (threadId: string | null) => void
  /** Navega al tab Archivos, selecciona `path` y deja el hilo `threadId` expandido/enfocado. */
  openLineThread: (path: string, line: number, threadId: string) => void
  clearPendingThreadFocus: () => void
  setScmAuth: (statuses: Record<ScmProviderId, ScmAuthStatus>) => void
  setScmSettings: (info: ScmSettingsInfo) => void
  openSettings: () => void
  closeSettings: () => void
  openCommandPalette: () => void
  closeCommandPalette: () => void
  /** Enters the full-screen walkthrough (Files tab, layers mode). No-op without a PR. */
  openWalkthroughFocus: () => void
  closeWalkthroughFocus: () => void
  /** Sets (or, with `null`, clears) the verdict of one layer of one PR. */
  setLayerVerdict: (prKey: string, layer: string, verdict: LayerVerdict | null) => void
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
  activeLayer: null,

  expandedThreadId: null,
  pendingThreadFocus: null,

  scmAuth: null,
  scmSettings: null,

  settingsOpen: false,
  commandPaletteOpen: false,
  walkthroughFocus: false,
  recentPrs: [],
  layerVerdicts: {},
  aiModelInfo: null,

  sidebarView: 'queue',
  sidebarCollapsed: readInitialSidebarCollapsed(),
  scmDataVersion: 0,

  mainView: 'home',
  homeRoute: { kind: 'overview' },
  repoFilter: 'all',
  stackNav: null,

  selectPr: (pr) =>
    set((state) => ({
      selectedPr: pr,
      // A PR opens the review; clearing the selection shows the dashboard.
      mainView: pr ? 'review' : 'home',
      // The stack context survives only while the PR is in that stack.
      stackNav:
        pr && state.stackNav && state.stackNav.keys.includes(prKey(pr.repo, pr.number))
          ? state.stackNav
          : null,
      centerTab: 'conversation',
      selectedFilePath: null,
      activeLayer: null,
      walkthroughFocus: false,
      recentPrs: pr
        ? [
            pr,
            ...state.recentPrs.filter(
              (recent) => prKey(recent.repo, recent.number) !== prKey(pr.repo, pr.number),
            ),
          ].slice(0, MAX_RECENT_PRS)
        : state.recentPrs,
      expandedThreadId: null,
      pendingThreadFocus: null,
      // Elegir un PR cierra el drawer de la lista (F16/T82): en `md`/`sm` la
      // lista tapa el centro, y el gesto natural tras elegir es ver el PR.
      sidebarOpen: false,
    })),
  goHome: () =>
    set({
      mainView: 'home',
      homeRoute: { kind: 'overview' },
      sidebarOpen: false,
      walkthroughFocus: false,
    }),
  navigateHome: (route) =>
    set((state) => ({
      mainView: 'home',
      walkthroughFocus: false,
      homeRoute: sameRoute(state.homeRoute, route) ? state.homeRoute : route,
      // The viewer filter belongs to a repo page: a new repo starts at "All".
      repoFilter:
        route.kind === 'repo' &&
        !(state.homeRoute.kind === 'repo' && state.homeRoute.repoKey === route.repoKey)
          ? 'all'
          : state.repoFilter,
      sidebarOpen: false,
    })),
  showReview: () => set((state) => (state.selectedPr ? { mainView: 'review' } : {})),
  setRepoFilter: (filter) => set({ repoFilter: filter }),
  setStackNav: (nav) => set({ stackNav: nav }),
  toggleSidebarCollapsed: () =>
    set((state) => {
      const collapsed = !state.sidebarCollapsed
      try {
        window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed))
      } catch {
        // Session-only when storage is unavailable.
      }
      return { sidebarCollapsed: collapsed }
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
  setActiveLayer: (ref, path) =>
    set((state) => ({
      activeLayer: ref,
      selectedFilePath: path ?? state.selectedFilePath,
    })),
  openLayer: (ref, path) =>
    set((state) => ({
      centerTab: 'files',
      fileTreeMode: 'layers',
      activeLayer: ref,
      selectedFilePath: path ?? state.selectedFilePath,
      // Jumping to a layer is a different intent than following a thread.
      expandedThreadId: null,
      pendingThreadFocus: null,
    })),
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
  openSettings: () => set({ settingsOpen: true, commandPaletteOpen: false }),
  openCommandPalette: () => set({ commandPaletteOpen: true }),
  closeCommandPalette: () => set({ commandPaletteOpen: false }),
  openWalkthroughFocus: () =>
    set((state) =>
      state.selectedPr
        ? {
            walkthroughFocus: true,
            mainView: 'review',
            centerTab: 'files',
            fileTreeMode: 'layers',
            sidebarOpen: false,
          }
        : {},
    ),
  closeWalkthroughFocus: () => set({ walkthroughFocus: false }),
  setLayerVerdict: (key, layer, verdict) =>
    set((state) => {
      const current = { ...(state.layerVerdicts[key] ?? {}) }
      if (verdict) current[layer] = verdict
      else delete current[layer]
      return { layerVerdicts: { ...state.layerVerdicts, [key]: current } }
    }),
  closeSettings: () => set({ settingsOpen: false }),
  setAiModelInfo: (info) => set({ aiModelInfo: info }),
}))
