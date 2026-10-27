import { app, BrowserWindow } from 'electron'
import { handle } from './register'
import { createAiService } from '../ai'
import { getAiSettingsInfo, getEffectiveAiSelection, providerNeedingCatalogWarmup } from '../ai/env'
import { getAiProviderStatusMap } from '../ai/providers/provider-status'
import { getProviderModels, warmProviderModels } from '../ai/providers/provider-models'
import { analysisCache } from '../ai/analysis-cache'
import { settingsStore } from '../settings/store'
import { ghCliAuth } from '../scm/github/gh-cli-auth'
import { isMockScmMode } from '../scm/mock-mode'
import { createDefaultScm, type DefaultScm } from '../scm/default-scm'
import { createPrContextSource } from '../scm/pr-context-source'
import { createPrWatcher, type PrWatcher } from '../scm/pr-watcher'
import { createAzureOrgAccess } from '../scm/azure-org-access'
import { nativeConfirm } from '../scm/confirm'
import { getAuthStatusMap, listAcrossProviders } from '../scm/registry'
import { retargetPullRequest } from '../scm/retarget'
import { seenStore } from '../scm/seen-store'
import { openDidacticWindow, refreshDidacticWindowTitle } from '../windows/didactic-window'
import { getMainLocale, setMainLocale } from '../i18n'
import * as updaterService from '../updater/updater'
import {
  MINERVA_EVENTS,
  type AnalysisActivityItem,
  type AnalysisProgressEvent,
  type DraftDidacticSection,
  type LanguageChangedEvent,
  type PrListChangedEvent,
} from '../../shared/events'
import type { IpcResponse } from '../../shared/ipc'
import { prKey } from '../../shared/scm'
import type { DidacticAnalysis, ScmSettingsInfo } from '../../shared/types'

/** Pushes a progress snapshot to EVERY open window; filtering by PR is the renderer hook's job. */
function broadcastProgress(payload: AnalysisProgressEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(MINERVA_EVENTS.analysisProgress, payload)
    }
  }
}

/** Pushes the PR watcher's changes to every open window (same pattern as `broadcastProgress`). */
function broadcastPrListChanged(payload: PrListChangedEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(MINERVA_EVENTS.prListChanged, payload)
    }
  }
}

/** Pushes the new UI language to every open window (main + detached didactic). */
function broadcastLanguageChanged(payload: LanguageChangedEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(MINERVA_EVENTS.languageChanged, payload)
    }
  }
}

/**
 * PR watcher interval: `MINERVA_WATCH_INTERVAL_MS` overrides it (e2e uses it
 * to avoid waiting 60 real seconds). Only a positive integer is accepted;
 * anything else is ignored instead of breaking startup.
 */
