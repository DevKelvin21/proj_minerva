/**
 * GitHub token bridge — the ONLY way Minerva authenticates to GitHub: auth is
 * delegated to the user's signed-in `gh` CLI — `gh auth token` devuelve el token de esa sesión, que
 * se valida contra `GET /user` (`./github-user.ts`) y se usa TAL CUAL para
 * hablar con Octokit (`./real-service.ts`).
 *
 * Pensado para orgs enterprise con *OAuth app access restrictions* activas:
 * bloquean la OAuth App de Minerva pero SÍ permiten GitHub CLI (verificado
 * empíricamente, ver `.agents/PLAN.md` § F14 — GitHub autoriza por token + app
 * emisora, nunca por cliente HTTP).
 *
 * Mapeo de estados: `gh` no se resuelve en PATH/ubicaciones comunes ⇒
 * `cli_unavailable`; se resuelve pero `gh auth token` falla (exit≠0, timeout,
 * stdout vacío tras recortar espacios) ⇒ `cli_unauthenticated`; el token
 * obtenido no valida contra `GET /user` ⇒ `cli_unauthenticated` (token
 * descartado, nunca se cachea uno inválido); todo OK ⇒ `signed_in` + user.
 *
 * Nunca lanza: cualquier fallo degrada al estado correspondiente. El token
 * JAMÁS sale de esta clase hacia IPC/logs — `getStatus()` (lo que cruza a
 * `ScmAuthStatus`) nunca lo incluye; solo `getTokenSync()` lo expone, y
 * únicamente dentro de `main`.
 *
 * Cache TTL 5s + single-flight (mismo patrón que
 * `../ai/providers/cli-probe.ts`): dos `getStatus()` concurrentes reusan la
 * MISMA promesa en vuelo, así que no spawnean `gh` dos veces; `settings:get`,
 * el polling de la UI (T71) y el arranque (`../index.ts`) pueden llamar sin
 * preocuparse por el costo.
 *
 * F18 — MULTICUENTA: `gh` admite varias cuentas por host y, sin `--user`,
 * usa la que él marca como activa. Hasta acá Minerva heredaba esa elección
 * sin poder cambiarla (en una máquina con la cuenta del trabajo activa, no
 * había forma de revisar PRs con la personal). Ahora el probe lee la cuenta
 * elegida (`settingsStore.getGithubAccount()`, `null` = seguir la activa de
 * `gh`) y se la pasa como `--user`. La elección es SOLO de Minerva: jamás se
 * corre `gh auth switch` — la cuenta activa del CLI es del usuario y mutarla
 * afectaría a su git y a cualquier otro script de la máquina.
 * `listAccounts()` (vía `./gh-accounts.ts`) alimenta el selector de Settings.
 */
import { execFile } from 'node:child_process'
import { GH_HOSTNAME } from './config'
import { parseGhAccountsJson, parseGhAccountsText } from './gh-accounts'
import { fetchGithubUser } from './github-user'
import { resolveCliPath } from '../../ai/providers/resolve-cli'
import { settingsStore } from '../../settings/store'
import type { GhAccount } from '../../../shared/types'
import type { ScmAuthStatus } from '../../../shared/scm'

/** TTL de la cache de `getStatus()`: evita spawnear `gh` por cada llamada IPC seguida. */
const STATUS_CACHE_TTL_MS = 5000

/** Tiempo máximo que se espera a `gh auth token` antes de degradar a "no autenticado". */
const GH_AUTH_TOKEN_TIMEOUT_MS = 3000

/**
 * `gh auth status` toca la red (valida cada token contra la API) y por eso se
 * le da más aire que a `gh auth token`, que solo lee `hosts.yml`/el keyring.
 */
const GH_AUTH_STATUS_TIMEOUT_MS = 8000

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * `cli_unauthenticated`, naming the chosen account when there is one: "run gh
 * auth login" would be the wrong advice if the user DOES have other healthy
 * accounts and only the one picked in Settings is broken.
 */
function unauthenticated(account: string | null): ScmAuthStatus {
  return {
    provider: 'github',
    state: 'cli_unauthenticated',
    credentialSource: 'gh-cli',
    detail:
      account === null
        ? "No gh session. Run 'gh auth login' in a terminal."
        : `The selected gh account "${account}" has no valid session. Run 'gh auth login' for it or pick another account in Settings.`,
  }
}

