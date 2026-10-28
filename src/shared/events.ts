/**
 * Contrato de eventos PUSH `main` -> `renderer` (T13). Distinto de `ipc.ts`:
 * aquellos canales son invoke/response uno-a-uno pedidos por el renderer;
 * estos son notificaciones que `main` empuja por su cuenta mientras un
 * análisis de IA está en curso (streaming del panel didáctico).
 *
 * Igual que `ipc.ts`, un solo objeto de contrato (`EventContract`) es la
 * fuente de verdad de forma/canal. A diferencia de `ipc.ts`, el preload NO
 * deriva un `on(channel, cb)` genérico de esto: expone un método concreto por
 * evento (`window.minerva.events.onAnalysisProgress`, ver `src/preload/index.ts`)
 * con el nombre de canal hardcodeado, para no reabrir la puerta a que el
 * renderer se suscriba a un canal arbitrario si en algún momento tuviera
 * acceso a `ipcRenderer` por una vía no prevista.
 */
import type { ActivityState } from './activity'
import type { AppLocale } from './locale'
import type { AppearanceSettings } from './theme/appearance'
import type { DidacticSnippet, RepoRef, UpdaterStatus, WalkthroughCohort } from './types'

interface DraftSectionCommon {
  markdown: string
  /**
   * `true` únicamente en la última sección de un snapshot mientras esa
   * sección sigue acumulando texto (no llegó el próximo `@@@SECTION` ni el
   * cierre del stream). Todas las secciones anteriores de un mismo snapshot
   * ya cerraron, así que no necesitan el flag.
   */
  streaming?: boolean
}

/**
 * Variante "en construcción" de `DidacticSection` (`./types.ts`) que viaja en
 * los snapshots de progreso del streaming (`src/main/ai/stream-parser.ts`).
 *
 * Diferencia clave con `DidacticSection`: en `architecture`/`schema`, el
 * campo `mermaid` es OPCIONAL. Mientras el bloque `@@@MERMAID` de esa sección
 * no cerró con `@@@END_MERMAID`, el campo simplemente está ausente — nunca
 * llega un DSL de Mermaid a medio escribir. Así el renderer solo necesita
 * comprobar `'mermaid' in section` (o `section.mermaid`) para saber si ya
 * puede montar el diagrama; nunca puede confundir uno parcial con uno final,
 * porque uno parcial no existe como valor observable desde afuera del parser.
 * Mismo criterio para los `snippets` de una sección `endpoint`: solo aparecen
 * en el array una vez que su `@@@END_SNIPPET` cerró.
 */
export type DraftDidacticSection =
  | ({ kind: 'summary' } & DraftSectionCommon)
  /**
   * `cohorts` only holds layers whose `@@@LAYER` marker already arrived (a
   * layer appears as soon as it opens; its markdown keeps growing while the
   * section streams). Same rule as `mermaid` above: a layer's diagram is only
   * set once its `@@@END_MERMAID` closed.
   */
  | ({ kind: 'walkthrough'; cohorts: WalkthroughCohort[] } & DraftSectionCommon)
  | ({ kind: 'setup'; snippets: DidacticSnippet[] } & DraftSectionCommon)
  | ({ kind: 'architecture'; mermaid?: string } & DraftSectionCommon)
  | ({ kind: 'endpoint'; snippets: DidacticSnippet[] } & DraftSectionCommon)
  | ({ kind: 'schema'; mermaid?: string } & DraftSectionCommon)
  /**
   * `cloud` lleva hasta DOS mermaid (big picture + zoom al cambio). Igual
   * criterio que `mermaid` en `architecture`/`schema`: un bloque todavía
   * abierto no entra al array — `mermaids` solo acumula los ya cerrados, en
   * orden de aparición.
   */
  | ({ kind: 'cloud'; mermaids?: string[] } & DraftSectionCommon)

/**
 * Verbo canónico de una acción interna del harness agéntico (F13): a qué
 * "familia" pertenece la herramienta que el modelo está usando sobre el
 * snapshot del PR. Cada proveedor mapea sus nombres propios a este union
 * (Claude `Read`/`Grep`/`Glob`, OpenCode `read`/`grep`/`glob`/`list`, Codex
 * `fileRead`/`webSearch`/...); `thinking` cubre los deltas de razonamiento y
 * `tool` es el cajón genérico para herramientas no reconocidas.
 */
