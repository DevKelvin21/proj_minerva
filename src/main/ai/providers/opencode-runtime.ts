/**
 * Ciclo de vida del server local `opencode serve` (T55, patrón `opencodeRuntime.ts`
 * de t3code — repo `pingdotgg/t3code`, adaptado de Effect-TS a Node/TS plano
 * estilo Minerva). Este módulo NO usa `@opencode-ai/sdk` (eso es T56,
 * `./opencode-service.ts`): solo sabe resolver el binario, spawnearlo como
 * server HTTP local read-only y matarlo limpio. Un server para toda la app
 * (singleton lazy, arranca en el primer análisis que lo necesite).
 *
 * WIRE VERIFICADO EMPÍRICAMENTE (T29/T55 — lección: nunca adivinar el
 * protocolo) contra el binario real `opencode` 1.17.18
 * (`~/.local/bin/opencode`, un wrapper de omarchy que resuelve la versión vía
 * `npx` la primera vez — el arranque en frío puede tardar varios segundos,
 * de ahí `SERVER_READY_TIMEOUT_MS`):
 *
 *   $ OPENCODE_CONFIG_CONTENT='{"permission":{...}}' \
 *       opencode serve --hostname=127.0.0.1 --port=44687
 *   Warning: OPENCODE_SERVER_PASSWORD is not set; server is unsecured.
 *   opencode server listening on http://127.0.0.1:44687
 *
 *   $ curl http://127.0.0.1:44687/global/health
 *   {"healthy":true,"version":"1.17.18"}
 *
 * La línea de "ready" puede venir precedida de otras líneas en stdout (el
 * warning de arriba, por ejemplo) — por eso `parseServerUrlFromOutput` busca
 * línea por línea un prefijo exacto en vez de asumir que es la primera línea
 * o que el buffer entero empieza con ella. Matar el proceso con una señal
 * simple (sin process group) fue suficiente en la prueba manual (el wrapper
 * de omarchy hace `exec` internamente, así que el PID que devuelve `spawn`
 * termina siendo el proceso real de `opencode`, sin hijos huérfanos) — igual
 * usamos `process.kill(-pid, ...)` (kill de GRUPO) porque `detached: true`
 * lo habilita y es más robusto ante wrappers que NO hagan `exec` en otras
 * plataformas/instalaciones.
 */
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { mt } from '../../i18n'
import { resolveCliPath } from './resolve-cli'
import { buildSanitizedSpawnEnv } from './spawn-env'

/** Versión mínima soportada de OpenCode (T55). Por debajo de esto no se garantiza el wire verificado arriba. */
export const MIN_OPENCODE_VERSION = '1.14.19'

/** Timeout de `opencode --version` (gate de versión, hot path barato — mismo criterio que `./cli-probe.ts`). */
const VERSION_CHECK_TIMEOUT_MS = 5_000
/** Timeout de arranque del server: el wrapper de omarchy puede tardar en resolver el binario vía npx en frío. */
const SERVER_READY_TIMEOUT_MS = 10_000
/** Cuánto se espera tras SIGTERM antes de escalar a SIGKILL. */
const STOP_GRACE_PERIOD_MS = 1_000
/** Prefijo EXACTO de la línea de "ready" en stdout, verificado contra el binario real (ver comentario del módulo). */
const SERVER_READY_PREFIX = 'opencode server listening'

/**
 * Config de permisos READ-ONLY para el server embebido (T55): el snapshot del
 * PR (T54) es contenido NO CONFIABLE, así que el agente jamás debe poder
 * editar archivos, correr comandos, ni salir a la red. `question` también se
 * deniega — NUNCA `'ask'`: en un server headless sin humano del otro lado
 * `'ask'` cuelga la sesión esperando una aprobación que nunca llega.
 */
export const OPENCODE_READONLY_CONFIG = {
  permission: {
    '*': 'deny',
    edit: 'deny',
    bash: 'deny',
    webfetch: 'deny',
    websearch: 'deny',
    question: 'deny',
    external_directory: 'deny',
    read: 'allow',
    grep: 'allow',
    glob: 'allow',
    list: 'allow',
  },
} as const