export class GhCliAuth {
  private cachedStatus: Promise<ScmAuthStatus> | null = null
  private cacheExpiresAt = 0
  /**
   * Cuenta (`settingsStore.getGithubAccount()`) con la que se calculó
   * `cachedStatus` (F18): si cambia, la entrada cacheada habla de OTRA
   * identidad y debe descartarse aunque el TTL siga vivo. `invalidate()`
   * cubre el camino explícito (el handler de `settings:setGithubAccount`);
   * esto cubre cualquier otro (un cambio desde otra ventana, un test).
   */
  private cachedForAccount: string | null = null
  /** Snapshot del último token validado con éxito (o `null` si el último probe no lo confirmó). Lo lee `getTokenSync()`. */
  private lastToken: string | null = null
  private cachedAccounts: Promise<GhAccount[]> | null = null
  private accountsCacheExpiresAt = 0

  /**
   * Estado actual del modo `gh-cli`, cacheado (TTL 5s) + single-flight: si ya
   * hay un probe en vuelo (o uno reciente cacheado), se devuelve esa MISMA
   * promesa en vez de spawnear `gh` de nuevo.
   */
  getStatus(): Promise<ScmAuthStatus> {
    const now = Date.now()
    const account = settingsStore.getGithubAccount()
    if (this.cachedStatus && this.cacheExpiresAt > now && this.cachedForAccount === account) {
      return this.cachedStatus
    }

    const promise = this.probe(account)
    this.cachedStatus = promise
    this.cacheExpiresAt = now + STATUS_CACHE_TTL_MS
    this.cachedForAccount = account
    return promise
  }

  /**
   * Cuentas que `gh` conoce en `GH_HOSTNAME` (F18), para el selector de
   * Settings. Cache TTL + single-flight propios (spawn distinto y bastante
   * más caro que el de `getStatus()`: `gh auth status` valida cada token
   * contra la API). Nunca lanza: si `gh` no está o no se entiende su salida,
   * devuelve `[]` — la UI lo lee como "no hay cuentas que ofrecer" y cae al
   * comportamiento de siempre (seguir la cuenta activa del CLI).
   */
  listAccounts(): Promise<GhAccount[]> {
    const now = Date.now()
    if (this.cachedAccounts && this.accountsCacheExpiresAt > now) return this.cachedAccounts

    const promise = this.probeAccounts()
    this.cachedAccounts = promise
    this.accountsCacheExpiresAt = now + STATUS_CACHE_TTL_MS
    return promise
  }

  /**
   * Tira las caches de estado y de cuentas (F18): la llama el handler de
   * `settings:setGithubAccount` para que el `getStatus()` inmediatamente
   * posterior hable de la cuenta RECIÉN elegida y no sirva el probe de la
   * anterior. No toca `lastToken`: ese lo pisa el probe siguiente, y dejarlo
   * momentáneamente en el valor viejo es preferible a un hueco donde
   * `getToken()` devuelva `null` y la ruta de datos falle con un 401 evitable.
   */
  invalidate(): void {
    this.cachedStatus = null
    this.cacheExpiresAt = 0
    this.cachedForAccount = null
    this.cachedAccounts = null
    this.accountsCacheExpiresAt = 0
  }

  /** Snapshot en memoria del último token validado (o `null`); nunca cruza a IPC. */
  getTokenSync(): string | null {
    return this.lastToken
  }

  /**
   * Re-obtiene el token de `gh` SIN pasar por la cache de `getStatus()` (ni
   * repetir la validación contra `/user`, que ya se sabe que puede volver a
   * fallar en el reintento del llamador): la usa `main/github/gh-retry.ts`
   * ante un 401 en la ruta de datos — cubre tanto rotación del token de `gh`
   * como un arranque en frío donde el primer probe corrió antes de que el
   * usuario terminara `gh auth login`. Invalida la cache de `getStatus()` de
   * paso, para que la próxima consulta de estado (p. ej. el polling de la UI)
   * refleje el resultado fresco en vez de servir el probe viejo.
   */
  async refetchTokenAfter401(): Promise<string | null> {
    this.cachedStatus = null
    this.cacheExpiresAt = 0
    this.cachedForAccount = null

    const resolvedPath = resolveCliPath('gh')
    const token =
      resolvedPath === null
        ? null
        : await this.execGhAuthToken(resolvedPath, settingsStore.getGithubAccount())
    this.lastToken = token
    return token
  }

  /** Solo para tests: limpia caches, single-flight y el token snapshot. */
  reset(): void {
    this.invalidate()
    this.lastToken = null
  }

