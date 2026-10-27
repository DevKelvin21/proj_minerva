/**
 * Persistencia de settings de usuario (T12, reestructurado en T26), no
 * secreta (the GitHub token is never stored: it comes from `gh` and lives in memory,
 * see `../scm/github/gh-cli-auth.ts`): un `settings.json` plano en
 * `app.getPath('userData')`.
 *
 * Forma en disco desde T26 (multi-proveedor): `{ "aiProvider": "opencode",
 * "models": { "opencode": "<id>", "claude-code": "<id>", "codex": "<id>" } }`
 * — `aiProvider` es el proveedor ACTIVO; `models` guarda, por proveedor, el
 * último modelo elegido (puede tener entradas para proveedores que no están
 * activos, para no perder la selección al cambiar de proveedor y volver).
 *
 * Migración desde la forma pre-T26 (`{ "aiModel": "<id de openrouter.ai/models>" }`,
 * la única que existía cuando solo había OpenRouter): al leerla se traduce a
 * la forma nueva sin perder la selección previa del usuario — ver
 * `migrateRaw()` más abajo, que desde T59 hace un segundo salto (ver próximo
 * párrafo) para que el resultado final NUNCA tenga `openrouter` como
 * proveedor, sea cual sea la forma original en disco.
 *
 * Migración OpenRouter -> OpenCode (T59): decisión de Edilson — Minerva deja
 * de hablar con OpenRouter directamente, así que `'openrouter'` deja de ser
 * un `AiProviderId` válido (`../../shared/ai-providers.ts`). Un
 * `settings.json` que todavía tenga `aiProvider: 'openrouter'` (o una entrada
 * `models.openrouter`/`modelOptions.openrouter`, activo o no) migra así:
 * - `aiProvider: 'openrouter'` -> `'opencode'`.
 * - `models.openrouter: '<id>'` -> `models.opencode: 'openrouter/<id>'` (SOLO
 *   si no hay ya un modelo de OpenCode guardado — una elección real de
 *   OpenCode gana sobre la migración) — `openrouter/<id>` es el slug con el
 *   que OpenCode nombra un modelo servido por su upstream `openrouter` (tras
 *   `opencode auth login`), no un id inventado.
 * - `modelOptions.openrouter` se DESCARTA (no se migra): el catálogo curado
 *   de OpenCode no declara el mismo descriptor `effort` para sus modelos
 *   fallback, y el modelo dinámico real puede tener una escala de effort
 *   distinta a la que tenía en OpenRouter — arrastrar el valor arriesgaría
 *   aplicar un effort que ya no significa lo mismo.
 * Esta migración corre sobre el JSON CRUDO, ANTES de los guards de forma
 * (`isValidPersistedSettings`): si corriera después, la clave `openrouter`
 * de `models`/`modelOptions` ya habría hecho fallar `isAiProviderId('openrouter')`
 * (`false` desde T59) y el archivo ENTERO se habría descartado como
 * inválido, perdiendo también la selección de cualquier otro proveedor que
 * conviviera en el mismo `settings.json`. El resultado migrado se PERSISTE
 * de inmediato (reescribe `settings.json`), a diferencia de la migración
 * pre-T26 (que hasta T59 quedaba solo en memoria hasta el próximo `set*`):
 * así un arranque siguiente no vuelve a pagar el costo de la migración ni
 * arriesga reinterpretar mal un archivo ya migrado.
 *
 * Además, T59 borra (best-effort) el archivo de key cifrada huérfano que
 * escribía el ya eliminado `../ai/openrouter-key-store.ts`
 * (`openrouter-key.bin` en `userData`) — ver `cleanupOrphanedOpenRouterKeyFile`
 * más abajo.
 *
 * Antes del primer `setAiProvider()`/`setProviderModel()` el archivo
 * simplemente no existe — no se crea con defaults de entrada porque el
 * default "real" es una decisión de precedencia (`../ai/env.ts`,
 * `getEffectiveAiSelection`), no de este módulo: los getters devuelven `null`
 * cuando no hay nada persistido (o el archivo está corrupto/con forma
 * inválida), y quien llama decide qué hacer con ese `null` (caer al entorno,
 * y si tampoco hay, al default curado del catálogo).
 *
 * Carga perezosa con cache en memoria (un solo `readFileSync` por proceso,
 * salvo que se llame a un setter, que actualiza la cache in-place además de
 * escribir a disco). Escritura atómica simple: se escribe a un archivo
 * temporal y se hace `rename` sobre el definitivo, para no dejar
 * `settings.json` a medio escribir si el proceso muere a mitad de la
 * escritura.
 */
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { DEFAULT_AI_PROVIDER, isAiProviderId, type AiProviderId } from '../../shared/ai-providers'

