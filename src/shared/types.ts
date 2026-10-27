/**
 * Modelos de dominio compartidos entre `main` y `renderer`.
 * Solo tipos (interfaces / type aliases) — sin clases, sin lógica.
 */
import type { AnalysisActivityItem, DraftDidacticSection } from './events'
import type { AiProviderCatalogEntry, AiProviderId } from './ai-providers'
import type { AppLocale } from './locale'
import type {
  FileContentSide,
  PrStack,
  RepoRef,
  ReviewerVote,
  ScmErrorCode,
  ScmProviderId,
  ScmProviderSettings,
  ThreadStatus,
} from './scm'

export type { RepoRef } from './scm'

export interface UserRef {
  login: string
  displayName?: string
  avatarUrl?: string
}

export type PullRequestState = 'open' | 'closed' | 'merged'

export type ReviewDecision = 'approved' | 'changes_requested' | 'review_required' | null

export type CiStatus = 'success' | 'failure' | 'pending' | null

/**
 * State filter for `scm:listPullRequests`. `'open'` is the default; `'closed'`
 * includes both closed and merged PRs (the UI tells them apart with a badge);
 * `'all'` does not filter by state.
 */
export type PrStateFilter = 'open' | 'closed' | 'all'

/**
 * "Seen" state of a PR for the sidebar, computed by `main/scm/seen-store.ts`
 * against the snapshot sealed the last time the user opened the PR:
 * `isNew` (never sealed), `hasUpdates` (`updatedAt` moved forward) and
 * `hasNewComments` (`commentCount` went up).
 */
export interface PrUnread {
  isNew: boolean
  hasUpdates: boolean
  hasNewComments: boolean
}

export interface PullRequestSummary {
  /** Provider-opaque PR id. Use `prKey(repo, number)` for cross-provider identity. */
  id: string
  number: number
  title: string
  author: UserRef
  repo: RepoRef
  state: PullRequestState
  isDraft: boolean
  createdAt: string
  updatedAt: string
  headRef: string
  baseRef: string
  /**
   * SHA of the head commit. Used to detect a stale analysis
   * (`DidacticAnalysis.headSha` vs. this current value). `''` if the provider
   * did not report it.
   */
  headSha: string
  /** Link to the PR on the provider's website. */
  webUrl: string
  /** `null` = the provider didn't report it (the UI hides it). */
  commentCount: number | null
  reviewDecision: ReviewDecision
  ciStatus: CiStatus
  additions: number | null
  deletions: number | null
  changedFiles: number | null
  /**
   * Optional on purpose: only the IPC handler (`scm:listPullRequests`)
   * decorates it against `seen-store.ts`; providers stay unaware of read state.
   */
  unread?: PrUnread
}

export interface PrReviewer {
  user: UserRef
  vote: ReviewerVote
  isRequired: boolean
}

export interface PrWorkItem {
  id: string
  title: string
  url: string
  type?: string
  state?: string
}

export interface PullRequestDetail extends PullRequestSummary {
  bodyMarkdown: string
  labels: { name: string; color?: string }[]
  reviewers: PrReviewer[]
  commits: number
  workItems?: PrWorkItem[]
  /**
   * True when the provider capped the file list (e.g. 300 files): the Files tab
   * and the AI prompt must say that some files are not shown. `changedFiles`
   * stays the TRUE total when the provider knows it.
   */
  filesTruncated?: boolean
}

export type RetargetResult =
  { outcome: 'retargeted'; pr: PullRequestSummary } | { outcome: 'cancelled' }

export type DiffFileStatus = 'added' | 'modified' | 'removed' | 'renamed'

export interface DiffFile {
  path: string
  previousPath?: string
  status: DiffFileStatus
  additions: number
  deletions: number
  /** Unified diff hunks for this file; absent for binaries. Always built in main. */
  patch?: string
  isBinary: boolean
  /**
   * Why a text file has no `patch` even though it changed:
   * - `too_large`: one side is over the per-file cap, or its line diff timed out.
   * - `diff_budget`: the PR as a whole went over the per-PR diff budget
   *   (files, bytes or diff time), so later files were listed without a patch.
   * Absent when there is a patch, for binaries, and for providers that send
   * their own patch (GitHub).
   */
  patchOmitted?: 'too_large' | 'diff_budget'
}

export interface PrComment {
  id: string
  author: UserRef
  bodyMarkdown: string
  createdAt: string
  isMinimized: boolean
  /**
   * Permanent URL of the comment on the provider's website, so it can be
   * copied and referenced outside the app. Optional: without it the UI just
   * doesn't offer the copy button.
   */
  htmlUrl?: string
}

