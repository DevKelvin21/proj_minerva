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
import { isNotificationSettings } from '../../shared/activity'
import { isAiProviderId } from '../../shared/ai-providers'
import type { IpcChannel } from '../../shared/ipc'
import { isAppLocale } from '../../shared/locale'
import { isAppearanceSettings } from '../../shared/theme/appearance'
import {
  isOpenVsxIdentifier,
  MAX_OPEN_VSX_QUERY_LENGTH,
  OPEN_VSX_SORTS,
} from '../../shared/theme/open-vsx'
import { SETTABLE_THREAD_STATUSES, type ThreadStatus } from '../../shared/scm'
import { MAX_CHAT_MESSAGE_LEN, MAX_CHAT_PAGE } from '../../shared/chat'
import { isChatContext, isChatId } from '../chat/chat-guards'
import {
  isAzureOrganizationName,
  isAzureProjectName,
  isRepoRef,
  isValidBranchName,
  MAX_AZURE_ORGANIZATIONS,
  MAX_AZURE_PROJECTS_PER_ORG,
} from '../../shared/scm-guards'

const MAX_SEARCH_LEN = 256
const MAX_BODY_LEN = 65536
const MAX_THREAD_ID_LEN = 200
const MAX_PATH_LEN = 500
const MAX_PR_NUMBER = 1_000_000
/** Highest diff line a comment can anchor to. */
const MAX_LINE = 1_000_000
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
  if (value.line !== undefined && !isIntInRange(value.line, 1, MAX_LINE)) return false
  if (value.side !== undefined && value.side !== 'LEFT' && value.side !== 'RIGHT') return false
  return true
}

/**
 * `scm:setThreadStatus`: the PR, a thread id, and a status the PROVIDER of
 * that repo can set (`SETTABLE_THREAD_STATUSES`): GitHub only active/resolved.
 */
function isSetThreadStatusPayload(value: unknown): boolean {
  if (!isPlainObject(value)) return false
  if (!hasOnlyKeys(value, ['repo', 'number', 'threadId', 'status'])) return false
  if (!isRepoRef(value.repo)) return false
  if (!isIntInRange(value.number, 1, MAX_PR_NUMBER)) return false
  if (!isNonEmptyString(value.threadId, MAX_THREAD_ID_LEN)) return false
  const settable: readonly ThreadStatus[] = SETTABLE_THREAD_STATUSES[value.repo.provider]
  return typeof value.status === 'string' && (settable as readonly string[]).includes(value.status)
}

/** A repo-relative file path: no leading `/`, no `..` / `.` / empty segments, no NUL/control chars. */
function isRepoFilePath(value: unknown): value is string {
  if (!isNonEmptyString(value, MAX_PATH_LEN)) return false
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f\\]/.test(value)) return false
  return value.split('/').every((part) => part.length > 0 && part !== '.' && part !== '..')
}

function isGetFileContentPayload(value: unknown): boolean {
  if (!isPlainObject(value)) return false
  if (!hasOnlyKeys(value, ['repo', 'number', 'path', 'side'])) return false
  if (!isRepoRef(value.repo)) return false
  if (!isIntInRange(value.number, 1, MAX_PR_NUMBER)) return false
  if (!isRepoFilePath(value.path)) return false
  return value.side === 'base' || value.side === 'head'
}

/**
 * `chat:send`: the PR, an optional existing conversation id, a non-empty
 * message up to `MAX_CHAT_MESSAGE_LEN` characters (it goes into a prompt,
 * fenced there) and the context items (`../chat/chat-guards.ts`: count,
 * per-field shape and lengths, total characters).
 */
function isChatSendPayload(value: unknown): boolean {
  if (!isPlainObject(value)) return false
  if (!hasOnlyKeys(value, ['repo', 'number', 'conversationId', 'text', 'context'])) return false
  if (!isRepoRef(value.repo)) return false
  if (!isIntInRange(value.number, 1, MAX_PR_NUMBER)) return false
  if (value.conversationId !== undefined && !isChatId(value.conversationId)) return false
  if (typeof value.text !== 'string' || value.text.trim().length === 0) return false
  if (value.text.length > MAX_CHAT_MESSAGE_LEN) return false
  return isChatContext(value.context)
}

/** `chat:retry` / `chat:cancel` / `chat:delete`: exactly a conversation id. */
function isChatConversationPayload(value: unknown): boolean {
  if (!isPlainObject(value)) return false
  if (!hasOnlyKeys(value, ['conversationId'])) return false
  return isChatId(value.conversationId)
}