const SETTINGS_FILE_NAME = 'settings.json'

/**
 * Nombre del archivo cifrado huérfano que escribía `../ai/openrouter-key-store.ts`
 * (borrado en T59) — ver `cleanupOrphanedOpenRouterKeyFile` más abajo. Mismo
 * nombre literal que tenía ese módulo (`API_KEY_FILE_NAME`), repetido acá
 * porque el módulo que lo definía ya no existe.
 */
const ORPHANED_OPENROUTER_KEY_FILE_NAME = 'openrouter-key.bin'

/**
 * Forma persistida desde T26: proveedor activo + modelo elegido por
 * proveedor. `modelOptions` (T34, F8): valores elegidos por el usuario para
 * los option descriptors del modelo de cada proveedor (p. ej.
 * `{ codex: { effort: 'high' } }`) — ADITIVO sobre la forma de T26, ver
 * `isNewPersistedSettings`/`normalize` más abajo: un `settings.json` sin esta
 * clave (cualquier instalación pre-T34) se lee igual, tratando la ausencia
 * como "sin opciones guardadas" (`{}`), nunca como settings inválidos.
 */
/**
 * `githubAccount` (F18): login de `gh` elegido a mano para el puente de token
 * (`../auth/gh-cli-auth.ts`), OPCIONAL y aditivo igual que `modelOptions` —
 * ausente = "seguir la cuenta activa de `gh`" (comportamiento previo a F18,
 * que era el único posible). Vive en el MISMO `settings.json` que la
 * selección de IA porque es una preferencia más, no un secreto: acá se guarda
 * el NOMBRE de la cuenta, jamás su token (ese lo sigue emitiendo `gh` y solo
 * vive en memoria de main).
 *
 * `githubAccessMode` (≤0.8.x) is no longer read or written: GitHub access is
 * the `gh` token bridge only. The key may still be on disk in old installs;
 * it is ignored (any value) and disappears on the next write.
 */
export interface PersistedSettings {
  aiProvider: AiProviderId
  models: Partial<Record<AiProviderId, string>>
  modelOptions?: Partial<Record<AiProviderId, Record<string, string>>>
  githubAccount?: string
}

/** Forma pre-T26 (T12): la única que existía cuando solo había OpenRouter. Puede seguir en disco en instalaciones viejas. */
interface LegacyPersistedSettings {
  aiModel: string
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyTrimmedString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isModelsMap(value: unknown): value is Partial<Record<AiProviderId, string>> {
  if (!isPlainObject(value)) return false
  return Object.entries(value).every(
    ([provider, modelId]) => isAiProviderId(provider) && isNonEmptyTrimmedString(modelId),
  )
}

/** Mapa `optionId -> value` de un solo proveedor dentro de `modelOptions` (T34). */
function isOptionValuesMap(value: unknown): value is Record<string, string> {
  if (!isPlainObject(value)) return false
  return Object.entries(value).every(
    ([optionId, optionValue]) => optionId.length > 0 && isNonEmptyTrimmedString(optionValue),
  )
}

/** `modelOptions` completo (T34): por proveedor conocido, su mapa `optionId -> value`. */
function isModelOptionsMap(
  value: unknown,
): value is Partial<Record<AiProviderId, Record<string, string>>> {
  if (!isPlainObject(value)) return false
  return Object.entries(value).every(
    ([provider, options]) => isAiProviderId(provider) && isOptionValuesMap(options),
  )
}

function isNewPersistedSettings(value: unknown): value is PersistedSettings {
  if (!isPlainObject(value)) return false
  if (!isAiProviderId(value.aiProvider) || !isModelsMap(value.models)) return false
  // `modelOptions` es ADITIVO (T34): ausente = settings pre-T34, sigue siendo válido.
  if (value.modelOptions !== undefined && !isModelOptionsMap(value.modelOptions)) return false
  // A legacy `githubAccessMode` key is ignored, whatever its value.
  // `githubAccount` es ADITIVO (F18): ausente = "cuenta activa de gh"; presente pero
  // con algo que no es un login usable se rechaza (settings.json editado a mano no
  // debe colar basura que después termine en un argv de `gh`).
  return value.githubAccount === undefined || isGithubAccountLogin(value.githubAccount)
}

/**
 * Login de `gh` aceptable para persistir (F18). Además de "string no vacío",
 * exige SIN espacios y con tope de largo: este valor viaja como argumento de
 * `gh auth token --user <login>` (`execFile`, sin shell — no hay inyección
 * posible, pero un valor absurdo solo puede producir un fallo confuso) y se
 * pinta en la UI.
 */
function isGithubAccountLogin(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length > 0 && value.length <= 64 && !/\s/.test(value)
  )
}