export interface CommentThread {
  id: string
  status: ThreadStatus
  /** Derived: `!isThreadOpen(status)`. Kept for the many call sites that only care about open/closed. */
  isResolved: boolean
  isLineThread: boolean
  path?: string
  line?: number
  /** Last line of a multi-line thread, when the provider reports a range. */
  lineEnd?: number
  side?: 'LEFT' | 'RIGHT'
  /** The thread's anchor no longer matches the latest iteration of the PR. */
  isOutdated?: boolean
  comments: PrComment[]
}

/** Request of `scm:postComment`. */
export interface PostCommentRequest {
  repo: RepoRef
  number: number
  bodyMarkdown: string
  threadId?: string
  path?: string
  line?: number
  /** Diff side of `line`; only applies to new line threads. */
  side?: 'LEFT' | 'RIGHT'
}

/** Request of `scm:setThreadStatus`. `status` must be in `SETTABLE_THREAD_STATUSES[repo.provider]`. */
export interface SetThreadStatusRequest {
  repo: RepoRef
  number: number
  threadId: string
  status: ThreadStatus
}

/**
 * Request of `scm:getFileContent`: `path` at the PR's merge base (`base`, what
 * LEFT-side line numbers refer to) or at its head commit (`head`, RIGHT side).
 */
export interface FileContentRequest {
  repo: RepoRef
  number: number
  path: string
  side: FileContentSide
}

/**
 * Request of `scm:retarget`. Branch names are short (`feature/x`). Main
 * re-checks before writing: the PR is open, its base is still
 * `expectedCurrentBase` (else `CONFLICT`), `newBase` exists and is not the
 * PR's own head branch.
 */
export interface RetargetRequest {
  repo: RepoRef
  number: number
  expectedCurrentBase: string
  newBase: string
}

/** One provider that failed while listing PRs (the others still return items). */
export interface ScmListError {
  provider: ScmProviderId
  code: ScmErrorCode
  message: string
}

/** Response of `scm:listPullRequests`: fan-out over every enabled provider. */
export interface ListPullRequestsResult {
  items: PullRequestSummary[]
  errors: ScmListError[]
}

/** Response of `scm:getStacks`: stacks of every enabled provider; failures land in `errors`. */
export interface GetStacksResult {
  stacks: PrStack[]
  errors: ScmListError[]
  /**
   * Set when orphan detection hit its lookup cap: only `checked` of `total`
   * candidate base branches were looked up, so some orphans may be missing.
   */
  orphanLookupsCapped?: { checked: number; total: number }
}

/**
 * One account the `gh` CLI knows on the GitHub host. `gh` supports several at
 * once and, without `--user`, resolves the one it marks active. Minerva lets
 * the user pick one (persisted as `githubAccount`) without touching the CLI's
 * global choice — see `main/scm/github/gh-accounts.ts`.
 */
export interface GhAccount {
  login: string
  /** `true` for `gh`'s own active account (the one used without `--user`). */
  active: boolean
  /** `false` when `gh` reports that account's token as invalid/expired. */
  valid: boolean
}

/**
 * Source-control settings, returned by `scm:getSettings`,
 * `scm:setGithubAccount` and `scm:setProviderSettings`.
 *
 * - `mockScm`: `true` with `MINERVA_MOCK=1` (mock SCM data: the "shopwave"
 *   GitHub universe and the "contoso" Azure DevOps one). The renderer needs it
 *   to hide the "you need an AI CLI" card: with mock data the demo works
 *   without any AI CLI (via `MockAiService`).
 * - `githubAccount`: the `gh` login picked by hand, or `null` to follow
 *   `gh`'s active account.
 * - `providers`: effective per-provider settings (enabled flags, Azure orgs
 *   and projects). In mock mode Azure always lists the "contoso" universe.
 * - `azureSettingsSource`: `saved` when the user saved Azure settings;
 *   `az-cli-defaults` when they come from `az devops configure --defaults`
 *   (nothing saved yet); `none` when neither exists.
 */
export interface ScmSettingsInfo {
  mockScm: boolean
  githubAccount: string | null
  providers: ScmProviderSettings
  azureSettingsSource: 'saved' | 'az-cli-defaults' | 'none'
}

/** Request of `scm:setProviderSettings`: each present provider block replaces the saved one. */
export interface SetProviderSettingsRequest {
  github?: ScmProviderSettings['github']
  azure?: ScmProviderSettings['azure']
}

/** Panel didáctico: cada sección se autodescribe con un `kind` discriminante. */

interface DidacticSectionCommon {
  markdown: string
}