export type AnalysisActivityKind = 'read' | 'search' | 'list' | 'thinking' | 'tool'

/**
 * Una entrada del mini-log de actividad del harness (F13). El renderer la
 * pinta tal cual: `label` ya viene derivado en `main` (en español) y SANEADO
 * (`src/main/ai/activity-tracker.ts`) — los detalles (rutas, patrones) salen
 * del snapshot hostil del PR, así que se truncan y se les quitan caracteres
 * de control ANTES de cruzar el IPC; el renderer nunca deriva texto por su
 * cuenta. `id` es estable por llamada de herramienta: una fila pasa de
 * `running` a `done`/`error` EN EL MISMO LUGAR (colapso por identidad, nunca
 * se duplica una acción como dos filas).
 */
export interface AnalysisActivityItem {
  id: string
  kind: AnalysisActivityKind
  label: string
  status: 'running' | 'done' | 'error'
}

export interface AnalysisProgressEvent {
  repo: RepoRef
  number: number
  sections: DraftDidacticSection[]
  /** `true` en el último snapshot emitido (el análisis ya terminó, con éxito o no). */
  done: boolean
  /**
   * Solo presente en el evento TERMINAL (`done: true`) de un análisis que
   * falló (T22): el mensaje de error del intento, el mismo texto que
   * rechazaría `ai:analyzePullRequest` si el solicitante lo hubiera esperado
   * directamente. Ausente en todo evento intermedio y en el terminal de un
   * análisis exitoso — su sola presencia es la señal de "falló" para quien
   * escucha el streaming sin haber disparado el análisis (p. ej. una ventana
   * desacoplada que se enganchó a un análisis ya en curso, ver
   * `ai:getAnalysisState` en `src/shared/ipc.ts`): sin este campo esa ventana
   * se quedaría mostrando "streaming" para siempre ante un error, porque los
   * `AiService` reales/mock nunca llaman a `onProgress` en el camino de
   * error — el evento terminal con `error` lo arma el handler
   * (`src/main/ipc/handlers.ts`), no el `AiService`.
   */
  error?: string
  /**
   * Fase del streaming AGÉNTICO (F11/T60), solo presente mientras un
   * proveedor agéntico (Claude Code/Codex/OpenCode, T56/T58) está en curso:
   * `'exploring'` desde que arranca el análisis hasta el PRIMER delta de
   * texto que entra al `StreamSectionParser` (el agente está usando
   * herramientas de solo lectura para explorar el snapshot del PR, sin
   * texto todavía); `'writing'` desde ese primer delta en adelante (ya está
   * redactando secciones). Campo ADITIVO: desde F13 el `MockAiService`
   * (`../main/ai/mock-service.ts`) TAMBIÉN lo emite (preludio guionado en
   * `'exploring'`, chunks de texto en `'writing'`) para que las suites e2e
   * con `MINERVA_MOCK_AI=1` puedan ejercitar el mini-log de actividad de
   * forma determinista — hasta T60 el mock lo omitía. Sigue ausente en el
   * evento TERMINAL (`done: true`) de cualquier proveedor — para ese momento
   * `sections` ya es la fuente de verdad, no hace falta distinguir fase. Ver
   * `AnalyzeProgressMeta` (`../main/ai/service.ts`) para el mismo campo del
   * lado de los `AiService`.
   */
  phase?: 'exploring' | 'writing'
  /**
   * Mini-log de actividad del harness (F13): buffer RODANTE con las últimas
   * ≤5 acciones internas del agente (tool calls sobre el snapshot +
   * "Pensando…"). Viaja COMPLETO en cada evento intermedio (no deltas): una
   * ventana que se engancha a mitad de análisis recibe el estado íntegro con
   * el primer evento que vea, y un evento perdido solo retrasa la vista,
   * nunca la corrompe. EFÍMERO por diseño: ausente en el evento TERMINAL
   * (`done: true`) y jamás se cachea/persiste (`analysis-cache.ts` ni lo
   * conoce) — es feedback de "qué está pasando ahora", no parte del análisis.
   */
  activity?: AnalysisActivityItem[]
}

