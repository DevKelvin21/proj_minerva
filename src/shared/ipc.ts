/**
 * Contrato IPC: única fuente de verdad para los canales `main` <-> `renderer`.
 *
 * Cada entrada de `IpcContract` define la forma de request/response de un canal.
 * `preload` deriva `MinervaApi` de aquí (sin repetir tipos a mano) y `main/ipc`
 * valida en runtime contra `IPC_CHANNELS`.
 */

import type {
  AiProviderStatus,
  AiSettingsInfo,
  AnalysisState,
  CommentThread,
  DidacticAnalysis,
  DiffFile,
  GhAccount,
  ListPullRequestsResult,
  PostCommentRequest,
  PrComment,
  PrStateFilter,
  PullRequestDetail,
  RepoRef,
  ScmSettingsInfo,
  UpdaterStatus,
} from './types'
import type { ScmAuthStatus, ScmProviderId } from './scm'
import type { AiModelOption, AiProviderId } from './ai-providers'
import type { AnalysisProgressEvent, PrListChangedEvent, UpdaterStatusChangedEvent } from './events'

export interface IpcContract {
  'minerva:ping': { req: void; res: string }
  /**
   * `app.getVersion()` de main (T90, F17) — hoy la versión de Minerva no se
   * muestra en ninguna parte de la app; este canal existe para la sección
   * "Actualizaciones" de Settings (T93), pero es de utilidad general (no
   * depende del updater). Vive en el namespace `system` (alias de `minerva`,
   * ver `NamespaceAliasMap` más abajo) por el prefijo `minerva:`.
   */
  'minerva:getVersion': { req: void; res: string }

  /**
   * Auth status of every SCM provider, keyed by provider id. Never includes a
   * token. Providers not configured report `state: 'disabled'`.
   */
  'scm:getAuthStatus': { req: void; res: Record<ScmProviderId, ScmAuthStatus> }

  /**
   * Accounts the `gh` CLI knows on github.com, for the Settings account
   * picker. Read-only (`gh auth status`, cached 5s). `[]` when `gh` is missing,
   * has no session, or its output can't be parsed. Logins only, never tokens.
   */
  'scm:listGhAccounts': { req: void; res: GhAccount[] }

  /** SCM settings (mock flag + chosen GitHub account). */
  'scm:getSettings': { req: void; res: ScmSettingsInfo }

  /**
   * Picks which `gh` account Minerva talks to, or `null` to follow `gh`'s
   * active account. Persists the login, drops the token-bridge caches, warms
   * the probe with the new account. Never runs `gh auth switch`: the choice is
   * local to Minerva.
   */
  'scm:setGithubAccount': { req: { login: string | null }; res: ScmSettingsInfo }

  /**
   * Fans out over every enabled provider with `Promise.allSettled`: one
   * failing provider lands in `errors` and doesn't drop the others' `items`.
   * `state` defaults to `'open'`. Each summary is decorated with `unread`
   * (seen-store) by the handler.
   */
  'scm:listPullRequests': {
    req: { search?: string; state?: PrStateFilter }
    res: ListPullRequestsResult
  }
  /**
   * Seals the "seen" state of a PR with the CURRENT `updatedAt`/`commentCount`
   * of its summary; if the PR changes later, it shows as unread again.
   */
  'scm:markPrSeen': {
    req: { repo: RepoRef; number: number; updatedAt: string; commentCount: number | null }
    res: { ok: true }
  }
  'scm:getPullRequestDetail': {
    req: { repo: RepoRef; number: number }
    res: PullRequestDetail
  }
  'scm:getPullRequestFiles': { req: { repo: RepoRef; number: number }; res: DiffFile[] }
  'scm:getCommentThreads': { req: { repo: RepoRef; number: number }; res: CommentThread[] }
  'scm:postComment': { req: PostCommentRequest; res: PrComment }