export interface DidacticSnippet {
  label: string
  language: 'curl' | 'http' | 'bash' | 'env'
  code: string
}

export type DidacticSection =
  | ({ kind: 'summary' } & DidacticSectionCommon)
  | ({ kind: 'setup'; snippets: DidacticSnippet[] } & DidacticSectionCommon)
  | ({ kind: 'architecture'; mermaid: string } & DidacticSectionCommon)
  | ({ kind: 'endpoint'; snippets: DidacticSnippet[] } & DidacticSectionCommon)
  | ({ kind: 'schema'; mermaid: string } & DidacticSectionCommon)
  /**
   * A diferencia de `architecture`/`schema` (un solo `mermaid`), `cloud`
   * lleva hasta DOS diagramas Mermaid en orden de aparición: el 1º es el big
   * picture de la infra (AWS/Cloudflare/...) y el 2º un zoom a lo que toca el
   * PR. Con 0 diagramas la sección sigue siendo válida (solo markdown).
   */
  | ({ kind: 'cloud'; mermaids: string[] } & DidacticSectionCommon)

/**
 * Lo que produce un `AiService.analyzePullRequest` (T39): el contenido puro
 * del análisis, sin metadata de generación. Forma idéntica a la vieja
 * `DidacticAnalysis` (pre-T39) — el split existe para que los servicios
 * (`providers/opencode-service.ts`, `providers/claude-code-service.ts`,
 * `providers/codex-service.ts`, `mock-service.ts`) no necesiten conocer
 * `headSha`/`generatedWith`, que solo el handler (`ipc/handlers.ts`) sella
 * (T40) antes de cachear/persistir/devolver al renderer.
 */
export interface GeneratedAnalysis {
  prId: string
  sections: DidacticSection[]
  generatedAt: string
}

/**
 * Metadata de CON QUÉ se generó un análisis (T39): proveedor+modelo+opciones
 * (p. ej. `effort`) EFECTIVOS en el momento de generar, capturados por el
 * handler vía `getEffectiveAiSelection()` — NUNCA la config vigente en el
 * momento de mostrar el análisis (eso es precisamente el Issue 1 que motiva
 * F9, ver `.agents/PLAN.md`).
 */
export interface AnalysisGenerationInfo {
  provider: AiProviderId
  model: string
  options: Record<string, string>
}

/**
 * Análisis didáctico completo, CACHEADO/PERSISTIDO y devuelto al renderer
 * (T39): extiende `GeneratedAnalysis` con `headSha` (SHA del head del PR al
 * momento de generar, para detectar staleness — T41/T42) y `generatedWith`
 * (con qué proveedor/modelo/opciones se generó, para que el banner del panel
 * didáctico no mienta si el usuario cambia la config después — Issue 1 de
 * F9). SOLO el handler (`ipc/handlers.ts`) construye este objeto enriquecido
 * a partir del `GeneratedAnalysis` que produce el `AiService`; los servicios
 * NUNCA tocan `headSha`/`generatedWith` directamente.
 */
export interface DidacticAnalysis extends GeneratedAnalysis {
  headSha: string
  generatedWith: AnalysisGenerationInfo
  /**
   * Language the analysis was written in: the UI language when it was
   * requested (captured at start, like `generatedWith`). The renderer offers
   * to regenerate when it differs from the current UI language. Analyses
   * persisted before i18n carry no field on disk: they were Spanish, and
   * `analysis-store.ts` loads them as `es`.
   */
  language: AppLocale
}

/**
 * Estado de un análisis didáctico para un PR concreto (T22, canal
 * `ai:getAnalysisState`), sin dispararlo ni esperar a que termine: lo usa el
 * hook `use-didactic-analysis.ts` al MONTAR (panel acoplado o ventana
 * desacoplada) para decidir si debe quedarse en el placeholder (`idle`),
 * engancharse a un streaming ya en curso mostrando el último snapshot
 * conocido (`streaming`) o pintar directo un resultado ya pagado
 * (`cached`) — los tres casos que antes dejaban a una ventana recién
 * montada mirando el placeholder aunque el análisis ya estuviera corriendo
 * o completo. `sections` usa `DraftDidacticSection` (importado de
 * `./events.ts`, tipo-only para no crear un ciclo de imports en runtime: ese
 * archivo a su vez importa tipos de este) porque un análisis en curso puede
 * tener secciones a medio cerrar, igual que en `AnalysisProgressEvent`.
 * `activity` (F13, aditivo/opcional) es el buffer rodante del mini-log de
 * actividad del harness en ese instante — mismo tipo y semántica que
 * `AnalysisProgressEvent.activity` — para que una ventana que se engancha
 * tarde pinte "qué está pasando" de inmediato en vez de esperar al próximo
 * evento de progreso.
 */