/** `chat:get`: a conversation id, an optional message id cursor and page size 1..`MAX_CHAT_PAGE`. */
function isChatGetPayload(value: unknown): boolean {
  if (!isPlainObject(value)) return false
  if (!hasOnlyKeys(value, ['conversationId', 'before', 'limit'])) return false
  if (!isChatId(value.conversationId)) return false
  if (value.before !== undefined && !isChatId(value.before)) return false
  return value.limit === undefined || isIntInRange(value.limit, 1, MAX_CHAT_PAGE)
}

/** `scm:retarget`: two valid, different short branch names. The rest is re-checked in main. */
function isRetargetPayload(value: unknown): boolean {
  if (!isPlainObject(value)) return false
  if (!hasOnlyKeys(value, ['repo', 'number', 'expectedCurrentBase', 'newBase'])) return false
  if (Object.keys(value).length !== 4) return false
  if (!isRepoRef(value.repo)) return false
  if (!isIntInRange(value.number, 1, MAX_PR_NUMBER)) return false
  if (!isValidBranchName(value.expectedCurrentBase) || !isValidBranchName(value.newBase)) {
    return false
  }
  return value.expectedCurrentBase !== value.newBase
}

/** `scm:getStacks`: nothing, or `{ refresh?: boolean }`. */
function isGetStacksPayload(value: unknown): boolean {
  if (value === undefined) return true
  if (!isPlainObject(value)) return false
  if (!hasOnlyKeys(value, ['refresh'])) return false
  return value.refresh === undefined || typeof value.refresh === 'boolean'
}

const MAX_ACTIVITY_IDS = 500
const MAX_ACTIVITY_ID_LEN = 600

/**
 * `activity:markRead`: exactly `{ all: true }`, or `{ ids }` with 1..500
 * non-empty ids (no other key).
 */
function isMarkActivityReadPayload(value: unknown): boolean {
  if (!isPlainObject(value)) return false
  if (Object.hasOwn(value, 'all')) {
    return hasOnlyKeys(value, ['all']) && value.all === true
  }
  if (!hasOnlyKeys(value, ['ids']) || !Array.isArray(value.ids)) return false
  const ids: unknown[] = value.ids
  return (
    ids.length > 0 &&
    ids.length <= MAX_ACTIVITY_IDS &&
    ids.every((id) => isNonEmptyString(id, MAX_ACTIVITY_ID_LEN))
  )
}

/**
 * `scm:getDashboard`: nothing, or a plain `{ refresh?: boolean }` (no other
 * key, no inherited `refresh`).
 */
function isGetDashboardPayload(value: unknown): boolean {
  if (value === undefined) return true
  if (!isPlainObject(value)) return false
  const proto: unknown = Object.getPrototypeOf(value)
  if (proto !== Object.prototype && proto !== null) return false
  if (!hasOnlyKeys(value, ['refresh'])) return false
  const refresh = Object.hasOwn(value, 'refresh') ? value.refresh : undefined
  return refresh === undefined || typeof refresh === 'boolean'
}

function isAzureOrganizationsPayload(value: unknown): boolean {
  if (!Array.isArray(value) || value.length > MAX_AZURE_ORGANIZATIONS) return false
  const seen = new Set<string>()
  return value.every((entry: unknown) => {
    if (!isPlainObject(entry) || !hasOnlyKeys(entry, ['organization', 'projects'])) return false
    if (!isAzureOrganizationName(entry.organization)) return false
    if (seen.has(entry.organization.toLowerCase())) return false
    seen.add(entry.organization.toLowerCase())
    const projects = entry.projects
    if (!Array.isArray(projects) || projects.length > MAX_AZURE_PROJECTS_PER_ORG) return false
    if (!projects.every(isAzureProjectName)) return false
    return (
      new Set(projects.map((project: string) => project.toLowerCase())).size === projects.length
    )
  })
}

/** `scm:setProviderSettings`: at least one block; each with exactly its fields. */
function isSetProviderSettingsPayload(value: unknown): boolean {
  if (!isPlainObject(value)) return false
  if (!hasOnlyKeys(value, ['github', 'azure'])) return false
  if (value.github === undefined && value.azure === undefined) return false
  if (value.github !== undefined) {
    const github = value.github
    if (!isPlainObject(github) || !hasOnlyKeys(github, ['enabled'])) return false
    if (typeof github.enabled !== 'boolean') return false
  }
  if (value.azure !== undefined) {
    const azure = value.azure
    if (!isPlainObject(azure) || !hasOnlyKeys(azure, ['enabled', 'organizations'])) return false
    if (typeof azure.enabled !== 'boolean') return false
    if (!isAzureOrganizationsPayload(azure.organizations)) return false
  }
  return true
}