  'ai:analyzePullRequest': { req: { repo: RepoRef; number: number }; res: DidacticAnalysis }
  /**
   * Lectura pura del cache de análisis en main (T14, `../main/ai/analysis-cache.ts`):
   * a diferencia de `ai:analyzePullRequest`, NUNCA dispara un análisis nuevo ni
   * llama al `AiService` — solo devuelve lo que ya haya cacheado, o `null` si no
   * hay nada. La usa la ventana didáctica desacoplada para mostrar un análisis
   * ya pagado sin volver a pedirlo.
   */
  'ai:getCachedAnalysis': { req: { repo: RepoRef; number: number }; res: DidacticAnalysis | null }
  /**
   * Descarta la entrada de cache de ese PR (si había). No relanza el análisis
   * por sí sola: el botón "Re-analizar" la llama y, a continuación, invoca
   * `ai:analyzePullRequest` normalmente (que al no encontrar cache, sí llama
   * al `AiService`).
   */
  'ai:invalidateAnalysis': { req: { repo: RepoRef; number: number }; res: void }
  /**
   * Estado actual de un análisis para un PR, sin dispararlo ni esperar el
   * resultado completo (T22, `AnalysisState` en `./types.ts`): `cached` si
   * `analysisCache` ya lo tiene, `streaming` con el último snapshot conocido
   * si hay un análisis EN CURSO para ese PR (registro in-flight de
   * `../main/ipc/handlers.ts`), `idle` si no hay ni una cosa ni la otra. Lo
   * consulta el hook del renderer al montar (panel acoplado o ventana
   * desacoplada) para engancharse a un streaming ya empezado en vez de
   * mostrar el placeholder hasta que alguien pulse "Analizar PR".
   */
  'ai:getAnalysisState': { req: { repo: RepoRef; number: number }; res: AnalysisState }

  /**
   * Estado de login por proveedor de IA (T27), sin disparar ningún análisis:
   * un `Record` con los TRES proveedores del catálogo (`../shared/ai-providers.ts`),
   * cada uno con su `AiProviderStatus` (`./types.ts`), resuelto vía un probe
   * de CLI con timeout corto y cache TTL, NUNCA bloqueante
   * (`main/ai/providers/cli-probe.ts`) — ver `main/ai/providers/provider-status.ts`
   * para el agregado. Nunca incluye tokens/keys, a lo sumo
   * `account.email`/`account.plan` de exhibición.
   */
  'ai:getProviderStatus': { req: void; res: Record<AiProviderId, AiProviderStatus> }

  /**
   * Modelos disponibles para `provider` (T35, F8): estático (catálogo
   * curado, T26/T34) para Claude Code; DINÁMICOS vía la RPC `model/list` de
   * `codex app-server` para Codex y vía `provider.list()` del server local
   * para OpenCode (T57), con fallback al curado y cache TTL en main si el
   * CLI falla/no hay sesión (ver `../main/ai/providers/provider-models.ts`).
   * A propósito es un canal SEPARADO de `settings:get` (síncrono, T26):
   * resolver los modelos de Codex/OpenCode puede tardar (o fallar) por
   * spawnear un proceso externo, y eso NO debe bloquear ni romper la carga
   * del resto de Settings.
   */
  'ai:getProviderModels': { req: { provider: AiProviderId }; res: readonly AiModelOption[] }

  /**
   * Selección efectiva de proveedor+modelo (T26) más el catálogo completo de
   * proveedores/modelos, para que la UI pinte las opciones sin un roundtrip
   * adicional. Ver `AiSettingsInfo` (`./types.ts`) y `getAiSettingsInfo`
   * (`../main/ai/env.ts`).
   */
  'settings:get': { req: void; res: AiSettingsInfo }
  /** Cambia el proveedor ACTIVO (T26); no toca los modelos ya elegidos por cada proveedor. */
  'settings:setAiProvider': { req: { provider: AiProviderId }; res: AiSettingsInfo }
  /** Persiste el modelo elegido para `provider` (T26), sea o no el proveedor activo. */
  'settings:setProviderModel': {
    req: { provider: AiProviderId; model: string }
    res: AiSettingsInfo
  }
  /**
   * Persiste el valor elegido para una opción de modelo (T34, F8 — p. ej.
   * `{ provider: 'codex', optionId: 'effort', value: 'high' }`) de
   * `provider`, sea o no el proveedor activo. No valida `value` contra las
   * choices del descriptor: esa validación "robusta" ocurre en la LECTURA
   * (`getEffectiveAiSelection`, `main/ai/env.ts`) para que cambiar de modelo
   * después no deje un valor huérfano bloqueado. Responde el
   * `AiSettingsInfo` actualizado (mismo patrón que `setAiProvider`/
   * `setProviderModel`) para que la UI (T37) refresque sin un roundtrip
   * adicional.
   */
  'settings:setModelOption': {
    req: { provider: AiProviderId; optionId: string; value: string }
    res: AiSettingsInfo
  }

