/**
 * Tracker del mini-log de actividad del harness (F13). Módulo PURO (sin
 * timers ni I/O, estilo `./throttle.ts`): mantiene el buffer rodante de las
 * últimas acciones internas del agente (tool calls sobre el snapshot +
 * "Pensando…") que viaja en `AnalyzeProgressMeta.activity` (`./service.ts`)
 * hasta el renderer.
 *
 * Decisiones de diseño (F13):
 * - COLAPSO POR IDENTIDAD (patrón t3code): eventos repetidos de la misma
 *   llamada (`id`) actualizan la MISMA fila (running -> done/error), nunca
 *   agregan una segunda. Repetir `begin` con un id vivo tampoco duplica.
 * - EDGES SIN THROTTLE: `onEdge` se dispara exactamente en las transiciones
 *   de estado (begin/complete/fail y el PRIMER `thinking` de cada bloque) —
 *   son pocas por análisis, así que el proveedor puede emitir `onProgress`
 *   directo, sin pasar por `createThrottle` (que es leading-edge sin
 *   trailing flush: un edge tragado por él podría quedar invisible durante
 *   un silencio largo del modelo).
 * - LOS DETALLES SON HOSTILES: rutas y patrones vienen del snapshot del PR
 *   (código no confiable). `sanitizeDetail` los limpia UNA vez acá (control
 *   chars fuera, whitespace colapsado, truncado) antes de que el texto cruce
 *   el IPC; el renderer pinta `label` tal cual, jamás deriva texto.
 * - RAZONAMIENTO = "Pensando…" GENÉRICO: `thinking()` ignora cualquier
 *   texto a propósito — el contenido del razonamiento puede citar el
 *   snapshot hostil (prompt injection) y además llega parcial/ruidoso.
 *
 * Nota (Claude Code): bajo `permissionMode: 'dontAsk'` el stream crudo no
 * expone fallos de herramienta, así que las filas de ese proveedor nunca
 * llegan a `error` — `fail()` existe para OpenCode (ToolStateError) y
 * futuros proveedores que sí lo señalicen.
 */
import type { AnalysisActivityItem, AnalysisActivityKind } from '../../shared/events'
import type { AppLocale } from '../../shared/locale'
import { getMainLocale, mt } from '../i18n'

/** Tamaño del buffer rodante: el renderer muestra estas filas y ninguna más. */
export const MAX_ACTIVITY_ITEMS = 5

/** Largo máximo de un detalle saneado (ruta/patrón) dentro de un label. */
const MAX_DETAIL_LENGTH = 64

export interface ActivityTracker {
  /**
   * Upsert de una acción en curso. Si el `id` ya está en el buffer solo
   * refresca kind/detalle (sin duplicar fila); si es nuevo, apendiza
   * (evictando la fila más vieja si el buffer está lleno). Cierra cualquier
   * "Pensando…" abierto (una tool call nueva implica que el razonamiento de
   * ese tramo terminó). Dispara `onEdge`.
   */
  begin(id: string, kind: AnalysisActivityKind, detail?: string): void
  /**
   * Marca la fila `id` como `done`, opcionalmente refinando el detalle (el
   * caso Claude: los args de la tool recién se conocen completos al cerrar
   * el bloque). Si el id ya salió del buffer por evicción, NO re-inserta
   * (esa acción ya es historia). Dispara `onEdge` solo si había fila viva.
   */
  complete(id: string, detail?: string): void
  /** Como `complete` pero con estado `error`. */
  fail(id: string): void
  /**
   * Registra razonamiento como una fila "Pensando…" genérica. Solo es edge
   * la PRIMERA vez por `id` (deltas repetidos del mismo bloque = no-op):
   * los streams de thinking emiten decenas de deltas por segundo.
   */
  thinking(id: string): void
  /**
   * Cierra un "Pensando…" abierto SIN disparar edge: lo llama el proveedor
   * en su primer delta de texto de respuesta, y el buffer actualizado viaja
   * con esa misma emisión (que ya pasa por el throttle de texto).
   */
  settleThinking(): void
  /** Copia fresca del buffer (≤ MAX_ACTIVITY_ITEMS), apta para IPC. */
  buffer(): AnalysisActivityItem[]
}

export interface ActivityTrackerOptions {
  /**
   * Prefijo a recortar de rutas absolutas en los detalles: los proveedores
   * pasan el directorio del snapshot para que las etiquetas muestren rutas
   * relativas al repo ("src/api/routes.ts", no "/home/.../snapshots/...").
   */
  basePath?: string
  /** Language of the labels: the analysis language (default: current main locale). */
  language?: AppLocale
  /**
   * Llamado en cada transición de estado (ver arriba). El proveedor emite
   * `onProgress` acá, SIN throttle.
   */
  onEdge: () => void
}

/**
 * Sanea un detalle no confiable (ruta/patrón del snapshot hostil): quita
 * caracteres de control, colapsa todo whitespace (incluidos saltos de línea)
 * a espacios simples, recorta y trunca a `MAX_DETAIL_LENGTH` con "…".
 * Exportada para tests.
 */
export function sanitizeDetail(raw: string, basePath?: string): string {
  let detail = raw
  if (basePath && basePath.length > 0 && detail.startsWith(basePath)) {
    detail = detail.slice(basePath.length)
    if (detail.startsWith('/')) detail = detail.slice(1)
  }
  detail = detail
    // eslint-disable-next-line no-control-regex -- limpiar control chars es el punto
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (detail.length > MAX_DETAIL_LENGTH) {
    detail = detail.slice(0, MAX_DETAIL_LENGTH - 1) + '…'
  }
  return detail
}

