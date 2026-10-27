/**
 * Interfaz de la capa IA en `main`. Un único método que espeja el canal IPC
 * `ai:analyzePullRequest` (`src/shared/ipc.ts`) en su `req` (se toma
 * `IpcRequest` de ahí para no duplicar la forma); su `res` YA NO es
 * `IpcResponse<'ai:analyzePullRequest'>` (T39, ver más abajo).
 *
 * Varias implementaciones conviven detrás de esta interfaz:
 * - `MockAiService` (`./mock-service.ts`), disponible desde T9(mock)/T10.
 * - `ClaudeCodeAiService`/`CodexAiService`/`OpenCodeAiService`
 *   (`./providers/*-service.ts`, T28/T29/T56): pipeline real contra el CLI
 *   oficial de cada proveedor (prompt versionado en `./prompts/analyze-pr.ts`),
 *   activo cuando `./providers/cli-probe.ts` confirma sesión iniciada (ver
 *   `./index.ts`). Hasta T59 había una cuarta, `OpenRouterAiService`, que
 *   hablaba HTTP directo con `openrouter.ai` — eliminada por decisión de
 *   Edilson (esos modelos se usan ahora DENTRO de OpenCode).
 *
 * `src/main/ipc/handlers.ts` delega el canal `ai:analyzePullRequest` a una
 * única instancia creada por `createAiService(prContext)` (`./index.ts`).
 *
 * T13 (streaming): `analyzePullRequest` acepta un segundo parámetro opcional
 * con `onProgress`, invocado cero o más veces DURANTE el análisis con un
 * snapshot parcial (`DraftDidacticSection[]`, `../../shared/events.ts`) y
 * exactamente una vez más al terminar (`meta.done === true`, con las
 * secciones finales). `onProgress` es solo para pintar el panel en vivo
 * mientras tanto, nunca la única forma de obtener el resultado.
 *
 * T39: `analyzePullRequest` retorna `Promise<GeneratedAnalysis>` (SOLO el
 * contenido: `prId`+`sections`+`generatedAt`), NO el `DidacticAnalysis`
 * completo que recibe el renderer. El handler (`../ipc/handlers.ts`) es quien
 * enriquece ese contenido a `DidacticAnalysis` sellando `headSha` (SHA del
 * head del PR al generar) y `generatedWith` (proveedor/modelo/opciones
 * efectivos), antes de cachear/persistir/devolver — ver T40. Services only
 * report the `headSha` they analyzed (`AnalyzeResult`); `generatedWith` is the
 * handler's.
 */
import type { IpcRequest } from '../../shared/ipc'
import type { AppLocale } from '../../shared/locale'
import type { GeneratedAnalysis, LineQuestion } from '../../shared/types'
import type { AnalysisActivityItem, DraftDidacticSection } from '../../shared/events'

export interface AnalyzeProgressMeta {
  /** `true` en la última llamada a `onProgress`: el análisis ya terminó (con éxito). */
  done: boolean
  /**
   * Fase del streaming AGÉNTICO (F11/T60): mismo campo/significado que
   * `AnalysisProgressEvent.phase` (`../../shared/events.ts`, ver ahí el
   * comentario completo) — los TRES proveedores agénticos
   * (`./providers/{claude-code,codex,opencode}-service.ts`) lo pasan en cada
   * llamada intermedia; la llamada FINAL (`done: true`) lo omite a propósito
   * (decisión T60: `sections` ya es la fuente de verdad en ese punto, no
   * hace falta distinguir fase). Desde F13 el `MockAiService` TAMBIÉN lo
   * emite (antes lo omitía) — ver el comentario de
   * `AnalysisProgressEvent.phase` en `../../shared/events.ts`.
   */
  phase?: 'exploring' | 'writing'
  /**
   * Mini-log de actividad del harness (F13): mismo campo/semántica que
   * `AnalysisProgressEvent.activity` (`../../shared/events.ts`, comentario
   * completo ahí). Los proveedores lo llenan con
   * `createActivityTracker().buffer()` (`./activity-tracker.ts`) en cada
   * llamada intermedia; la FINAL (`done: true`) lo omite — es efímero, nunca
   * forma parte del análisis cacheado.
   */
  activity?: AnalysisActivityItem[]
}

export type AnalyzeProgressCallback = (
  sections: DraftDidacticSection[],
  meta: AnalyzeProgressMeta,
) => void

export interface AnalyzePullRequestOptions {
  onProgress?: AnalyzeProgressCallback
  /**
   * Language the analysis is written in (system prompt rule, mock fixtures,
   * activity labels). The handler passes the UI language captured at start,
   * the same value it seals as `DidacticAnalysis.language`. Absent = the
   * current main locale (`getMainLocale()`).
   */
  language?: AppLocale
  /**
   * Set by `ai:askAboutLines`: answer this reviewer question about some
   * lines instead of writing the full analysis (`../task-prompts.ts`). The
   * run is the same (snapshot, read-only tools, timeouts); the result holds
   * one `summary` section with the answer.
   */
  question?: LineQuestion
}

/**
 * What a service returns: the generated content plus the `headSha` of the
 * commit it analyzed (the service already fetched the PR detail to build the
 * snapshot, so the handler doesn't fetch it a second time).
 */
export interface AnalyzeResult extends GeneratedAnalysis {
  headSha: string
}

export interface AiService {
  analyzePullRequest(
    req: IpcRequest<'ai:analyzePullRequest'>,
    options?: AnalyzePullRequestOptions,
  ): Promise<AnalyzeResult>
}