function isLegacyPersistedSettings(value: unknown): value is LegacyPersistedSettings {
  if (!isPlainObject(value)) return false
  return isNonEmptyTrimmedString(value.aiModel)
}

/**
 * Migración OpenRouter -> OpenCode (T59, ver el comentario de cabecera del
 * módulo): opera sobre un objeto plano ya sabido `Record<string, unknown>`
 * (JSON crudo parseado, TODAVÍA sin validar contra `isNewPersistedSettings`)
 * y devuelve una copia con cualquier rastro de `'openrouter'` reescrito a
 * `'opencode'`. Idempotente: si no hay nada que migrar, devuelve `value` tal
 * cual (mismas referencias, sin clonar de más).
 */
function migrateRawOpenRouterToOpenCode(value: Record<string, unknown>): Record<string, unknown> {
  const hasOpenRouterProvider = value.aiProvider === 'openrouter'
  const models = isPlainObject(value.models) ? value.models : null
  const hasOpenRouterModel = models !== null && 'openrouter' in models
  const modelOptions = isPlainObject(value.modelOptions) ? value.modelOptions : null
  const hasOpenRouterOptions = modelOptions !== null && 'openrouter' in modelOptions

  if (!hasOpenRouterProvider && !hasOpenRouterModel && !hasOpenRouterOptions) {
    return value
  }

  const migrated: Record<string, unknown> = { ...value }

  if (hasOpenRouterProvider) {
    migrated.aiProvider = 'opencode'
  }

  if (models !== null) {
    const nextModels = { ...models }
    const openRouterModelId = nextModels.openrouter
    delete nextModels.openrouter
    if (
      typeof openRouterModelId === 'string' &&
      openRouterModelId.trim().length > 0 &&
      nextModels.opencode === undefined
    ) {
      nextModels.opencode = 'openrouter/' + openRouterModelId.trim()
    }
    migrated.models = nextModels
  }

  if (modelOptions !== null) {
    const nextModelOptions = { ...modelOptions }
    delete nextModelOptions.openrouter
    migrated.modelOptions = nextModelOptions
  }

  return migrated
}

interface MigrationResult {
  settings: PersistedSettings
  /** `true` si el resultado difiere de lo que había en disco: `load()` lo usa para decidir si reescribir `settings.json`. */
  changedFromDisk: boolean
}

/**
 * Punto único de migración de un `settings.json` crudo ya parseado (T26 +
 * T59): interpreta la forma pre-T26 (`{ aiModel }`) como "OpenRouter, con ese
 * modelo elegido" (única lectura posible: OpenRouter era el único proveedor
 * que existía antes de T26) y de ahí en más comparte el mismo paso de
 * migración OpenRouter -> OpenCode que la forma T26 (`migrateRawOpenRouterToOpenCode`)
 * — así el resultado final NUNCA tiene `'openrouter'` como proveedor, sin
 * importar cuán vieja sea la forma original en disco. Devuelve `null` si
 * `parsed` no matchea ninguna forma conocida (ni siquiera tras migrar).
 */
