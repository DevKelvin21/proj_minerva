/**
 * Validación profunda de payloads IPC, un guard por canal.
 *
 * `register.ts` (`handle()`) valida contra `payloadValidators[channel]` antes
 * de invocar el handler real: un payload que no matchea el guard nunca llega
 * al código de negocio. Esto es defensa en profundidad — el preload solo
 * expone funciones con nombre y tipos (`window.minerva.*`), pero un renderer
 * comprometido (XSS, prompt injection en el panel didáctico, etc.) podría en
 * teoría intentar invocar un canal con un payload arbitrario si llegara a
 * tener acceso a `ipcRenderer` por alguna vía no prevista.
 *
 * Los guards son manuales (sin dependencias — nada de zod) para mantener el
 * proyecto liviano; cada uno es una función `(payload: unknown) => boolean`
 * indexada por canal, así el tipado (`Record<IpcChannel, ...>`) obliga a
 * cubrir cualquier canal nuevo del contrato.
 */
import { isAiProviderId } from '../../shared/ai-providers'
import type { IpcChannel } from '../../shared/ipc'
import { isRepoRef } from '../../shared/scm-guards'

const MAX_SEARCH_LEN = 256
const MAX_BODY_LEN = 65536
const MAX_THREAD_ID_LEN = 200
const MAX_PATH_LEN = 500
const MAX_PR_NUMBER = 1_000_000
const MAX_AI_MODEL_LEN = 100
const MAX_PR_TITLE_LEN = 300
const MAX_OPTION_ID_LEN = 50
const MAX_OPTION_VALUE_LEN = 50
const MAX_UPDATED_AT_LEN = 64
/** Login de GitHub (F18): 39 en github.com, con holgura por GHES. */
const MAX_GH_LOGIN_LEN = 64

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Ningún payload trae claves fuera de `keys` (evita "prototype pollution"-ish shapes disfrazadas de payload válido). */
function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => (keys as readonly string[]).includes(key))
}

function isNonEmptyString(value: unknown, maxLen: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLen
}

function isOptionalString(value: unknown, maxLen: number): boolean {
  return value === undefined || (typeof value === 'string' && value.length <= maxLen)
}

function isIntInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
}

function isOptionalIntGte(value: unknown, min: number): boolean {
  return (
    value === undefined || (typeof value === 'number' && Number.isInteger(value) && value >= min)
  )
}

/** Forma común a `getPullRequestDetail/Files/getCommentThreads` y `ai:analyzePullRequest`. */
function isRepoAndNumberPayload(value: unknown): boolean {
  if (!isPlainObject(value)) return false
  if (!hasOnlyKeys(value, ['repo', 'number'])) return false
  return isRepoRef(value.repo) && isIntInRange(value.number, 1, MAX_PR_NUMBER)
}

function isVoidPayload(value: unknown): boolean {
  return value === undefined
}

/** `state` (T50, F10): filtro de estado opcional, uno de los tres valores de `PrStateFilter`. */
function isOptionalPrStateFilter(value: unknown): boolean {
  return value === undefined || value === 'open' || value === 'closed' || value === 'all'
}

function isListPullRequestsPayload(value: unknown): boolean {
  if (!isPlainObject(value)) return false
  if (!hasOnlyKeys(value, ['search', 'state'])) return false
  if (!isOptionalString(value.search, MAX_SEARCH_LEN)) return false
  return isOptionalPrStateFilter(value.state)
}

/**
 * `scm:markPrSeen`: the PR (`repo` + `number`), `updatedAt` non-empty (ISO
 * string), `commentCount` integer ≥0 or `null` (provider didn't report it).
 */
function isMarkPrSeenPayload(value: unknown): boolean {
  if (!isPlainObject(value)) return false
  if (!hasOnlyKeys(value, ['repo', 'number', 'updatedAt', 'commentCount'])) return false
  if (!isRepoRef(value.repo)) return false
  if (!isIntInRange(value.number, 1, MAX_PR_NUMBER)) return false
  if (!isNonEmptyString(value.updatedAt, MAX_UPDATED_AT_LEN)) return false
  return value.commentCount === null || isIntInRange(value.commentCount, 0, Number.MAX_SAFE_INTEGER)
}

function isPostCommentPayload(value: unknown): boolean {
  if (!isPlainObject(value)) return false
  if (!hasOnlyKeys(value, ['repo', 'number', 'bodyMarkdown', 'threadId', 'path', 'line', 'side'])) {
    return false
  }
  if (!isRepoRef(value.repo)) return false
  if (!isIntInRange(value.number, 1, MAX_PR_NUMBER)) return false
  if (!isNonEmptyString(value.bodyMarkdown, MAX_BODY_LEN)) return false
  if (!isOptionalString(value.threadId, MAX_THREAD_ID_LEN)) return false
  if (!isOptionalString(value.path, MAX_PATH_LEN)) return false
  if (!isOptionalIntGte(value.line, 1)) return false
  if (value.side !== undefined && value.side !== 'LEFT' && value.side !== 'RIGHT') return false
  return true
}

/** `ai:getProviderModels` (T35): un `provider` conocido del catálogo, sin claves extra. */
function isGetProviderModelsPayload(value: unknown): boolean {
  if (!isPlainObject(value)) return false
  if (!hasOnlyKeys(value, ['provider'])) return false
  return isAiProviderId(value.provider)
}