function isListAzureProjectsPayload(value: unknown): boolean {
  if (!isPlainObject(value)) return false
  if (!hasOnlyKeys(value, ['organization'])) return false
  return isAzureOrganizationName(value.organization)
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

/** `settings:setLanguage`: one of the known locales, no extra keys. */
function isSetLanguagePayload(value: unknown): boolean {
  if (!isPlainObject(value)) return false
  if (!hasOnlyKeys(value, ['language'])) return false
  return isAppLocale(value.language)
}

/** `settings:setAppearance`: the full settings, strictly (canonical colors only, see `isAppearanceSettings`). */
function isSetAppearancePayload(value: unknown): boolean {
  return isAppearanceSettings(value)
}

/** `themes:searchOpenVsx`: a short non-empty query and an optional known sort. */
function isSearchOpenVsxPayload(value: unknown): boolean {
  if (!isPlainObject(value)) return false
  if (!hasOnlyKeys(value, ['query', 'sortBy'])) return false
  if (!isNonEmptyString(value.query, MAX_OPEN_VSX_QUERY_LENGTH)) return false
  return value.sortBy === undefined || (OPEN_VSX_SORTS as readonly unknown[]).includes(value.sortBy)
}

/** `themes:installOpenVsx`: an extension identity (never a URL). */
function isInstallOpenVsxPayload(value: unknown): boolean {
  if (!isPlainObject(value)) return false
  if (!hasOnlyKeys(value, ['namespace', 'name'])) return false
  return isOpenVsxIdentifier(value.namespace) && isOpenVsxIdentifier(value.name)
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
  'scm:setProviderSettings': isSetProviderSettingsPayload,
  'scm:listAzureProjects': isListAzureProjectsPayload,
  'scm:setGithubAccount': isSetGithubAccountPayload,
  'scm:listPullRequests': isListPullRequestsPayload,
  'scm:markPrSeen': isMarkPrSeenPayload,
  'scm:getPullRequestDetail': isRepoAndNumberPayload,
  'scm:getPullRequestFiles': isRepoAndNumberPayload,
  'scm:getCommentThreads': isRepoAndNumberPayload,
  'scm:postComment': isPostCommentPayload,
  'scm:setThreadStatus': isSetThreadStatusPayload,
  'scm:getFileContent': isGetFileContentPayload,
  'scm:retarget': isRetargetPayload,
  'scm:getStacks': isGetStacksPayload,
  'scm:getDashboard': isGetDashboardPayload,
  'activity:get': isVoidPayload,
  'activity:markRead': isMarkActivityReadPayload,
  'ai:analyzePullRequest': isRepoAndNumberPayload,
  'ai:getCachedAnalysis': isRepoAndNumberPayload,
  'ai:invalidateAnalysis': isRepoAndNumberPayload,
  'ai:getAnalysisState': isRepoAndNumberPayload,
  'ai:getProviderStatus': isVoidPayload,
  'ai:getProviderModels': isGetProviderModelsPayload,
  'chat:list': isRepoAndNumberPayload,
  'chat:get': isChatGetPayload,
  'chat:send': isChatSendPayload,
  'chat:retry': isChatConversationPayload,
  'chat:cancel': isChatConversationPayload,
  'chat:delete': isChatConversationPayload,
  'settings:get': isVoidPayload,
  'settings:setAiProvider': isSetAiProviderPayload,
  'settings:setProviderModel': isSetProviderModelPayload,
  'settings:setModelOption': isSetModelOptionPayload,
  'settings:getLanguage': isVoidPayload,
  'settings:setLanguage': isSetLanguagePayload,
  'settings:getNotifications': isVoidPayload,
  'settings:setNotifications': isNotificationSettings,
  'settings:getAppearance': isVoidPayload,
  'settings:setAppearance': isSetAppearancePayload,
  'themes:searchOpenVsx': isSearchOpenVsxPayload,
  'themes:installOpenVsx': isInstallOpenVsxPayload,
  'window:openDidactic': isOpenDidacticWindowPayload,
  // Auto-updater (T90, F17): los 5 canales son `req: void` — mismo guard que
  // `minerva:ping`/`scm:getAuthStatus`, rechaza cualquier cosa distinta de `undefined`.
  'updater:getStatus': isVoidPayload,
  'updater:check': isVoidPayload,
  'updater:download': isVoidPayload,
  'updater:quitAndInstall': isVoidPayload,
  'updater:openReleasePage': isVoidPayload,
}
