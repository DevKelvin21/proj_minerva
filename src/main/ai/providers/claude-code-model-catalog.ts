/**
 * Refresco dinámico del catálogo de modelos de Claude Code (F19, patrón EXACTO
 * de `./codex-model-catalog.ts` y `./opencode-model-catalog.ts`): le pregunta
 * al propio CLI qué modelos tiene disponibles la sesión, en vez de servir la
 * lista curada a mano de `../../../shared/ai-providers.ts`.
 *
 * POR QUÉ EXISTE: hasta F19 Claude Code era el único proveedor SIN catálogo
 * dinámico (`./provider-models.ts` lo devolvía estático "porque no hay nada
 * que refrescar"), así que cada modelo nuevo de Anthropic requería editar el
 * catálogo curado y publicar una release de Minerva para que apareciera en el
 * picker de Settings. Síntoma que lo destapó: `claude` 2.1.220 ya ofrecía
 * Opus 5 y el picker seguía mostrando Opus 4.8 como el modelo más nuevo.
 *
 * MECANISMO, verificado EMPÍRICAMENTE contra `claude` 2.1.220 +
 * `@anthropic-ai/claude-agent-sdk` 0.3.203 (probe ad-hoc, 729 ms):
 * `query()` en modo STREAMING INPUT (prompt = `AsyncGenerator`, no un string)
 * levanta el CLI y expone los control requests del protocolo; entre ellos
 * `supportedModels()`, que devuelve `ModelInfo[]` con los modelos que ESA
 * sesión/cuenta puede usar. El generador de entrada NUNCA yieldea un mensaje:
 * el CLI arranca, hace el handshake, responde el control request y se queda
 * esperando input que no llega — o sea CERO tokens de LLM, esto no es una
 * consulta al modelo sino al CLI. Confirmado también que
 * `abortController.abort()` en el `finally` mata al proceso hijo (no queda un
 * `claude` huérfano por refresco).
 *
 * Diferencias con la respuesta cruda del SDK, a propósito:
 * - La fila `value: 'default'` ("Default (recommended)") se DESCARTA: resuelve
 *   al mismo `resolvedModel` que una fila concreta de la lista (hoy
 *   `opus[1m]`), y Minerva persiste un modelo concreto por proveedor, así que
 *   dejarla haría que DOS cards se leyeran como "Activo" para la misma
 *   selección. Nada se pierde: el modelo recomendado ya está en la lista con
 *   su nombre propio.
 * - `resolvedModel` se propaga como `aliasFor` (ver `AiModelOption`) para que
 *   una selección persistida con el id canónico (`claude-sonnet-5`, que es lo
 *   que el catálogo curado ofrecía) matchee la fila alias que hoy la cubre
 *   (`sonnet`).
 * - El descriptor `effort` (T34) sale de `supportedEffortLevels`. El SDK NO
 *   reporta cuál es el nivel por defecto de cada modelo (a diferencia de
 *   `defaultReasoningEffort` en Codex), así que se usa `high` cuando el modelo
 *   lo soporta — el mismo default que tenían los descriptores curados — y si
 *   no, `resolveOptionValue` cae al primer nivel de la lista.
 *
 * Ante CUALQUIER fallo (binario ausente, sin sesión, timeout, forma de
 * respuesta inesperada) devuelve el catálogo curado
 * (`AI_PROVIDER_CATALOG['claude-code'].models`) sin lanzar — pensado para
 * llamarse desde un contexto best-effort (`./provider-models.ts`), que nunca
 * debe tumbar la pantalla de Settings.
 */
import { tmpdir } from 'node:os'
import { query } from '@anthropic-ai/claude-agent-sdk'
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import type { AiModelOption, ModelOptionDescriptor } from '../../../shared/ai-providers'
import { AI_PROVIDER_CATALOG, effortDescriptor } from '../../../shared/ai-providers'
import { resolveCliPath } from './resolve-cli'
import { buildSanitizedSpawnEnv } from './spawn-env'

/**
 * Techo de espera del control request. El probe real tardó ~0.7 s; este margen
 * cubre un arranque frío del CLI (auto-update, cold cache de Node) sin dejar
 * la pantalla de Settings esperando indefinidamente si el CLI se cuelga.
 */
const SUPPORTED_MODELS_TIMEOUT_MS = 15_000

/** Nivel de effort al que caen los modelos de Claude Code, igual que los descriptores curados (T34). */
const PREFERRED_DEFAULT_EFFORT = 'high'

/**
 * Fila de `supportedModels()` (`ModelInfo` del Agent SDK). Se declara LOCAL y
 * parcial —solo los campos que este módulo usa— por el mismo criterio que
 * `CodexModel` en `./codex-model-catalog.ts`: la forma que importa es la que se
 * verificó contra el binario real, y así un cambio de tipos del SDK no rompe
 * el build por campos que no se leen.
 */
interface ClaudeModelInfo {
  value: string
  resolvedModel?: string
  displayName?: string
  supportsEffort?: boolean
  supportedEffortLevels?: string[]
}

/** Sesión mínima contra el CLI que este módulo necesita; inyectable para testear sin spawnear nada. */
export interface ClaudeModelSession {
  supportedModels: () => Promise<ClaudeModelInfo[]>
  /** Mata el proceso hijo del SDK. Se llama SIEMPRE, éxito o error. */
  close: () => void
}