function migrateRaw(parsed: unknown): MigrationResult | null {
  if (isLegacyPersistedSettings(parsed)) {
    const synthesized: Record<string, unknown> = {
      aiProvider: 'openrouter',
      models: { openrouter: parsed.aiModel },
    }
    const migrated = migrateRawOpenRouterToOpenCode(synthesized)
    if (!isNewPersistedSettings(migrated)) return null
    return { settings: migrated, changedFromDisk: true }
  }

  if (!isPlainObject(parsed)) return null

  const migrated = migrateRawOpenRouterToOpenCode(parsed)
  if (!isNewPersistedSettings(migrated)) return null
  return { settings: migrated, changedFromDisk: migrated !== parsed }
}

/**
 * Best-effort: borra el archivo de key cifrada de OpenRouter que quedó
 * huérfano tras T59 (`../ai/openrouter-key-store.ts`, ya eliminado). Se llama
 * una sola vez, en el primer `load()` del proceso — cualquier fallo
 * (permisos, ya borrado por otra instancia, etc.) se ignora en silencio: esto
 * es limpieza de cortesía, nunca debe tumbar el arranque de la app ni la
 * lectura de settings.
 */
function cleanupOrphanedOpenRouterKeyFile(): void {
  try {
    const path = join(app.getPath('userData'), ORPHANED_OPENROUTER_KEY_FILE_NAME)
    if (existsSync(path)) unlinkSync(path)
  } catch {
    // Best-effort a propósito, ver el comentario de arriba.
  }
}

export class SettingsStore {
  /** `false` mientras no se haya intentado leer todavía; ver `load()`. */
  private loaded = false
  private cache: PersistedSettings | null = null

  private filePath(): string {
    return join(app.getPath('userData'), SETTINGS_FILE_NAME)
  }

