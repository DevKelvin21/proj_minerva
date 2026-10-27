import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { IpcChannel, IpcRequest, IpcResponse, MinervaApi } from '../shared/ipc'
import {
  MINERVA_EVENTS,
  type AnalysisActivityItem,
  type AnalysisProgressEvent,
  type PrChange,
  type PrListChangedEvent,
  type UpdaterStatusChangedEvent,
} from '../shared/events'

/** Wrapper fino sobre `ipcRenderer.invoke` para un canal concreto del contrato. */
function invoke<C extends IpcChannel>(channel: C) {
  return (req: IpcRequest<C>): Promise<IpcResponse<C>> =>
    ipcRenderer.invoke(channel, req) as Promise<IpcResponse<C>>
}

/**
 * Guard mínimo de forma para el payload de `analysisProgress`: no valida
 * exhaustivamente cada sección (eso ya lo hizo `StreamSectionParser` en
 * main), solo que el objeto tiene la forma esperada de nivel superior antes
 * de pasarlo al callback del renderer — defensa en profundidad por si algo
 * llegara a emitir por este canal con una forma inesperada. `error` (T22) es
 * opcional: solo viaja en el evento terminal de un análisis fallido, así que
 * no se exige, solo se valida su tipo cuando está presente.
 */
function isAnalysisProgressPayload(value: unknown): value is AnalysisProgressEvent {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.repo === 'object' &&
    v.repo !== null &&
    typeof v.number === 'number' &&
    Array.isArray(v.sections) &&
    typeof v.done === 'boolean' &&
    (v.error === undefined || typeof v.error === 'string') &&
    // `phase` (T60): campo ADITIVO opcional, mismo criterio que `error` —
    // ausente (evento terminal) o uno de los dos valores válidos.
    (v.phase === undefined || v.phase === 'exploring' || v.phase === 'writing') &&
    // `activity` (F13): campo ADITIVO opcional, mismo criterio que `phase` —
    // acá sí se valida cada elemento (a diferencia de `sections`) porque el
    // renderer pinta `label` tal cual, sin ningún parser propio de por medio.
    (v.activity === undefined || (Array.isArray(v.activity) && v.activity.every(isActivityItem)))
  )
}

/** Guard de forma para un elemento del mini-log de actividad (F13). */
function isActivityItem(value: unknown): value is AnalysisActivityItem {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.id === 'string' &&
    (v.kind === 'read' ||
      v.kind === 'search' ||
      v.kind === 'list' ||
      v.kind === 'thinking' ||
      v.kind === 'tool') &&
    typeof v.label === 'string' &&
    (v.status === 'running' || v.status === 'done' || v.status === 'error')
  )
}

/**
 * Suscripción al streaming del análisis didáctico (T13). A propósito NO es
 * un `on(channel, cb)` genérico: el canal está hardcodeado literal
 * (`MINERVA_EVENTS.analysisProgress`), así que el renderer nunca puede pedir
 * suscribirse a un canal IPC arbitrario aunque tuviera acceso a esta función.
 * Devuelve la función de desuscripción (`removeListener` de ESE listener en
 * particular, no de todos los del canal).
 */
function onAnalysisProgress(callback: (payload: AnalysisProgressEvent) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: unknown): void => {
    if (isAnalysisProgressPayload(payload)) {
      callback(payload)
    }
  }
  ipcRenderer.on(MINERVA_EVENTS.analysisProgress, listener)
  return () => ipcRenderer.removeListener(MINERVA_EVENTS.analysisProgress, listener)
}

/** Guard de forma para un elemento individual de `PrListChangedEvent.changes`. */
function isPrChange(value: unknown): value is PrChange {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    (v.type === 'new_pr' ||
      v.type === 'pr_closed' ||
      v.type === 'pr_merged' ||
      v.type === 'new_comments' ||
      v.type === 'updated') &&
    typeof v.prKey === 'string' &&
    typeof v.number === 'number' &&
    typeof v.title === 'string' &&
    typeof v.repo === 'object' &&
    v.repo !== null
  )
}

/**
 * Guard mínimo de forma para el payload de `prListChanged` (T50, F10): no
 * revalida cada campo de `RepoRef` (ya lo hizo el watcher en main), solo que
 * `changes` es un array y cada elemento tiene la forma esperada de nivel
 * superior — mismo criterio de defensa en profundidad que
 * `isAnalysisProgressPayload`.
 */
function isPrListChangedPayload(value: unknown): value is PrListChangedEvent {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return Array.isArray(v.changes) && v.changes.every(isPrChange)
}

/**
 * Suscripción al watcher de PRs (T50/T51, F10). Mismo patrón que
 * `onAnalysisProgress`: canal hardcodeado, guard de payload, devuelve la
 * función de desuscripción de ESE listener.
 */