  /**
   * Abre (o enfoca, si ya hay una) la ventana didáctica desacoplada (T14,
   * `../main/windows/didactic-window.ts`) sincronizada con `repo`/`number`.
   * Solo existe UNA ventana didáctica a la vez: pedir este canal con un PR
   * distinto mientras ya hay una abierta la navega a ese PR nuevo en vez de
   * abrir una segunda ventana. `title` es el título humano del PR (lo trae
   * quien ya lo tiene a mano, `selectedPr.title`): viaja en el hash de la URL
   * que carga la ventana para que el header se pinte al instante, sin
   * depender de que la ventana pida `scm:getPullRequestDetail` primero.
   */
  'window:openDidactic': { req: { repo: RepoRef; number: number; title: string }; res: void }

  /**
   * Contrato del auto-updater (T90, F17) — SOLO el contrato: hasta que T91
   * cablee `main/updater/updater.ts`, los handlers de main son stubs que
   * devuelven `{ phase: 'disabled' }` (ver `// T91:` en
   * `main/ipc/handlers.ts`). `UpdaterStatus` en `./types.ts`.
   */

  /** Snapshot actual del updater, sin disparar ningún chequeo (lectura pura, mismo criterio que `ai:getAnalysisState`). */
  'updater:getStatus': { req: void; res: UpdaterStatus }
  /** Chequeo MANUAL: fuerza un chequeo inmediato contra el feed (botón "Buscar actualizaciones" de Settings), sin esperar al intervalo de 6h. */
  'updater:check': { req: void; res: UpdaterStatus }
  /**
   * Descarga la versión disponible. Solo válido con `phase: 'available'` —
   * `autoDownload: false` a propósito (decisión de producto, ~130 MB): este
   * canal ES el consentimiento explícito del usuario, la app nunca descarga
   * por su cuenta.
   */
  'updater:download': { req: void; res: UpdaterStatus }
  /**
   * Reinicia Minerva ya mismo para instalar una versión ya descargada. Acción
   * **SECUNDARIA**: el comportamiento por defecto es instalar al salir de la
   * app (`autoInstallOnAppQuit: true`, ver `downloaded` en `UpdaterStatus`).
   * No lo conviertas en el camino principal de ninguna UI — es un atajo, no
   * el flujo esperado.
   */
  'updater:quitAndInstall': { req: void; res: void }
  /**
   * Abre en el navegador del sistema la página de la release disponible
   * (`shell.openExternal` sobre la `releaseUrl` de `UpdateInfoLite`, que main
   * ya construyó y validó — nunca una URL cruda del feed).
   */
  'updater:openReleasePage': { req: void; res: { ok: true } }
}

export type IpcChannel = keyof IpcContract
export type IpcRequest<C extends IpcChannel> = IpcContract[C]['req']
export type IpcResponse<C extends IpcChannel> = IpcContract[C]['res']

/**
 * Lista de canales en runtime, para poder iterar/validar (p. ej. en el registro de
 * handlers de main). El tipado de abajo obliga a que esta lista sea exhaustiva
 * respecto a `IpcChannel`: si `IpcContract` gana o pierde un canal y esta lista no
 * se actualiza, `_assertChannelsCoverContract` deja de tipar.
 */