  /**
   * Lee `settings.json` la primera vez que hace falta y cachea el resultado
   * (ya migrado/normalizado, ver `migrateRaw()`) en memoria para el resto de
   * la vida del proceso. Si el archivo no existe, no se puede parsear como
   * JSON, o no tiene ninguna forma válida (ni siquiera tras migrar), cae en
   * `null` sin lanzar (defaults sin crashear) — un log de advertencia solo en
   * el caso "existe pero está corrupto/con forma inválida", para no ensuciar
   * el log en el caso normal de "todavía no hay settings guardados". Si la
   * migración cambió algo respecto a lo que había en disco, el resultado se
   * persiste de inmediato (T59: ya no queda "solo en memoria" como antes).
   */
  private load(): PersistedSettings | null {
    if (this.loaded) return this.cache

    this.loaded = true
    cleanupOrphanedOpenRouterKeyFile()

    let raw: string
    try {
      raw = readFileSync(this.filePath(), 'utf-8')
    } catch {
      this.cache = null
      return this.cache
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (error) {
      console.warn('[settings] settings.json no se pudo parsear, se ignora:', error)
      this.cache = null
      return this.cache
    }

    const result = migrateRaw(parsed)
    if (result === null) {
      this.cache = null
      console.warn('[settings] settings.json tiene una forma inválida, se ignora:', raw)
      return this.cache
    }

    this.cache = result.settings
    if (result.changedFromDisk) {
      this.writeAtomic(result.settings)
    }
    return this.cache
  }

  /** Settings completos ya normalizados (forma vieja migrada), o `null` si nunca se guardó nada válido. */
  getPersistedSettings(): PersistedSettings | null {
    return this.load()
  }

  /** Modelo persistido para un proveedor concreto, o `null` si no hay nada guardado para ESE proveedor. */
  getPersistedModel(provider: AiProviderId): string | null {
    return this.load()?.models[provider] ?? null
  }

  /** Opciones persistidas (T34, p. ej. `{ effort: 'high' }`) para `provider`, o `{}` si no hay ninguna guardada todavía. */
  getPersistedModelOptions(provider: AiProviderId): Record<string, string> {
    return this.load()?.modelOptions?.[provider] ?? {}
  }

  /** Cuenta de `gh` elegida a mano (F18), o `null` para seguir la cuenta activa del CLI. */
  getGithubAccount(): string | null {
    return this.load()?.githubAccount ?? null
  }

  /**
   * Persiste la cuenta de `gh` a usar (F18), o la borra con `null` para
   * volver a "la cuenta activa de `gh`". No valida contra la lista real de
   * cuentas a propósito (misma doctrina que `setModelOption`): si el usuario
   * borra esa cuenta de `gh` después, la LECTURA lo resuelve — el probe falla
   * y `ScmAuthStatus.detail` lo nombra, en vez de dejar un valor
   * huérfano bloqueado.
   */
  setGithubAccount(login: string | null): void {
    const current = this.load()
    this.persist({
      aiProvider: current?.aiProvider ?? DEFAULT_AI_PROVIDER,
      models: current?.models ?? {},
      modelOptions: current?.modelOptions,
      githubAccount: login ?? undefined,
    })
  }

  /** Cambia el proveedor ACTIVO, sin tocar los modelos ni las opciones ya elegidas por cada proveedor. */
  setAiProvider(provider: AiProviderId): void {
    const current = this.load()
    this.persist({
      aiProvider: provider,
      models: current?.models ?? {},
      modelOptions: current?.modelOptions,
      // GOTCHA (F14, sigue vigente en F18 con otra clave): este objeto se
      // construye A MANO — si no se arrastra `githubAccount` del estado
      // previo, un cambio de proveedor/modelo BORRARÍA en silencio la cuenta
      // de GitHub que el usuario eligió.
      githubAccount: current?.githubAccount,
    })
  }

  /** Guarda el modelo elegido para `provider` (no cambia el proveedor activo si `provider` no lo es, ver `setAiProvider`). */
  setProviderModel(provider: AiProviderId, modelId: string): void {
    const current = this.load()
    this.persist({
      aiProvider: current?.aiProvider ?? DEFAULT_AI_PROVIDER,
      models: { ...current?.models, [provider]: modelId },
      modelOptions: current?.modelOptions,
      // Ver el gotcha de `setAiProvider` de arriba: mismo riesgo, mismo fix.
      githubAccount: current?.githubAccount,
    })
  }

  /**
   * Guarda el valor elegido para una opción de `provider` (T34, p. ej.
   * `setModelOption('codex', 'effort', 'high')`) sin tocar el proveedor
   * activo, los modelos elegidos, ni las opciones de otros proveedores/otras
   * opciones del mismo proveedor (crea el sub-objeto de `provider` si hace
   * falta). No valida el `value` contra las choices del modelo activo — esa
   * validación "robusta" es responsabilidad de la LECTURA
   * (`getEffectiveAiSelection`, `../ai/env.ts`, vía `resolveOptionValue`),
   * para que cambiar de modelo después de guardar no deje un valor "huérfano"
   * bloqueado: simplemente se ignora si ya no aplica, sin perder el dato por
   * si el usuario vuelve a ese modelo.
   */
  setModelOption(provider: AiProviderId, optionId: string, value: string): void {
    const current = this.load()
    const currentModelOptions = current?.modelOptions ?? {}
    const currentProviderOptions = currentModelOptions[provider] ?? {}
    this.persist({
      aiProvider: current?.aiProvider ?? DEFAULT_AI_PROVIDER,
      models: current?.models ?? {},
      modelOptions: {
        ...currentModelOptions,
        [provider]: { ...currentProviderOptions, [optionId]: value },
      },
      // Ver el gotcha de `setAiProvider` (arriba): mismo riesgo, mismo fix.
      githubAccount: current?.githubAccount,
    })
  }

  /** Escribe atómico y refleja `next` de inmediato en la cache en memoria. */
  private persist(next: PersistedSettings): void {
    this.writeAtomic(next)
    this.cache = next
    this.loaded = true
  }

  private writeAtomic(data: PersistedSettings): void {
    const finalPath = this.filePath()
    const tmpPath = finalPath + '.tmp'
    writeFileSync(tmpPath, JSON.stringify(data, null, 2) + '\n', 'utf-8')
    renameSync(tmpPath, finalPath)
  }
}

/** Instancia única del proceso `main`; `../ai/env.ts` y `../ipc/handlers.ts` la comparten. */
export const settingsStore = new SettingsStore()