/**
 * Deriva la etiqueta de una entrada en `language` (idea `deriveToolActivityPresentation`
 * de t3code): verbo por `kind` + estado gramatical por `status`, con
 * fallbacks genéricos cuando no hay detalle. `detail` DEBE llegar ya
 * saneado (esta función no vuelve a sanear). Exportada para tests.
 */
export function deriveActivityLabel(
  kind: AnalysisActivityKind,
  status: AnalysisActivityItem['status'],
  detail?: string,
  language: AppLocale = getMainLocale(),
): string {
  const d = detail && detail.length > 0 ? detail : undefined
  const l = (key: Parameters<typeof mt>[0]): string => mt(key, { detail: d ?? '' }, language)
  switch (kind) {
    case 'read':
      if (status === 'error') return l(d ? 'ai.activity.readFailedDetail' : 'ai.activity.readFailed')
      if (status === 'done') return l(d ? 'ai.activity.readDoneDetail' : 'ai.activity.readDone')
      return l(d ? 'ai.activity.readingDetail' : 'ai.activity.reading')
    case 'search':
      if (status === 'error') return l('ai.activity.searchFailed')
      if (status === 'done') return l(d ? 'ai.activity.searchDoneDetail' : 'ai.activity.searchDone')
      return l(d ? 'ai.activity.searchingDetail' : 'ai.activity.searching')
    case 'list':
      if (status === 'error') return l('ai.activity.listFailed')
      if (status === 'done') return l(d ? 'ai.activity.listDoneDetail' : 'ai.activity.listDone')
      return l(d ? 'ai.activity.listingDetail' : 'ai.activity.listing')
    case 'thinking':
      return l(status === 'done' ? 'ai.activity.thought' : 'ai.activity.thinking')
    case 'tool':
      if (status === 'error') return l('ai.activity.toolFailed')
      if (status === 'done') return l(d ? 'ai.activity.toolDoneDetail' : 'ai.activity.toolDone')
      return l(d ? 'ai.activity.usingToolDetail' : 'ai.activity.usingTool')
  }
}

interface ActivityEntry {
  id: string
  kind: AnalysisActivityKind
  status: AnalysisActivityItem['status']
  detail?: string
}

export function createActivityTracker(options: ActivityTrackerOptions): ActivityTracker {
  const { basePath, onEdge } = options
  const language = options.language ?? getMainLocale()
  /** Buffer ordenado viejo -> nuevo; nunca supera MAX_ACTIVITY_ITEMS. */
  const entries: ActivityEntry[] = []
  /**
   * Ids de thinking ya vistos (edge solo la primera vez). Vive fuera del
   * buffer: un bloque de thinking evictado no debe volver a ser edge si
   * siguen llegando deltas suyos.
   */
  const seenThinking = new Set<string>()

  const clean = (detail?: string): string | undefined => {
    if (detail === undefined) return undefined
    const cleaned = sanitizeDetail(detail, basePath)
    return cleaned.length > 0 ? cleaned : undefined
  }

  const find = (id: string): ActivityEntry | undefined => entries.find((e) => e.id === id)

  const append = (entry: ActivityEntry): void => {
    entries.push(entry)
    if (entries.length > MAX_ACTIVITY_ITEMS) entries.shift()
  }

  /**
   * Un tramo de razonamiento termina cuando pasa OTRA cosa (tool call nueva
   * o primer texto de respuesta): se cierra la fila "Pensando…" viva, si
   * hay. No es edge por sí mismo — el cambio viaja con el evento que lo
   * provocó.
   */
  const closeOpenThinking = (): void => {
    for (const entry of entries) {
      if (entry.kind === 'thinking' && entry.status === 'running') entry.status = 'done'
    }
  }

  return {
    begin(id, kind, detail): void {
      closeOpenThinking()
      const cleaned = clean(detail)
      const existing = find(id)
      if (existing) {
        existing.kind = kind
        existing.status = 'running'
        if (cleaned !== undefined) existing.detail = cleaned
      } else {
        append({ id, kind, status: 'running', detail: cleaned })
      }
      onEdge()
    },
    complete(id, detail): void {
      const existing = find(id)
      if (!existing) return
      existing.status = 'done'
      const cleaned = clean(detail)
      if (cleaned !== undefined) existing.detail = cleaned
      onEdge()
    },
    fail(id): void {
      const existing = find(id)
      if (!existing) return
      existing.status = 'error'
      onEdge()
    },
    thinking(id): void {
      if (seenThinking.has(id)) return
      seenThinking.add(id)
      const running = entries.find((e) => e.kind === 'thinking' && e.status === 'running')
      if (running) {
        // Ya hay un "Pensando…" visible: un bloque nuevo de razonamiento lo
        // reutiliza (adoptando el id nuevo) en vez de apilar filas idénticas.
        running.id = id
        return
      }
      append({ id, kind: 'thinking', status: 'running' })
      onEdge()
    },
    settleThinking(): void {
      closeOpenThinking()
    },
    buffer(): AnalysisActivityItem[] {
      return entries.map((e) => ({
        id: e.id,
        kind: e.kind,
        label: deriveActivityLabel(e.kind, e.status, e.detail, language),
        status: e.status,
      }))
    },
  }
}