export type AnalysisState =
  | { status: 'idle' }
  | { status: 'streaming'; sections: DraftDidacticSection[]; activity?: AnalysisActivityItem[] }
  | { status: 'cached'; analysis: DidacticAnalysis }

/**
 * Fuente de un valor de modelo resuelto (T12; generalizado a multi-proveedor
 * en T26, ver `AiSettingsInfo` más abajo): `settings` (guardado desde la UI,
 * gana siempre) > `env` (`MINERVA_AI_MODEL` del proceso o del `.env` de raíz
 * en dev) > `default` (`DEFAULT_MODEL_BY_PROVIDER` en `shared/ai-providers.ts`).
 */
export type AiModelSource = 'settings' | 'env' | 'default'

/**
 * Respuesta de `settings:get`/`settings:setAiProvider`/`settings:setProviderModel`
 * (T26, multi-proveedor). `provider`/`model` es la selección EFECTIVA (con la
 * misma precedencia settings > env > default, ver `getEffectiveAiSelection`
 * en `main/ai/env.ts`); `modelSource` indica de dónde vino `model` (mismo
 * significado que `AiModelSource`, evaluado para el `provider` resuelto);
 * `perProviderModel` es el mapa persistido completo (para que la UI, aunque
 * cambie de proveedor sin guardar, pueda recordar el último modelo elegido de
 * cada uno); `catalog` es el catálogo completo de proveedores+modelos
 * (`shared/ai-providers.ts`, con los `options` por modelo desde T34) para que
 * el renderer pinte las opciones sin un segundo roundtrip.
 *
 * `selectedOptions` (T34, F8): las opciones de modelo (p. ej. `effort`) YA
 * RESUELTAS (`main/ai/env.ts`, `getEffectiveAiSelection().options`) para el
 * proveedor+modelo ACTIVO — indexado por proveedor (mínimo: la entrada del
 * `provider` de arriba) para que T37 pinte el selector de opciones sin tener
 * que resolver nada del lado del renderer.
 */
export interface AiSettingsInfo {
  provider: AiProviderId
  model: string
  modelSource: AiModelSource
  perProviderModel: Partial<Record<AiProviderId, string>>
  catalog: Record<AiProviderId, AiProviderCatalogEntry>
  selectedOptions?: Partial<Record<AiProviderId, Record<string, string>>>
}

/**
 * Estado de login por proveedor de IA (T27, canal `ai:getProviderStatus`;
 * los tres proveedores son `cli` desde T59 — hasta entonces OpenRouter
 * resolvía `unavailable`/`authenticated` de forma síncrona según hubiera o
 * no `OPENROUTER_API_KEY` configurada):
 * - `unavailable`: el CLI (`claude`/`codex`/`opencode`) no está usable. Desde
 *   F14.1 trae `reason` para distinguir las DOS causas que antes se
 *   mezclaban (y que la UI reportaba igual, como "no está en tu PATH" —
 *   mensaje engañoso cuando el binario SÍ estaba pero el probe falló):
 *   - `'not-found'`: no se encontró en PATH ni en las ubicaciones comunes.
 *   - `'probe-failed'`: se encontró (ver `resolvedPath`) pero la
 *     comprobación (`--version` con timeout, o la versión mínima en
 *     OpenCode) falló — ver `main/ai/providers/cli-probe.ts`.
 * - `installed`: el CLI existe y responde, pero no se pudo confirmar sesión
 *   iniciada (best-effort en T27; T28/T29/T57 lo reemplazan por el handshake
 *   real del SDK/RPC de cada proveedor).
 * - `authenticated`: un CLI con indicios de sesión iniciada.
 *
 * `account` NUNCA lleva tokens/keys — a lo sumo un email/plan de exhibición.
 * `resolvedPath` es la ruta del binario del usuario (no un secreto): existe
 * para que el mensaje de `probe-failed` sea accionable.
 */
export type AiProviderStatusValue = 'unavailable' | 'installed' | 'authenticated'

export type AiProviderUnavailableReason = 'not-found' | 'probe-failed'

export interface AiAccountInfo {
  email?: string
  plan?: string
}

export interface AiProviderStatus {
  status: AiProviderStatusValue
  /** Solo con `status: 'unavailable'`: por qué (ver el comentario de arriba). */
  reason?: AiProviderUnavailableReason
  /** Solo con `reason: 'probe-failed'`: dónde se encontró el binario que no respondió. */
  resolvedPath?: string
  account?: AiAccountInfo
}