  /**
   * `account` es la cuenta elegida a mano (F18) o `null` para dejar que `gh`
   * resuelva la activa. Se nombra en `detail` SOLO cuando no es
   * `null`: así un `cli_unauthenticated` puede decir cuál cuenta falló, sin
   * inventar un nombre cuando la elección la hizo el CLI.
   */
  private async probe(account: string | null): Promise<ScmAuthStatus> {
    const resolvedPath = resolveCliPath('gh')
    if (resolvedPath === null) {
      this.lastToken = null
      return {
        provider: 'github',
        state: 'cli_unavailable',
        credentialSource: 'gh-cli',
        detail:
          "GitHub CLI not found. Install it (https://cli.github.com) and run 'gh auth login'.",
      }
    }

    const token = await this.execGhAuthToken(resolvedPath, account)
    if (token === null) {
      this.lastToken = null
      return unauthenticated(account)
    }

    try {
      const user = await fetchGithubUser(token)
      this.lastToken = token
      return {
        provider: 'github',
        state: 'signed_in',
        credentialSource: 'gh-cli',
        user: { login: user.login },
      }
    } catch (error) {
      console.warn(
        '[auth] token de gh no es válido contra GET /user, se descarta:',
        toErrorMessage(error),
      )
      this.lastToken = null
      return unauthenticated(account)
    }
  }

  /**
   * `execFile(path, ['auth', 'token', '--hostname', GH_HOSTNAME])` contra la
   * ruta YA resuelta de `gh`, más `--user <account>` si hay una cuenta
   * elegida (F18) — sin ese flag `gh` devuelve el token de SU cuenta activa,
   * que es justo lo que el selector viene a poder cambiar. Devuelve `null`
   * para CUALQUIER falla (exit≠0 — incluido "no such user" si la cuenta
   * elegida ya no está en `gh` —, timeout, stdout vacío tras recortar
   * espacios); nunca lanza. Env CRUDO (`process.env`, sin
   * `buildSanitizedSpawnEnv`): ese saneado es solo para los CLIs de IA (borra
   * `GH_TOKEN`/`GITHUB_TOKEN`, justo lo que `gh` necesitaría si el usuario
   * los usa para autenticarse). Sin `shell` — args literales, nunca
   * interpolados en una cadena.
   */
  private execGhAuthToken(path: string, account: string | null): Promise<string | null> {
    const args = ['auth', 'token', '--hostname', GH_HOSTNAME]
    if (account !== null) args.push('--user', account)

    return new Promise((resolve) => {
      try {
        execFile(
          path,
          args,
          { timeout: GH_AUTH_TOKEN_TIMEOUT_MS, windowsHide: true, env: process.env },
          (error, stdout) => {
            if (error) {
              resolve(null)
              return
            }
            const token = stdout.trim()
            resolve(token.length > 0 ? token : null)
          },
        )
      } catch {
        // Defensa extra, mismo criterio que `cli-probe.ts`: `execFile`
        // normalmente reporta errores vía el callback, nunca lanzando.
        resolve(null)
      }
    })
  }

  /** Resuelve `gh` y le pide la lista de cuentas; `[]` ante cualquier problema. */
  private async probeAccounts(): Promise<GhAccount[]> {
    const resolvedPath = resolveCliPath('gh')
    if (resolvedPath === null) return []
    return this.execGhAuthStatus(resolvedPath)
  }

  /**
   * `gh auth status --hostname <host> --json hosts`, con fallback al parseo
   * del reporte de texto (`./gh-accounts.ts`) para versiones de `gh` sin
   * `--json`.
   *
   * Se ignora el EXIT CODE y se juntan stdout+stderr a propósito: en el
   * formato de texto `gh` sale con 1 y escribe a **stderr** en cuanto UNA de
   * las cuentas tiene el token vencido — que es EXACTAMENTE el caso que este
   * selector viene a resolver, así que tratarlo como fallo dejaría la lista
   * vacía justo cuando más se la necesita. La forma de la salida es la única
   * señal que se usa.
   */
  private execGhAuthStatus(path: string): Promise<GhAccount[]> {
    return new Promise((resolve) => {
      try {
        execFile(
          path,
          ['auth', 'status', '--hostname', GH_HOSTNAME, '--json', 'hosts'],
          { timeout: GH_AUTH_STATUS_TIMEOUT_MS, windowsHide: true, env: process.env },
          (jsonError, jsonStdout) => {
            const fromJson = parseGhAccountsJson(jsonStdout, GH_HOSTNAME)
            if (fromJson !== null) {
              resolve(fromJson)
              return
            }
            if (jsonError === null) {
              // `gh` aceptó `--json` pero devolvió algo que no reconocemos:
              // el fallback de texto tampoco va a entenderlo.
              resolve([])
              return
            }

            execFile(
              path,
              ['auth', 'status', '--hostname', GH_HOSTNAME],
              { timeout: GH_AUTH_STATUS_TIMEOUT_MS, windowsHide: true, env: process.env },
              (_textError, textStdout, textStderr) => {
                resolve(parseGhAccountsText(textStdout + '\n' + textStderr, GH_HOSTNAME))
              },
            )
          },
        )
      } catch {
        resolve([])
      }
    })
  }
}

/** Single `main` instance; shared by `./index.ts`, `./gh-retry.ts`, `../../ipc/handlers.ts` and `../../index.ts`. */
export const ghCliAuth = new GhCliAuth()