/**
 * Un cambio individual detectado por el watcher de PRs (T50/T51, F10,
 * `main/scm/pr-watcher.ts`) entre dos snapshots de
 * `listPullRequests({ state: 'all' })`: `new_pr` (id nuevo), `pr_closed` /
 * `pr_merged` (transición desde `open`), `new_comments` (`commentCount`
 * subió) o `updated` (cualquier otro cambio de `updatedAt`). `title`/`repo`
 * viajan para que la UI pueda mostrar un cambio sin otro roundtrip.
 */
export interface PrChange {
  type: 'new_pr' | 'pr_closed' | 'pr_merged' | 'new_comments' | 'updated'
  /** `prKey(repo, number)` — stable across providers. */
  prKey: string
  number: number
  title: string
  repo: RepoRef
}

/**
 * Payload de `minerva:event:prListChanged` (T50/T51, F10): se emite SOLO
 * cuando el watcher detecta al menos un cambio frente al snapshot anterior
 * (el primer tick establece el baseline en silencio, sin emitir evento) —
 * `changes` nunca viaja vacío.
 */
export interface PrListChangedEvent {
  changes: PrChange[]
}

/**
 * Payload de `minerva:event:updaterStatusChanged` (T90, F17): main empuja el
 * `UpdaterStatus` COMPLETO ante cada transición, nunca un delta — mismo
 * criterio que `activity` en `AnalysisProgressEvent`: una ventana que se
 * engancha tarde (p. ej. la didáctica desacoplada, o una segunda ventana) no
 * necesita reconstruir nada, el primer evento que vea ya trae el estado
 * íntegro. Se emite a TODAS las ventanas abiertas (`BrowserWindow.getAllWindows()`,
 * mismo patrón que `broadcastProgress`/`broadcastPrListChanged` en
 * `main/ipc/handlers.ts`), no solo a la que disparó el chequeo manual.
 */
export interface UpdaterStatusChangedEvent {
  status: UpdaterStatus
}

/**
 * Payload of `minerva:event:languageChanged`: the language just saved by
 * `settings:setLanguage`, pushed to EVERY window (main + detached didactic)
 * so all of them switch without a reload.
 */
export interface LanguageChangedEvent {
  language: AppLocale
}

/**
 * Payload of `minerva:event:appearanceChanged`: the appearance settings just
 * saved by `settings:setAppearance`, pushed to every window so the main and
 * the detached didactic window repaint together.
 */
export interface AppearanceChangedEvent {
  appearance: AppearanceSettings
}

/**
 * Payload of `minerva:event:activityChanged`: the activity inbox changed
 * (new items, read flags, an orphan resolved). Always the FULL state, like
 * `UpdaterStatusChangedEvent`, so a window that joins late rebuilds nothing.
 */
export interface ActivityChangedEvent {
  state: ActivityState
}

/**
 * Payload of `minerva:event:openActivity`: the user clicked a system
 * notification. `itemId` = open that inbox item; `null` = several items,
 * show the Inbox. Sent to the main window only.
 */
export interface OpenActivityEvent {
  itemId: string | null
}

export interface EventContract {
  'minerva:event:analysisProgress': AnalysisProgressEvent
  'minerva:event:prListChanged': PrListChangedEvent
  'minerva:event:updaterStatusChanged': UpdaterStatusChangedEvent
  'minerva:event:languageChanged': LanguageChangedEvent
  'minerva:event:appearanceChanged': AppearanceChangedEvent
  'minerva:event:activityChanged': ActivityChangedEvent
  'minerva:event:openActivity': OpenActivityEvent
}

export type EventChannel = keyof EventContract
export type EventPayload<C extends EventChannel> = EventContract[C]

/**
 * Nombres de canal como constantes, para no repetir el string mágico entre
 * `main` (quien emite, `src/main/ipc/handlers.ts`) y `preload` (quien se
 * suscribe con el canal hardcodeado, `src/preload/index.ts`).
 */
export const MINERVA_EVENTS = {
  analysisProgress: 'minerva:event:analysisProgress',
  prListChanged: 'minerva:event:prListChanged',
  updaterStatusChanged: 'minerva:event:updaterStatusChanged',
  languageChanged: 'minerva:event:languageChanged',
  appearanceChanged: 'minerva:event:appearanceChanged',
  activityChanged: 'minerva:event:activityChanged',
  openActivity: 'minerva:event:openActivity',
} satisfies Record<string, EventChannel>