/**
 * Entrada de streaming que no manda ningún mensaje: mantiene la sesión abierta
 * (necesario para que el CLI atienda control requests) y termina cuando se
 * aborta. Cerrar el generador de inmediato en vez de esperar el abort haría
 * que el CLI viera EOF en stdin y pudiera salir antes de responder.
 */
// El punto de este generador es NO mandar mensajes: solo mantener stdin abierto
// para que el CLI atienda el control request. Un `yield` acá sería un turno de
// conversación de verdad (y tokens), por eso el disable no es un parche.
// eslint-disable-next-line require-yield
async function* pendingInput(signal: AbortSignal): AsyncGenerator<SDKUserMessage> {
  await new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve()
      return
    }
    signal.addEventListener('abort', () => resolve(), { once: true })
  })
}

/**
 * Abre la sesión real contra el `claude` del sistema. La ruta se resuelve con
 * `resolveCliPath` (T31: un proceso GUI puede no heredar el `PATH` de una
 * terminal) y lanza si el binario no está, para que el caller caiga al
 * catálogo curado.
 *
 * `cwd` es `tmpdir()` a propósito: no hay repo ni `CLAUDE.md` que descubrir
 * para listar modelos, y así este spawn nunca apunta a un snapshot de PR
 * (código hostil, ver la frontera de seguridad en CLAUDE.md).
 * `settingSources: []` + `persistSession: false` completan el aislamiento: no
 * lee settings/hooks del filesystem ni deja una sesión huérfana en
 * `~/.claude/projects/`.
 */
function openRealSession(): ClaudeModelSession {
  const claudeCliPath = resolveCliPath('claude')
  if (claudeCliPath === null) {
    throw new Error('The "claude" CLI is not on the PATH.')
  }

  const controller = new AbortController()
  const stream = query({
    prompt: pendingInput(controller.signal),
    options: {
      pathToClaudeCodeExecutable: claudeCliPath,
      cwd: tmpdir(),
      env: buildSanitizedSpawnEnv(),
      persistSession: false,
      settingSources: [],
      abortController: controller,
    },
  })

  return {
    supportedModels: () => stream.supportedModels(),
    close: () => controller.abort(),
  }
}

/**
 * Arma el descriptor `effort` (T34) de un modelo a partir de sus
 * `supportedEffortLevels`; `undefined` si el modelo no declara soporte de
 * effort (p. ej. Haiku hoy), caso en el que el `AiModelOption` queda sin
 * `options` y el servicio omite el campo entero al llamar al SDK.
 */
function buildEffortDescriptor(model: ClaudeModelInfo): ModelOptionDescriptor | undefined {
  const levels = model.supportedEffortLevels
  if (model.supportsEffort !== true || !levels || levels.length === 0) return undefined

  const defaultValue = levels.includes(PREFERRED_DEFAULT_EFFORT) ? PREFERRED_DEFAULT_EFFORT : levels[0]
  return effortDescriptor(levels, defaultValue)
}

/** `null` para una fila que no sirve como opción elegible (id vacío, o la fila alias `default`, ver la cabecera del módulo). */
function toModelOption(model: ClaudeModelInfo): AiModelOption | null {
  if (typeof model.value !== 'string' || model.value.length === 0) return null
  if (model.value === 'default') return null

  const label =
    typeof model.displayName === 'string' && model.displayName.length > 0 ? model.displayName : model.value
  const effort = buildEffortDescriptor(model)
  const aliasFor =
    typeof model.resolvedModel === 'string' &&
    model.resolvedModel.length > 0 &&
    model.resolvedModel !== model.value
      ? model.resolvedModel
      : undefined

  return {
    id: model.value,
    label,
    vendor: 'Anthropic',
    ...(effort === undefined ? {} : { options: [effort] }),
    ...(aliasFor === undefined ? {} : { aliasFor }),
  }
}

/**
 * Intenta refrescar el catálogo de modelos de Claude Code preguntándole al CLI
 * (`supportedModels()`, ver la cabecera del módulo). Ante CUALQUIER fallo
 * devuelve el catálogo curado sin lanzar. La sesión se cierra SIEMPRE en el
 * `finally`, éxito, error o timeout.
 */
export async function fetchClaudeCodeModelCatalog(
  openSession: () => ClaudeModelSession = openRealSession,
): Promise<readonly AiModelOption[]> {
  let session: ClaudeModelSession | null = null
  let timer: NodeJS.Timeout | undefined
  try {
    session = openSession()

    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error('supportedModels() did not answer in time.')),
        SUPPORTED_MODELS_TIMEOUT_MS,
      )
    })
    // El `.catch` no es redundante con el `try`: si gana el timeout, la promesa
    // PERDEDORA sigue viva y va a rechazar en cuanto el `close()` del `finally`
    // aborte la sesión. Sin este handler eso queda como unhandled rejection en
    // el proceso main (que ya nadie está esperando).
    const pending = session.supportedModels()
    pending.catch(() => {})
    const raw = await Promise.race([pending, timeout])

    const models: AiModelOption[] = []
    for (const model of raw ?? []) {
      const option = toModelOption(model)
      if (option) models.push(option)
    }

    return models.length > 0 ? models : AI_PROVIDER_CATALOG['claude-code'].models
  } catch {
    return AI_PROVIDER_CATALOG['claude-code'].models
  } finally {
    clearTimeout(timer)
    session?.close()
  }
}
