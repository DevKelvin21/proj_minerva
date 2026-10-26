/**
 * Enumeración de las cuentas que `gh` conoce para `GH_HOSTNAME` (F18).
 *
 * `gh` soporta varias cuentas por host a la vez y elige la "activa" cuando no
 * se le pasa `--user`. Hasta F18 Minerva heredaba esa elección sin poder
 * cambiarla: en una máquina con la cuenta del trabajo activa y la personal
 * también logueada, el puente de token (`./gh-cli-auth.ts`) siempre traía la
 * primera. Este módulo es la mitad de LECTURA de la solución (la de escritura
 * es `githubAccount` en `../settings/store.ts`): produce la lista que la UI
 * de Settings ofrece.
 *
 * Dos formatos, misma salida, porque `gh auth status --json` es reciente:
 * - `parseGhAccountsJson` — `gh auth status --json hosts` (camino preferido:
 *   exit 0 SIEMPRE, incluso con cuentas rotas, y datos ya estructurados).
 * - `parseGhAccountsText` — fallback para versiones de `gh` sin `--json`, que
 *   además escriben el reporte a **stderr** y salen con 1 en cuanto UNA
 *   cuenta tiene el token vencido. Por eso quien invoca junta stdout+stderr e
 *   ignora el exit code (ver `./gh-cli-auth.ts`).
 *
 * Ambas son PURAS (string -> GhAccount[]): toda la fragilidad de parsear la
 * salida de un CLI ajeno queda acá, cubierta por tests, en vez de mezclada
 * con el spawn.
 */
import type { GhAccount } from '../../../shared/types'

/**
 * Tope defensivo de cuentas devueltas: `gh` no impone un máximo y la lista
 * alimenta un selector de UI. Un `hosts.yml` gigante (o corrupto) no debe
 * poder inflar un payload IPC ni la lista renderizada.
 */
const MAX_ACCOUNTS = 20

/** Tope de largo de un login de GitHub (39 según GitHub; se deja holgura para GHES). */
const MAX_LOGIN_LEN = 64

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Login plausible: no vacío, sin espacios y dentro del tope. Descarta ruido de un parseo torcido. */
function isUsableLogin(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_LOGIN_LEN &&
    !/\s/.test(value)
  )
}

/**
 * Deduplica por login (gana la primera aparición, que es la que `gh` lista
 * primero) y recorta a `MAX_ACCOUNTS`. Compartido por los dos parsers para
 * que ambos garanticen las MISMAS invariantes a quien los consume.
 */
function normalize(accounts: GhAccount[]): GhAccount[] {
  const seen = new Set<string>()
  const result: GhAccount[] = []
  for (const account of accounts) {
    if (seen.has(account.login)) continue
    seen.add(account.login)
    result.push(account)
    if (result.length >= MAX_ACCOUNTS) break
  }
  return result
}

/**
 * Salida de `gh auth status --json hosts --hostname <host>`:
 * `{"hosts":{"github.com":[{"state":"success","active":true,"login":"..."}]}}`.
 *
 * `state: 'success'` es la ÚNICA marca de token sano — cualquier otro valor
 * (`'error'`, con un `error` tipo "HTTP 401: Bad credentials") viaja como
 * `valid: false` en vez de desaparecer: la UI debe poder mostrar "esta cuenta
 * está en gh pero su token venció", que es más útil que ocultarla.
 *
 * Devuelve `null` (no `[]`) si el JSON no tiene la forma esperada — así el
 * llamador distingue "gh no habla este formato, probá el fallback de texto"
 * de "gh no tiene ninguna cuenta en este host".
 */
export function parseGhAccountsJson(raw: string, host: string): GhAccount[] | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  if (!isPlainObject(parsed) || !isPlainObject(parsed.hosts)) return null
  const entries = parsed.hosts[host]
  if (!Array.isArray(entries)) return null

  const accounts: GhAccount[] = []
  for (const entry of entries) {
    if (!isPlainObject(entry)) continue
    if (!isUsableLogin(entry.login)) continue
    accounts.push({
      login: entry.login,
      active: entry.active === true,
      valid: entry.state === 'success',
    })
  }
  return normalize(accounts)
}

/**
 * Fallback para `gh` sin `--json`. Formato (una sección por host, el host
 * como línea SIN indentar y sus cuentas indentadas debajo):
 *
 *     github.com
 *       ✓ Logged in to github.com account octocat (/home/u/.config/gh/hosts.yml)
 *       - Active account: true
 *       X Failed to log in to github.com account otro (default)
 *       - Active account: false
 *
 * Se filtra por sección de host (una máquina con GHES lista varios) y se leen
 * dos señales por cuenta: el verbo de la línea de encabezado ("Logged in" vs
 * "Failed to log in") para `valid`, y la línea "Active account:" siguiente
 * para `active`. Si esa línea falta (formatos viejos), `active` queda en
 * `false` — degradar a "ninguna marcada como activa" es inocuo: sin selección
 * explícita el puente de token no pasa `--user` y `gh` resuelve la activa por
 * su cuenta.
 */
export function parseGhAccountsText(raw: string, host: string): GhAccount[] {
  const accounts: GhAccount[] = []
  let inHostSection = false
  let current: GhAccount | null = null

  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue

    // Línea sin indentar = encabezado de host. Cambia (o cierra) la sección.
    if (!/^\s/.test(line)) {
      inHostSection = trimmed === host
      current = null
      continue
    }
    if (!inHostSection) continue

    const header = /(?:^|\s)account\s+(\S+)(?:\s|$)/.exec(trimmed)
    if (header !== null && /logged in|failed to log in/i.test(trimmed)) {
      const login = header[1]
      if (!isUsableLogin(login)) {
        current = null
        continue
      }
      current = { login, active: false, valid: !/failed to log in/i.test(trimmed) }
      accounts.push(current)
      continue
    }

    const activeLine = /^-\s*Active account:\s*(true|false)\s*$/i.exec(trimmed)
    if (activeLine !== null && current !== null) {
      current.active = activeLine[1].toLowerCase() === 'true'
    }
  }

  return normalize(accounts)
}