function resolveWatchIntervalMs(): number | undefined {
  const raw = process.env.MINERVA_WATCH_INTERVAL_MS
  if (!raw) return undefined
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function getScmSettings(root: DefaultScm): ScmSettingsInfo {
  return {
    mockScm: isMockScmMode(),
    githubAccount: settingsStore.getGithubAccount(),
    ...root.settings.current(),
  }
}

/**
 * Registers every IPC handler. `scm:*` channels go through ONE provider
 * registry (`../scm/registry.ts`): per-repo calls resolve the provider with
 * `forRepo`, list calls fan out over every enabled provider. The AI layer
 * gets the same registry behind a narrow `PrContextSource`, so it analyzes
 * whatever the SCM layer serves (mock or real) without knowing which.
 *
 * Async because `createAiService` may probe a CLI before picking a service.
 * Returns `stopPrWatcher` so `../index.ts` can stop the watcher on quit.
 */
export async function registerIpcHandlers(): Promise<{ stopPrWatcher: () => void }> {
  // Main's own text (dialogs, error messages, window titles, the AI prompt)
  // follows the saved UI language from the first call on.
  setMainLocale(settingsStore.getLanguage())

  handle('minerva:ping', () => 'pong from main @ electron ' + process.versions.electron)
  handle('minerva:getVersion', () => app.getVersion())

  const scmRoot = await createDefaultScm()
  const scm = scmRoot.registry
  const prContext = createPrContextSource(scm)

  handle('scm:getAuthStatus', () => getAuthStatusMap(scm))
  // `gh` accounts for the Settings picker. Read-only, cached 5s; logins only.
  handle('scm:listGhAccounts', () => ghCliAuth.listAccounts())
  handle('scm:getSettings', () => getScmSettings(scmRoot))
  // Which Azure orgs main may use the credential with when the renderer names
  // one (Settings): configured / known to az, or confirmed in a native dialog.
  const azureOrgs = createAzureOrgAccess({
    current: () => scmRoot.settings.current().providers,
    knownOrganizations: () => scmRoot.settings.knownAzureOrganizations(),
  })
  // Enabled flags + Azure orgs/projects. A new org is confirmed natively
  // first (declined = nothing saved, current settings answered). Drops what
  // depended on the old values; the credential cache only when the org set
  // changed (rate-limited).
  handle('scm:setProviderSettings', async (req, event) => {
    await azureOrgs.saveSettings(req, nativeConfirm(event.sender), {
      save: (next) => scmRoot.settings.save(next),
      invalidateAzure: (options) => scmRoot.azure.invalidate(options),
      invalidateStacks: () => scmRoot.stacks.invalidate(),
    })
    return getScmSettings(scmRoot)
  })
  handle('scm:listAzureProjects', async (req, event) => {
    await azureOrgs.ensureProjectsLookupAllowed(req.organization, nativeConfirm(event.sender))
    return { projects: await scmRoot.azure.listProjects(req.organization) }
  })
  // Persists the chosen `gh` login (`null` = follow gh's active account) and
  // DROPS the token-bridge caches — otherwise the next status would serve
  // the previous account's probe for up to 5s and, worse, `getToken()` would
  // keep feeding its token to the data path. Warms the probe for the new one.
  handle('scm:setGithubAccount', async (req) => {
    settingsStore.setGithubAccount(req.login)
    ghCliAuth.invalidate()
    await ghCliAuth.getStatus()
    return getScmSettings(scmRoot)
  })

  // `unread` is decorated HERE, not in providers: they stay unaware of read
  // state, which lives in `seenStore`.
  handle('scm:listPullRequests', async (req) => {
    const { items, errors } = await listAcrossProviders(scm, req)
    return {
      items: items.map((pr) => ({ ...pr, unread: seenStore.computeUnread(pr) })),
      errors,
    }
  })
  handle('scm:markPrSeen', (req) => {
    seenStore.markSeen(prKey(req.repo, req.number), {
      updatedAt: req.updatedAt,
      commentCount: req.commentCount,
    })
    return { ok: true as const }
  })
  handle('scm:getPullRequestDetail', (req) =>
    scm.forRepo(req.repo).getPullRequestDetail(req.repo, req.number),
  )
  handle('scm:getPullRequestFiles', (req) =>
    scm.forRepo(req.repo).getPullRequestFiles(req.repo, req.number),
  )
  handle('scm:getCommentThreads', (req) =>
    scm.forRepo(req.repo).getCommentThreads(req.repo, req.number),
  )
  handle('scm:postComment', (req) => scm.forRepo(req.repo).postComment(req))
  handle('scm:setThreadStatus', (req) => scm.forRepo(req.repo).setThreadStatus(req))
  handle('scm:getFileContent', (req) => scm.forRepo(req.repo).getFileContent(req))
  // Validated in `retargetPullRequest` (open, base unchanged, new base
  // exists; a stale UI gets `[SCM:CONFLICT]`), then confirmed in a native
  // dialog on the caller's window, re-checked, and only then written.
  handle('scm:retarget', async (req, event) => {
    const result = await retargetPullRequest(
      scm.forRepo(req.repo),
      req,
      nativeConfirm(event.sender),
    )
    if (result.outcome === 'retargeted') scmRoot.stacks.invalidate()
    return result
  })
  handle('scm:getStacks', (req) => scmRoot.stacks.get({ refresh: req?.refresh === true }))

  // Background PR watcher: lists `{ state: 'all' }` across providers on an
  // interval and pushes `prListChanged` when something changed. Not decorated
  // with `unread` (it only diffs state/updatedAt/commentCount).
  const prWatcher: PrWatcher = createPrWatcher({
    list: () => listAcrossProviders(scm, { state: 'all' }),
    broadcast: broadcastPrListChanged,
    intervalMs: resolveWatchIntervalMs(),
  })
  prWatcher.start()

  /**
   * Registro de análisis EN CURSO por PR (T22). Sin esto, dos solicitudes
   * simultáneas del mismo PR —un re-click de "Analizar PR" mientras el
   * primero sigue en vuelo, o una ventana desacoplada abierta a mitad de un
   * streaming— disparaban una SEGUNDA llamada al LLM cada una: el cache de
   * abajo (`analysisCache`) solo ve análisis ya COMPLETOS, nunca uno a medio
   * hacer. Vive local a esta función (no a nivel de módulo) porque
   * conceptualmente es estado del registro de handlers, igual que
   * `scm` de arriba.
   */
  const inFlightAnalyses = new Map<
    string,
    {
      promise: Promise<IpcResponse<'ai:analyzePullRequest'>>
      snapshot: DraftDidacticSection[]
      /** Buffer rodante del mini-log de actividad (F13), mismo criterio de getter vivo que `snapshot`. */
      activity: AnalysisActivityItem[]
    }
  >()

  handle('ai:analyzePullRequest', (req) => {
    // Cache hit: como hoy, sin tocar el registro in-flight (ya está
    // completo, no hay nada en vuelo que registrar).
    const cached = analysisCache.get(req.repo, req.number)
    if (cached) return Promise.resolve(cached)

    const key = prKey(req.repo, req.number)

    // In-flight hit: devolver LA MISMA promesa. Cero llamadas al AiService
    // adicionales — así una ventana desacoplada abierta a mitad de un
    // streaming, o un doble-click de "Analizar PR", no pagan el LLM dos veces.
    const existing = inFlightAnalyses.get(key)
    if (existing) return existing.promise

    // `snapshotBox` se declara ANTES de arrancar el análisis: el mock
    // (`../ai/mock-service.ts`) llama a `onProgress` de forma SÍNCRONA en su
    // primer chunk, y esa llamada puede ocurrir mientras la promesa de abajo
    // todavía se está construyendo (antes de que `entry` termine de
    // registrarse en el Map) — mutar un objeto que ya existe evita cualquier
    // orden de inicialización delicado.
    const snapshotBox: { current: DraftDidacticSection[] } = { current: [] }
    // Mismo criterio que `snapshotBox` pero para el mini-log de actividad
    // del harness (F13): caja mutable declarada antes de arrancar.
    const activityBox: { current: AnalysisActivityItem[] } = { current: [] }

    const promise = (async (): Promise<IpcResponse<'ai:analyzePullRequest'>> => {
      try {
        // Se resuelve el AiService POR ANÁLISIS, no una sola vez al arrancar:
        // desde T27 el PROVEEDOR activo (OpenRouter/Claude Code/Codex, ver
        // `../ai/index.ts`) sale de Settings y puede cambiar en runtime, así
        // que capturarlo en el closure del registro dejaría al panel usando el
        // proveedor viejo hasta reiniciar. Solo se llega acá en un análisis
        // NUEVO (los cache/in-flight hits retornan antes), y `createAiService`
        // consulta el probe de login ya cacheado (TTL corto), así que el costo
        // por llamada es mínimo.
        // El sello `generatedWith` se captura ACÁ, al arrancar, no al terminar
        // (T65, F12): los servicios leen la selección efectiva UNA vez al
        // inicio de su `analyzePullRequest` (opencode-service.ts:215,
        // claude-code-service.ts:182, codex-service.ts:170), así que un cambio
        // de Settings a mitad de un análisis (30-60s con proveedores
        // agénticos) no afecta la generación en vuelo — pero sellar con
        // `getEffectiveAiSelection()` DESPUÉS del await hacía mentir a la
        // metadata: un análisis generado por opencode/big-pickle quedaba
        // cacheado/persistido como si lo hubiera hecho la config nueva
        // (verificado empíricamente en F12; es la variante DURANTE del mismo
        // problema que T41 arregló para cambios POSTERIORES al análisis).
        // Queda una ventana teórica de milisegundos entre esta captura y la
        // lectura interna del servicio — irrelevante frente a la de 30-60s.
        //
        // Antes de resolver: calentar el catálogo dinámico SOLO si hace falta
        // (F19). `getEffectiveAiSelection()` es SÍNCRONO y resuelve las
        // opciones del modelo (el `effort`/`variant` elegido en Settings)
        // contra el último catálogo dinámico conocido
        // (`../ai/providers/model-catalog-snapshot.ts`), que en un arranque en
        // frío está vacío si el usuario nunca abrió Settings — y un modelo
        // NUEVO solo existe en el catálogo dinámico, así que sin esto su opción
        // se descartaría justo en el análisis. `providerNeedingCatalogWarmup()`
        // devuelve `null` cuando los descriptores ya están a mano: calentar
        // spawnea el CLI del proveedor y no hay que pagarlo en cada análisis.
        const providerToWarm = providerNeedingCatalogWarmup()
        if (providerToWarm) await warmProviderModels(providerToWarm)
        const selectionAtStart = getEffectiveAiSelection()
        // Same capture-at-start rule for the language: a switch mid-analysis
        // must not relabel what the model is already writing.
        const languageAtStart = getMainLocale()
        const aiService = await createAiService(prContext)
        const generated = await aiService.analyzePullRequest(req, {
          onProgress: (sections, meta) => {
            snapshotBox.current = sections
            // El `{ done: true }` que emite el servicio en éxito se SUPRIME
            // acá: se re-emite manualmente más abajo, DESPUÉS de poblar
            // `analysisCache`, para garantizar que quien reciba `done: true`
            // sin `error` ya encuentre el cache poblado (T22 — una ventana
            // enganchada al streaming no debe ver nunca un "terminó" que
            // todavía no se puede leer de `ai:getCachedAnalysis`).
            if (meta.done) return
            // `meta.phase` (T60) y `meta.activity` (F13) se propagan tal
            // cual, sin interpretarlos acá — main solo transporta; derivar
            // labels es cosa del tracker en el AiService, pintarlos es cosa
            // del renderer.
            if (meta.activity) activityBox.current = meta.activity
            broadcastProgress({
              repo: req.repo,
              number: req.number,
              sections,
              done: false,
              phase: meta.phase,
              activity: meta.activity,
            })
          },
        })

        // Sealing: the service returns the content plus the `headSha` it
        // analyzed (it already fetched the detail to build the snapshot, so
        // no second fetch here). `generatedWith` is `selectionAtStart`,
        // captured BEFORE creating the service — the selection actually used,
        // even if Settings changed mid-analysis.
        const { headSha, ...generatedContent } = generated
        const result: DidacticAnalysis = {
          ...generatedContent,
          headSha,
          generatedWith: selectionAtStart,
          language: languageAtStart,
        }

        analysisCache.set(req.repo, req.number, result)
        broadcastProgress({
          repo: req.repo,
          number: req.number,
          sections: snapshotBox.current,
          done: true,
        })
        return result
      } catch (error) {
        // Los `AiService` reales/mock NUNCA llaman a `onProgress` en el
        // camino de error (solo lanzan) — sin este evento terminal manual,
        // una ventana enganchada a este streaming se quedaría mostrando
        // "analizando…" para siempre ante un fallo.
        broadcastProgress({
          repo: req.repo,
          number: req.number,
          sections: snapshotBox.current,
          done: true,
          error: error instanceof Error ? error.message : String(error),
        })
        throw error
      } finally {
        inFlightAnalyses.delete(key)
      }
    })()

    // `snapshot` es un getter sobre `snapshotBox.current`, no una copia: así
    // `ai:getAnalysisState` (abajo) siempre lee el último valor, aunque haya
    // llegado después de que esta entrada se registrara en el Map.
    inFlightAnalyses.set(key, {
      promise,
      get snapshot() {
        return snapshotBox.current
      },
      get activity() {
        return activityBox.current
      },
    })

    return promise
  })

  /**
   * Estado actual de un análisis sin dispararlo ni pedir el resultado
   * completo (T22): lo consulta el hook del renderer al montar para decidir
   * entre quedarse en el placeholder (`idle`), engancharse a un streaming ya
   * en curso mostrando el último snapshot conocido (`streaming`) o pintar
   * directo un resultado ya pagado (`cached`).
   */
  handle('ai:getAnalysisState', (req) => {
    const cached = analysisCache.get(req.repo, req.number)
    if (cached) return { status: 'cached' as const, analysis: cached }

    const inFlight = inFlightAnalyses.get(prKey(req.repo, req.number))
    if (inFlight)
      return {
        status: 'streaming' as const,
        sections: inFlight.snapshot,
        activity: inFlight.activity,
      }

    return { status: 'idle' as const }
  })

  // Lectura pura del cache (T14): la usa la ventana desacoplada para pintar
  // un análisis ya pagado al montar, sin pasar por `ai:analyzePullRequest`
  // (que además de leer el cache sabe cómo generar uno nuevo si hace falta,
  // responsabilidad que este canal no necesita).
  handle('ai:getCachedAnalysis', (req) => analysisCache.get(req.repo, req.number))
  handle('ai:invalidateAnalysis', (req) => {
    analysisCache.invalidate(req.repo, req.number)
  })

  // Estado de login por proveedor (T27, `../ai/providers/provider-status.ts`):
  // los tres proveedores son `cli` — se resuelven vía un probe cacheado con
  // TTL corto, nunca bloqueante.
  handle('ai:getProviderStatus', () => getAiProviderStatusMap())

  // Modelos disponibles por proveedor (T35, F8): estático para Claude Code,
  // dinámicos (con cache TTL + fallback al curado) para Codex/OpenCode — ver
  // `../ai/providers/provider-models.ts`. Canal SEPARADO de `settings:get`
  // (síncrono): esto puede tardar/fallar por spawnear un proceso externo.
  handle('ai:getProviderModels', (req) => getProviderModels(req.provider))

  handle('settings:get', () => getAiSettingsInfo())
  handle('settings:setAiProvider', (req) => {
    settingsStore.setAiProvider(req.provider)
    return getAiSettingsInfo()
  })
  handle('settings:setProviderModel', (req) => {
    settingsStore.setProviderModel(req.provider, req.model)
    return getAiSettingsInfo()
  })
  // Opción de modelo (T34, F8 — p. ej. `effort`): persiste el valor elegido
  // para `provider`/`optionId` (`settingsStore.setModelOption`) y responde el
  // `AiSettingsInfo` actualizado, mismo patrón que los dos handlers de arriba.
  handle('settings:setModelOption', (req) => {
    settingsStore.setModelOption(req.provider, req.optionId, req.value)
    return getAiSettingsInfo()
  })

  handle('settings:getLanguage', () => settingsStore.getLanguage())
  // Persist, apply to main, retitle the detached window, then tell every
  // window (the one that asked included) so they all switch together.
  handle('settings:setLanguage', (req) => {
    settingsStore.setLanguage(req.language)
    setMainLocale(req.language)
    refreshDidacticWindowTitle()
    broadcastLanguageChanged({ language: req.language })
    return req.language
  })

  // Ventana didáctica desacoplada (T14, `../windows/didactic-window.ts`): una
  // sola instancia a la vez, mismo preload/webPreferences que la principal.
  handle('window:openDidactic', (req) => {
    openDidacticWindow(req.repo, req.number, req.title)
  })

  // Auto-updater (T90 contrato, T91 núcleo real, F17): delega 1:1 al
  // singleton de `../updater/updater.ts` (capacidad + `electron-updater` +
  // scheduler + broadcast a todas las ventanas, o el guion de
  // `../updater/mock-updater.ts` bajo `MINERVA_MOCK_UPDATER`).
  // `minerva:getVersion` de arriba es la única implementación final desde T90.
  handle('updater:getStatus', () => updaterService.getStatus())
  handle('updater:check', () => updaterService.checkNow())
  handle('updater:download', () => updaterService.download())
  handle('updater:quitAndInstall', () => updaterService.quitAndInstall())
  handle('updater:openReleasePage', async () => {
    await updaterService.openReleasePage()
    return { ok: true as const }
  })

  return { stopPrWatcher: () => prWatcher.stop() }
}