export interface OpencodeServerHandle {
  url: string
}

export interface OpencodeVersionCheck {
  ok: boolean
  version: string | null
  error?: string
}

/** Mensaje accionable cuando `resolveCliPath('opencode')` no encuentra el binario en ninguna ubicación conocida. */
function describeUnresolvedOpencodeBinary(): string {
  return mt('ai.opencode.binaryNotInstalled')
}

/** Mensaje accionable para un fallo de `spawn`/`execFile` (ENOENT u otra causa). */
function describeSpawnFailure(binary: string, error: unknown): string {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  if (code === 'ENOENT') {
    return mt('ai.opencode.binaryNotInPath', { binary })
  }
  const message = error instanceof Error ? error.message : String(error)
  return mt('ai.opencode.serverSpawnFailed', { binary, detail: message })
}

/** Extrae los tres números de un string de versión tipo "1.17.18" (o con prefijo/sufijo alrededor); `null` si no matchea. */
function parseSemver(raw: string): [number, number, number] | null {
  const match = raw.match(/(\d+)\.(\d+)\.(\d+)/)
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

/** Compara dos versiones ya parseadas: negativo si `a < b`, 0 si son iguales, positivo si `a > b`. */
function compareSemver(a: [number, number, number], b: [number, number, number]): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
}

/**
 * Corre `opencode --version` y compara contra `MIN_OPENCODE_VERSION`. Nunca
 * lanza: cualquier fallo (binario ausente, timeout, salida no parseable)
 * devuelve `{ ok: false, ... }` con un `error` accionable en español.
 */
export function checkOpencodeVersion(): Promise<OpencodeVersionCheck> {
  return new Promise((resolve) => {
    const binary = resolveCliPath('opencode')
    if (binary === null) {
      resolve({ ok: false, version: null, error: describeUnresolvedOpencodeBinary() })
      return
    }

    execFile(binary, ['--version'], { timeout: VERSION_CHECK_TIMEOUT_MS }, (error, stdout) => {
      if (error) {
        resolve({ ok: false, version: null, error: describeSpawnFailure(binary, error) })
        return
      }

      const raw = stdout.trim()
      const parsed = parseSemver(raw)
      if (!parsed) {
        resolve({
          ok: false,
          version: raw.length > 0 ? raw : null,
          error: mt('ai.opencode.versionUnparseable', { output: raw }),
        })
        return
      }

      const minParsed = parseSemver(MIN_OPENCODE_VERSION)
      // MIN_OPENCODE_VERSION es una constante propia, siempre parseable — la
      // aserción documenta esa garantía sin agregar una rama muerta.
      const ok = compareSemver(parsed, minParsed as [number, number, number]) >= 0
      resolve({
        ok,
        version: raw,
        error: ok
          ? undefined
          : mt('ai.opencode.versionTooOld', { version: raw, min: MIN_OPENCODE_VERSION }),
      })
    })
  })
}

/** Puerto TCP libre en loopback: escucha en el puerto 0 (el SO asigna uno), lee cuál fue y cierra. */
function findEphemeralPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      if (address === null || typeof address === 'string') {
        probe.close()
        reject(new Error(mt('ai.opencode.noFreePort')))
        return
      }
      const port = address.port
      probe.close(() => resolve(port))
    })
  })
}

/** Busca, línea por línea, la línea de "ready" y extrae la URL (formato verificado en el comentario del módulo). */
function parseServerUrlFromOutput(output: string): string | null {
  for (const line of output.split('\n')) {
    if (!line.startsWith(SERVER_READY_PREFIX)) continue
    const match = line.match(/on\s+(https?:\/\/[^\s]+)/)
    if (match) return match[1]
  }
  return null
}

function describeOutputTail(stdout: string, stderr: string): string {
  const parts: string[] = []
  if (stdout.trim().length > 0) parts.push('stdout:\n' + stdout.trim())
  if (stderr.trim().length > 0) parts.push('stderr:\n' + stderr.trim())
  return parts.length > 0 ? '\n\n' + parts.join('\n\n') : ''
}