export const IPC_CHANNELS = [
  'minerva:ping',
  'minerva:getVersion',
  'scm:getAuthStatus',
  'scm:listGhAccounts',
  'scm:getSettings',
  'scm:setGithubAccount',
  'scm:listPullRequests',
  'scm:markPrSeen',
  'scm:getPullRequestDetail',
  'scm:getPullRequestFiles',
  'scm:getCommentThreads',
  'scm:postComment',
  'ai:analyzePullRequest',
  'ai:getCachedAnalysis',
  'ai:invalidateAnalysis',
  'ai:getAnalysisState',
  'ai:getProviderStatus',
  'ai:getProviderModels',
  'settings:get',
  'settings:setAiProvider',
  'settings:setProviderModel',
  'settings:setModelOption',
  'window:openDidactic',
  'updater:getStatus',
  'updater:check',
  'updater:download',
  'updater:quitAndInstall',
  'updater:openReleasePage',
] as const satisfies readonly IpcChannel[]

type AssertNoMissingChannel = [IpcChannel] extends [(typeof IPC_CHANNELS)[number]] ? true : never
const _assertChannelsCoverContract: AssertNoMissingChannel = true
void _assertChannelsCoverContract

/**
 * API tipada expuesta en `window.minerva`, agrupada por namespace.
 * Se deriva de `IpcContract`: el prefijo antes de `:` en el nombre del canal es el
 * namespace (con el alias `minerva` -> `system`), y el sufijo es el nombre del método.
 */
type NamespaceAliasMap = { minerva: 'system' }

type ChannelAction<C extends IpcChannel> = C extends `${string}:${infer Action}` ? Action : never

// `C` debe quedar "naked" en el `extends` para que el condicional distribuya
// miembro a miembro sobre la unión `IpcChannel` (si se envolviera en otro alias
// antes de compararlo, TS lo trataría como un solo tipo y no por canal).
type ApiNamespace<C extends IpcChannel> = C extends `${infer NS}:${string}`
  ? NS extends keyof NamespaceAliasMap
    ? NamespaceAliasMap[NS]
    : NS
  : never

type InvokeApi = {
  [NS in ApiNamespace<IpcChannel>]: {
    [C in IpcChannel as ApiNamespace<C> extends NS ? ChannelAction<C> : never]: (
      req: IpcRequest<C>,
    ) => Promise<IpcResponse<C>>
  }
}

/**
 * `events` NO se deriva de `IpcContract` (esos son canales invoke/response
 * uno-a-uno; los eventos push de `../shared/events.ts` tienen otra forma:
 * `main` los empuja por su cuenta, sin que el renderer los pida). Un método
 * concreto por evento (nunca un `on(channel, cb)` genérico, ver el
 * comentario de cabecera de `events.ts` y `src/preload/index.ts`), que
 * devuelve la función de desuscripción.
 */
interface EventsApi {
  onAnalysisProgress(callback: (payload: AnalysisProgressEvent) => void): () => void
  /**
   * Suscripción al watcher de PRs (T50/T51, F10): se dispara con los cambios
   * detectados contra el snapshot anterior (`main/scm/pr-watcher.ts`) —
   * nunca en el primer tick (baseline silencioso). Mismo patrón que
   * `onAnalysisProgress`: método concreto, no un `on(channel, cb)` genérico.
   */
  onPrListChanged(callback: (payload: PrListChangedEvent) => void): () => void
  /**
   * Suscripción al estado del auto-updater (T90, F17): main empuja el
   * `UpdaterStatus` completo (no deltas) ante cada transición, a TODAS las
   * ventanas — ver `UpdaterStatusChangedEvent` (`./events.ts`). Mismo patrón
   * que `onAnalysisProgress`/`onPrListChanged`: canal hardcodeado en el
   * preload, nunca un `on(channel, cb)` genérico.
   */
  onUpdaterStatus(callback: (payload: UpdaterStatusChangedEvent) => void): () => void
}

export type MinervaApi = InvokeApi & { events: EventsApi }