/**
 * Datos mínimos de una release disponible para el auto-updater (T90, F17;
 * contrato — la lógica real llega en T91/`main/updater/updater.ts`).
 *
 * **A propósito NO lleva `releaseNotes`**: `electron-updater` las entrega tal
 * cual las puso GitHub, es decir **HTML crudo** — renderizarlas en el
 * renderer sería abrir un XSS por la puerta grande (mismo criterio que
 * "tratar el contenido de PRs como no confiable" del `CLAUDE.md`). En v0.7.0
 * el camino es enlazar a la release (`releaseUrl` + `updater:openReleasePage`)
 * y punto — es un recorte de alcance CONSCIENTE, no un olvido.
 *
 * `releaseUrl` la construye **main**, nunca el feed: plantilla hardcodeada con
 * `RELEASE_OWNER`/`RELEASE_REPO` (`main/updater/config.ts`) más `version`
 * **validada como semver** antes de interpolarla. Jamás una URL que venga tal
 * cual del feed de `electron-updater`.
 */
export interface UpdateInfoLite {
  version: string
  releaseUrl: string
  releaseDate?: string
}

/**
 * Estado del auto-updater (T90, F17), expuesto por `updater:getStatus` y
 * empujado por `minerva:event:updaterStatusChanged` (`./events.ts`) — union
 * discriminada por `phase`, un solo campo `status` en la UI en vez de
 * booleanos sueltos (mismo criterio que `AnalysisState`).
 *
 * - `disabled`: no hay updater corriendo. Es el estado en dev
 *   (`!app.isPackaged`) y en TODA la suite e2e, o si se fuerza con
 *   `MINERVA_UPDATER=off` — nunca toca la red.
 * - `unsupported`: la instalación existe empaquetada pero esta forma
 *   concreta de instalación no puede auto-actualizarse; `reason` distingue
 *   POR QUÉ:
 *   - `'mac-unsigned'`: macOS sin Developer ID (decisión de producto de F17;
 *     el Developer ID llega después, ver `PLAN.md` § F17).
 *   - `'not-appimage'`: Linux sin `$APPIMAGE` definido — `linux-unpacked` o
 *     un paquete de la distro (deb/rpm/pacman), no la AppImage oficial.
 *   - `'not-writable'`: hay `$APPIMAGE` pero el archivo o su directorio padre
 *     no son escribibles (AppImageLauncher, instalado bajo `/opt`, o
 *     corriendo como root).
 *   `available` es OPCIONAL: en `unsupported` SÍ se consulta el feed y se
 *   compara semver contra la versión instalada (para poder ofrecer "ver la
 *   release" si hay una más nueva), pero nunca se descarga ni se instala nada
 *   — la sola presencia de este campo no habilita el botón de descarga.
 * - `idle`: soportado, sin update pendiente. `lastCheckedAt` (ISO) es
 *   opcional: ausente antes del primer chequeo de esta sesión.
 * - `checking`: hay un chequeo contra el feed en curso (arranque, intervalo
 *   de 6h, o botón manual).
 * - `available`: el feed ofrece una versión más nueva que la instalada,
 *   todavía sin descargar (`autoDownload: false` — la descarga requiere
 *   consentimiento explícito del usuario, son ~130 MB).
 * - `downloading`: descarga en curso tras ese consentimiento; `percent` es
 *   0-100.
 * - `downloaded`: **descargada, se instala AL SALIR de la app**
 *   (`autoInstallOnAppQuit: true`) — esto NO significa "ya instalada". Existe
 *   una acción secundaria (`updater:quitAndInstall`) para reiniciar ya mismo,
 *   pero el camino principal es seguir usando Minerva y que se instale sola
 *   al cerrar.
 * - `error`: el último chequeo/descarga falló; `message` es texto de
 *   exhibición (sin stack interno de main, misma frontera que el resto de
 *   IPC) y `lastCheckedAt` conserva el momento del último chequeo exitoso
 *   previo, si lo hubo.
 */
export type UpdaterStatus =
  | { phase: 'disabled' }
  | {
      phase: 'unsupported'
      reason: 'mac-unsigned' | 'not-appimage' | 'not-writable'
      available?: UpdateInfoLite
    }
  | { phase: 'idle'; lastCheckedAt?: string }
  | { phase: 'checking' }
  | { phase: 'available'; info: UpdateInfoLite }
  | { phase: 'downloading'; info: UpdateInfoLite; percent: number }
  | { phase: 'downloaded'; info: UpdateInfoLite }
  | { phase: 'error'; message: string; lastCheckedAt?: string }