/** `true` si el proceso con ese pid sigue vivo (señal 0 no mata, solo prueba existencia/permiso). */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Manda una señal al GRUPO de procesos (pid negativo) — funciona porque el hijo se spawnea `detached: true`, que lo convierte en líder de su propio grupo. Silencioso si ya murió. */
function killProcessGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal)
  } catch {
    // Ya murió, o el grupo ya no existe: no hay nada que limpiar.
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Singleton lazy módulo-local: UN server de OpenCode para toda la app (T55).
// `serverPromise` se comparte entre llamadas concurrentes a
// `getOpencodeServer()` para no spawnear dos servers en paralelo; si el
// arranque falla se limpia (`= null`) para permitir un reintento en la
// siguiente llamada en vez de quedar "atascado" en el error de la primera.
let serverPromise: Promise<OpencodeServerHandle> | null = null
let serverChild: ChildProcess | null = null

/**
 * Generación del intento de arranque en curso. `stopOpencodeServer()` la
 * incrementa para CANCELAR un arranque que todavía no llegó al `spawn`.
 *
 * Hace falta porque `spawnOpencodeServer` espera `findEphemeralPort()` (async:
 * abre y cierra un socket) ANTES de spawnear: un stop dentro de esa ventana
 * limpiaba el singleton y devolvía sin nada que matar, y la promesa en vuelo
 * seguía adelante y spawneaba el proceso DESPUÉS —ya con la app cerrándose—,
 * garantizando un huérfano. Es la segunda mitad del leak de F20: registrar el
 * hijo desde el `spawn` cubre "arrancando", esto cubre "todavía no arrancó".
 */
let spawnGeneration = 0

function spawnOpencodeServer(): Promise<OpencodeServerHandle> {
  const binary = resolveCliPath('opencode')
  if (binary === null) {
    return Promise.reject(new Error(describeUnresolvedOpencodeBinary()))
  }

  const generation = spawnGeneration

  return findEphemeralPort().then(
    (port) =>
      new Promise<OpencodeServerHandle>((resolve, reject) => {
        if (generation !== spawnGeneration) {
          reject(new Error(mt('ai.opencode.startCancelled')))
          return
        }

        const env = {
          ...buildSanitizedSpawnEnv(),
          OPENCODE_CONFIG_CONTENT: JSON.stringify(OPENCODE_READONLY_CONFIG),
        }

        let child: ChildProcess
        try {
          child = spawn(binary, ['serve', '--hostname=127.0.0.1', '--port=' + String(port)], {
            detached: true,
            stdio: ['ignore', 'pipe', 'pipe'],
            env,
          })
        } catch (error) {
          reject(new Error(describeSpawnFailure(binary, error)))
          return
        }

        // Se registra ACÁ, no cuando el server imprime su línea de "ready".
        // Antes se asignaba en el handler de stdout, así que durante todo el
        // arranque (que en frío son segundos: el wrapper resuelve el binario por
        // npx) `serverChild` seguía en `null` y `stopOpencodeServer()` era un
        // no-op: cerrar la app en esa ventana dejaba un `opencode serve` de
        // ~300 MB reparentado a init (`detached: true` lo hace líder de su
        // propio grupo, así que tampoco se lo lleva la muerte del padre) y
        // vivo para siempre. Con 39 tests e2e que lo spawnean al arrancar
        // —el panel didáctico pide `ai:getProviderStatus` en cada montaje— eso
        // acumulaba decenas de procesos y >15 GB de RAM. Registrarlo desde el
        // spawn hace que SIEMPRE haya a quién matar.
        serverChild = child
        /** Baja el registro solo si sigue apuntando a ESTE hijo (no pisar un server posterior). */
        const unregister = (): void => {
          if (serverChild === child) serverChild = null
        }

        let settled = false
        let stdout = ''
        let stderr = ''

        const timeoutId = setTimeout(() => {
          if (settled) return
          settled = true
          if (child.pid !== undefined) killProcessGroup(child.pid, 'SIGKILL')
          unregister()
          reject(
            new Error(
              mt('ai.opencode.serverStartTimeout', { ms: SERVER_READY_TIMEOUT_MS }) +
                describeOutputTail(stdout, stderr),
            ),
          )
        }, SERVER_READY_TIMEOUT_MS)

        // `spawn` no lanza sincrónicamente por ENOENT: el proceso "fantasma"
        // emite 'error' de forma asíncrona (mismo gotcha que
        // `./codex-app-server-client.ts`).
        child.on('error', (error) => {
          if (settled) return
          settled = true
          clearTimeout(timeoutId)
          unregister()
          reject(new Error(describeSpawnFailure(binary, error)))
        })

        child.stdout?.on('data', (chunk: Buffer) => {
          if (settled) return
          stdout += chunk.toString('utf-8')
          const url = parseServerUrlFromOutput(stdout)
          if (url === null) return
          settled = true
          clearTimeout(timeoutId)
          // `serverChild` ya quedó registrado en el spawn; si mientras
          // arrancábamos alguien llamó a `stopOpencodeServer()`, el registro es
          // `null` y este server ya está condenado (recibió el SIGTERM del
          // grupo): no se lo re-publica como el singleton vivo.
          if (serverChild !== child) {
            reject(new Error(mt('ai.opencode.serverStoppedWhileStarting')))
            return
          }
          resolve({ url })
        })

        child.stderr?.on('data', (chunk: Buffer) => {
          stderr += chunk.toString('utf-8')
        })

        child.on('exit', (code, signal) => {
          if (settled) {
            // El server murió DESPUÉS de estar listo (crash, kill externo):
            // resetear el singleton para que el próximo análisis re-spawnee
            // en vez de fallar contra una URL muerta hasta reiniciar la app.
            if (serverChild === child) {
              serverChild = null
              serverPromise = null
            }
            return
          }
          settled = true
          clearTimeout(timeoutId)
          unregister()
          reject(
            new Error(
              mt('ai.opencode.processExitedEarly', { code: String(code), signal: String(signal) }) +
                describeOutputTail(stdout, stderr),
            ),
          )
        })
      }),
  )
}

/**
 * Devuelve el server de OpenCode (spawneándolo si es la primera llamada).
 * Singleton lazy: llamadas concurrentes comparten la misma promesa, así que
 * solo se spawnea UN proceso aunque varios análisis lo pidan a la vez. Si el
 * arranque falla, la próxima llamada reintenta desde cero.
 */
export function getOpencodeServer(): Promise<OpencodeServerHandle> {
  if (serverPromise === null) {
    serverPromise = spawnOpencodeServer().catch((error: unknown) => {
      serverPromise = null
      throw error instanceof Error ? error : new Error(String(error))
    })
  }
  return serverPromise
}

/**
 * Mata el server de OpenCode (si hay uno vivo): SIGTERM al GRUPO de procesos,
 * espera `STOP_GRACE_PERIOD_MS` y escala a SIGKILL si sigue vivo. Idempotente
 * (llamar sin un server activo es un no-op) y resetea el singleton para que
 * la próxima `getOpencodeServer()` spawnee uno nuevo. El cableado en
 * `before-quit` de `main/index.ts` lo hace el orquestador, NO este módulo.
 *
 * También CANCELA un arranque en vuelo que todavía no llegó al `spawn` (ver
 * `spawnGeneration`): sin eso, "no había nada que matar" no significaba "no
 * queda nada corriendo", significaba "el proceso se va a crear en un momento y
 * nadie lo va a matar".
 */
export async function stopOpencodeServer(): Promise<void> {
  spawnGeneration++
  const child = serverChild
  serverChild = null
  serverPromise = null
  if (child === null || child.pid === undefined) return

  const pid = child.pid
  killProcessGroup(pid, 'SIGTERM')
  await delay(STOP_GRACE_PERIOD_MS)
  if (isProcessAlive(pid)) {
    killProcessGroup(pid, 'SIGKILL')
  }
}