function onPrListChanged(callback: (payload: PrListChangedEvent) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: unknown): void => {
    if (isPrListChangedPayload(payload)) {
      callback(payload)
    }
  }
  ipcRenderer.on(MINERVA_EVENTS.prListChanged, listener)
  return () => ipcRenderer.removeListener(MINERVA_EVENTS.prListChanged, listener)
}

/** Los 8 valores válidos de `UpdaterStatus['phase']` (`../shared/types.ts`), whitelist explícita para el guard de forma de abajo. */
const VALID_UPDATER_PHASES = [
  'disabled',
  'unsupported',
  'idle',
  'checking',
  'available',
  'downloading',
  'downloaded',
  'error',
] as const

/**
 * Guard mínimo de forma para el payload de `updaterStatusChanged` (T90, F17):
 * no valida cada variante de la unión `UpdaterStatus` campo por campo (eso lo
 * arma main a partir de `electron-updater`, una fuente confiable, a
 * diferencia del contenido de un PR) — solo que `status` es un objeto con un
 * `phase` que sea uno de los 8 valores válidos, mismo criterio de defensa en
 * profundidad que `isAnalysisProgressPayload`/`isPrListChangedPayload`.
 */
function isUpdaterStatusPayload(value: unknown): value is UpdaterStatusChangedEvent {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  if (typeof v.status !== 'object' || v.status === null) return false
  const status = v.status as Record<string, unknown>
  return (
    typeof status.phase === 'string' &&
    (VALID_UPDATER_PHASES as readonly string[]).includes(status.phase)
  )
}

/**
 * Suscripción al estado del auto-updater (T90, F17). Mismo patrón que
 * `onAnalysisProgress`/`onPrListChanged`: canal hardcodeado literal
 * (`MINERVA_EVENTS.updaterStatusChanged`), guard de forma antes de llamar al
 * callback, devuelve la función de desuscripción de ESE listener.
 */
function onUpdaterStatus(callback: (payload: UpdaterStatusChangedEvent) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: unknown): void => {
    if (isUpdaterStatusPayload(payload)) {
      callback(payload)
    }
  }
  ipcRenderer.on(MINERVA_EVENTS.updaterStatusChanged, listener)
  return () => ipcRenderer.removeListener(MINERVA_EVENTS.updaterStatusChanged, listener)
}

const minervaApi = {
  system: {
    ping: invoke('minerva:ping'),
    getVersion: invoke('minerva:getVersion'),
  },
  scm: {
    getAuthStatus: invoke('scm:getAuthStatus'),
    listGhAccounts: invoke('scm:listGhAccounts'),
    getSettings: invoke('scm:getSettings'),
    setProviderSettings: invoke('scm:setProviderSettings'),
    listAzureProjects: invoke('scm:listAzureProjects'),
    setGithubAccount: invoke('scm:setGithubAccount'),
    listPullRequests: invoke('scm:listPullRequests'),
    markPrSeen: invoke('scm:markPrSeen'),
    getPullRequestDetail: invoke('scm:getPullRequestDetail'),
    getPullRequestFiles: invoke('scm:getPullRequestFiles'),
    getCommentThreads: invoke('scm:getCommentThreads'),
    postComment: invoke('scm:postComment'),
    setThreadStatus: invoke('scm:setThreadStatus'),
    getFileContent: invoke('scm:getFileContent'),
    retarget: invoke('scm:retarget'),
    getStacks: invoke('scm:getStacks'),
  },
  ai: {
    analyzePullRequest: invoke('ai:analyzePullRequest'),
    getCachedAnalysis: invoke('ai:getCachedAnalysis'),
    invalidateAnalysis: invoke('ai:invalidateAnalysis'),
    getAnalysisState: invoke('ai:getAnalysisState'),
    getProviderStatus: invoke('ai:getProviderStatus'),
    getProviderModels: invoke('ai:getProviderModels'),
  },
  settings: {
    get: invoke('settings:get'),
    setAiProvider: invoke('settings:setAiProvider'),
    setProviderModel: invoke('settings:setProviderModel'),
    setModelOption: invoke('settings:setModelOption'),
  },
  window: {
    openDidactic: invoke('window:openDidactic'),
  },
  updater: {
    getStatus: invoke('updater:getStatus'),
    check: invoke('updater:check'),
    download: invoke('updater:download'),
    quitAndInstall: invoke('updater:quitAndInstall'),
    openReleasePage: invoke('updater:openReleasePage'),
  },
  events: {
    onAnalysisProgress,
    onPrListChanged,
    onUpdaterStatus,
  },
} satisfies MinervaApi

export type { MinervaApi }

// Sin rama de fallback para contextIsolation deshabilitado: si alguna vez se
// apaga por error, el bridge simplemente no se expone y el fallo es visible,
// en vez de activarse silenciosamente en un contexto comprometido.
if (!process.contextIsolated) {
  throw new Error('proj_minerva requiere contextIsolation habilitado')
}
contextBridge.exposeInMainWorld('minerva', minervaApi)