/** `settings:setAiProvider` (T26): un `provider` conocido del catálogo, sin claves extra. */
function isSetAiProviderPayload(value: unknown): boolean {
  if (!isPlainObject(value)) return false
  if (!hasOnlyKeys(value, ['provider'])) return false
  return isAiProviderId(value.provider)
}

/**
 * `settings:setProviderModel` (T26): `model` string no vacío, acotado, sin
 * validar contra la lista curada de ESE proveedor (el modo "Otro (avanzado)"
 * de OpenCode debe seguir funcionando), más `provider` conocido del catálogo.
 */
function isSetProviderModelPayload(value: unknown): boolean {
  if (!isPlainObject(value)) return false
  if (!hasOnlyKeys(value, ['provider', 'model'])) return false
  if (!isAiProviderId(value.provider)) return false
  return isNonEmptyString(value.model, MAX_AI_MODEL_LEN)
}

/**
 * `settings:setModelOption` (T34): `provider` conocido del catálogo,
 * `optionId` (id del descriptor, p. ej. `'effort'`) y `value` (id del choice
 * elegido) strings no vacíos y acotados — no se valida contra las choices
 * REALES del descriptor de ese modelo (eso es responsabilidad de la lectura,
 * `getEffectiveAiSelection` en `../ai/env.ts`, ver `resolveOptionValue`).
 */
function isSetModelOptionPayload(value: unknown): boolean {
  if (!isPlainObject(value)) return false
  if (!hasOnlyKeys(value, ['provider', 'optionId', 'value'])) return false
  if (!isAiProviderId(value.provider)) return false
  if (!isNonEmptyString(value.optionId, MAX_OPTION_ID_LEN)) return false
  return isNonEmptyString(value.value, MAX_OPTION_VALUE_LEN)
}

/**
 * `scm:setGithubAccount` (F18): `login` es el nombre de una cuenta de
 * `gh`, o `null` para volver a la cuenta activa del CLI. Se exige sin
 * espacios y acotado (`MAX_GH_LOGIN_LEN`) porque este valor termina como
 * argumento de `gh auth token --user <login>` (`execFile`, sin shell — no hay
 * inyección posible, pero tampoco tiene sentido dejar pasar un payload
 * arbitrario hasta el spawn) y se persiste en `settings.json`.
 */
function isSetGithubAccountPayload(value: unknown): boolean {
  if (!isPlainObject(value)) return false
  if (!hasOnlyKeys(value, ['login'])) return false
  if (value.login === null) return true
  return isNonEmptyString(value.login, MAX_GH_LOGIN_LEN) && !/\s/.test(value.login)
}

/** `window:openDidactic` (T14): mismo `repo`/`number` que `isRepoAndNumberPayload`, más el título humano del PR. */
function isOpenDidacticWindowPayload(value: unknown): boolean {
  if (!isPlainObject(value)) return false
  if (!hasOnlyKeys(value, ['repo', 'number', 'title'])) return false
  if (!isRepoRef(value.repo)) return false
  if (!isIntInRange(value.number, 1, MAX_PR_NUMBER)) return false
  return isNonEmptyString(value.title, MAX_PR_TITLE_LEN)
}

/**
 * Un validador por canal. `register.ts` (`handle`) lo usa para rechazar
 * payloads malformados antes de llegar al handler real; ver también el
 * comentario de cabecera de este archivo.
 */
export const payloadValidators: Record<IpcChannel, (payload: unknown) => boolean> = {
  'minerva:ping': isVoidPayload,
  'minerva:getVersion': isVoidPayload,
  'scm:getAuthStatus': isVoidPayload,
  'scm:listGhAccounts': isVoidPayload,
  'scm:getSettings': isVoidPayload,
  'scm:setGithubAccount': isSetGithubAccountPayload,
  'scm:listPullRequests': isListPullRequestsPayload,
  'scm:markPrSeen': isMarkPrSeenPayload,
  'scm:getPullRequestDetail': isRepoAndNumberPayload,
  'scm:getPullRequestFiles': isRepoAndNumberPayload,
  'scm:getCommentThreads': isRepoAndNumberPayload,
  'scm:postComment': isPostCommentPayload,
  'ai:analyzePullRequest': isRepoAndNumberPayload,
  'ai:getCachedAnalysis': isRepoAndNumberPayload,
  'ai:invalidateAnalysis': isRepoAndNumberPayload,
  'ai:getAnalysisState': isRepoAndNumberPayload,
  'ai:getProviderStatus': isVoidPayload,
  'ai:getProviderModels': isGetProviderModelsPayload,
  'settings:get': isVoidPayload,
  'settings:setAiProvider': isSetAiProviderPayload,
  'settings:setProviderModel': isSetProviderModelPayload,
  'settings:setModelOption': isSetModelOptionPayload,
  'window:openDidactic': isOpenDidacticWindowPayload,
  // Auto-updater (T90, F17): los 5 canales son `req: void` — mismo guard que
  // `minerva:ping`/`scm:getAuthStatus`, rechaza cualquier cosa distinta de `undefined`.
  'updater:getStatus': isVoidPayload,
  'updater:check': isVoidPayload,
  'updater:download': isVoidPayload,
  'updater:quitAndInstall': isVoidPayload,
  'updater:openReleasePage': isVoidPayload,
}
