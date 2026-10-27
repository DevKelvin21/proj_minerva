/**
 * Valida y mapea la forma cruda de una sección (ya trozeada, ya sea desde el
 * parser incremental de streaming — `./stream-parser.ts`, T13 — o desde
 * cualquier otra fuente) a `DidacticSection` (`src/shared/types.ts`).
 *
 * Hasta T13 este módulo también validaba la respuesta COMPLETA como un único
 * JSON (`mapSections`, `{ sections: [...] }`); ese pipeline quedó obsoleto al
 * cambiar el protocolo del modelo de JSON a texto tagged por líneas (ver
 * `./prompts/analyze-pr.ts` y `./stream-parser.ts`), así que se eliminó junto
 * con `./json-extract.ts` (que solo servía para extraer ese JSON de la
 * respuesta). `mapRawSection`/`mapSnippet` sí se conservan y se reutilizan
 * desde `StreamSectionParser.finalize()` — son la fuente única de verdad de
 * "qué es una sección/snippet válido", sin importar de dónde venga la forma
 * cruda a validar.
 *
 * El modelo es una fuente no confiable de *estructura*, no solo de contenido:
 * puede omitir campos, mandar un `kind` que no existe, o un tipo de dato
 * distinto al esperado. Cada sección se valida de forma independiente; una
 * sección malformada se descarta en vez de tirar abajo todo el análisis.
 */
import type {
  DidacticSection,
  DidacticSnippet,
  WalkthroughCohort,
  WalkthroughFileRef,
  WalkthroughLayer,
  WalkthroughLineRange,
} from '../../shared/types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/** `12-40,55` style suffix of a `files` entry (see `parseFileRefs`). */
const RANGES_RE = /^\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/

/** Cap so a runaway model cannot anchor a layer to thousands of ranges. */
const MAX_RANGES_PER_FILE = 50

function parseRanges(raw: string): WalkthroughLineRange[] {
  const ranges: WalkthroughLineRange[] = []
  for (const part of raw.split(',')) {
    const [a, b] = part.split('-')
    const start = Number.parseInt(a, 10)
    const end = b === undefined ? start : Number.parseInt(b, 10)
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 1 || end < 1) continue
    ranges.push(start <= end ? { start, end } : { start: end, end: start })
    if (ranges.length >= MAX_RANGES_PER_FILE) break
  }
  return ranges
}

/**
 * Parses the `files` attribute of a `@@@LAYER` marker: entries separated by
 * `;`, each a path optionally followed by `:` and comma-separated line ranges
 * (`src/a.ts:12-40,55;src/b.ts`). A path without ranges means the whole file.
 * Tolerant: bad ranges are dropped, an entry without a path is skipped, and a
 * path repeated in the same layer merges its ranges. Exported for the stream
 * parser (drafts need the same shape) and for tests.
 */
export function parseFileRefs(raw: string): WalkthroughFileRef[] {
  const byPath = new Map<string, WalkthroughLineRange[]>()
  for (const entry of raw.split(';')) {
    const trimmed = entry.trim()
    if (trimmed.length === 0) continue
    const colon = trimmed.lastIndexOf(':')
    let path = trimmed
    let ranges: WalkthroughLineRange[] = []
    if (colon > 0 && RANGES_RE.test(trimmed.slice(colon + 1))) {
      path = trimmed.slice(0, colon).trim()
      ranges = parseRanges(trimmed.slice(colon + 1))
    }
    if (path.length === 0) continue
    const existing = byPath.get(path)
    if (existing) existing.push(...ranges)
    else byPath.set(path, ranges)
  }
  return [...byPath.entries()].map(([path, ranges]) => ({ path, ranges }))
}

/** Raw layer as the stream parser accumulates it (`cohort` is the grouping key). */
export interface RawWalkthroughLayer {
  cohort: string
  title: string
  files: WalkthroughFileRef[]
  markdown: string
  mermaid?: string
}

/**
 * A layer survives when it has a title and at least one file to anchor to:
 * without files the Files tab could not show it, and a title is what the
 * navigator lists. An empty summary is tolerated (the diff still speaks).
 */
export function mapLayer(raw: unknown): (WalkthroughLayer & { cohort: string }) | null {
  if (!isRecord(raw)) return null
  if (!isNonEmptyString(raw.title)) return null
  if (!Array.isArray(raw.files)) return null
  const files = raw.files.filter(
    (f): f is WalkthroughFileRef =>
      isRecord(f) && isNonEmptyString(f.path) && Array.isArray(f.ranges),
  )
  if (files.length === 0) return null
  const cohort = typeof raw.cohort === 'string' ? raw.cohort.trim() : ''
  const markdown = typeof raw.markdown === 'string' ? raw.markdown : ''
  const layer: WalkthroughLayer & { cohort: string } = { cohort, title: raw.title.trim(), markdown, files }
  if (isNonEmptyString(raw.mermaid)) layer.mermaid = raw.mermaid
  return layer
}

/**
 * Groups flat layers into cohorts by their `cohort` label, in order of first
 * appearance; layers keep their relative order inside each cohort. A missing
 * label lands in an untitled cohort (the renderer gives it a fallback name).
 */
export function buildCohorts(layers: readonly (WalkthroughLayer & { cohort: string })[]): WalkthroughCohort[] {
  const cohorts: WalkthroughCohort[] = []
  const byTitle = new Map<string, WalkthroughCohort>()
  for (const { cohort, ...layer } of layers) {
    let group = byTitle.get(cohort)
    if (!group) {
      group = { title: cohort, layers: [] }
      byTitle.set(cohort, group)
      cohorts.push(group)
    }
    group.layers.push(layer)
  }
  return cohorts
}

/** Exportado: `StreamSectionParser` lo reutiliza para validar cada snippet al cerrar su `@@@END_SNIPPET`. */
export function mapSnippet(raw: unknown): DidacticSnippet | null {
  if (!isRecord(raw)) return null
  if (!isNonEmptyString(raw.label)) return null
  if (
    raw.language !== 'curl' &&
    raw.language !== 'http' &&
    raw.language !== 'bash' &&
    raw.language !== 'env'
  )
    return null
  if (!isNonEmptyString(raw.code)) return null
  return { label: raw.label, language: raw.language, code: raw.code }
}

/** Mapea una sección cruda; `null` si no matchea ninguna forma válida de `DidacticSection`. */
export function mapRawSection(raw: unknown): DidacticSection | null {
  if (!isRecord(raw)) return null

  // The walkthrough is the one kind whose own markdown is optional (an
  // intro): its content lives in the layers.
  if (raw.kind === 'walkthrough') {
    if (!Array.isArray(raw.layers)) return null
    const layers = raw.layers
      .map(mapLayer)
      .filter((layer): layer is NonNullable<ReturnType<typeof mapLayer>> => layer !== null)
    if (layers.length === 0) return null
    const markdown = typeof raw.markdown === 'string' ? raw.markdown : ''
    return { kind: 'walkthrough', markdown, cohorts: buildCohorts(layers) }
  }

  if (!isNonEmptyString(raw.markdown)) return null

  switch (raw.kind) {
    case 'summary':
      return { kind: 'summary', markdown: raw.markdown }

    case 'architecture':
      if (!isNonEmptyString(raw.mermaid)) return null
      return { kind: 'architecture', markdown: raw.markdown, mermaid: raw.mermaid }

    case 'schema':
      if (!isNonEmptyString(raw.mermaid)) return null
      return { kind: 'schema', markdown: raw.markdown, mermaid: raw.mermaid }

    case 'cloud': {
      // A diferencia de architecture/schema, los diagramas son OPCIONALES:
      // 0, 1 o 2 bloques son todos válidos — nunca se descarta la sección
      // solo por falta de mermaid (el markdown solo ya es un resultado útil).
      const mermaids = Array.isArray(raw.mermaids)
        ? raw.mermaids.filter((m): m is string => isNonEmptyString(m))
        : []
      return { kind: 'cloud', markdown: raw.markdown, mermaids }
    }

    case 'endpoint': {
      if (!Array.isArray(raw.snippets)) return null
      const snippets = raw.snippets
        .map(mapSnippet)
        .filter((s): s is DidacticSnippet => s !== null)
      return { kind: 'endpoint', markdown: raw.markdown, snippets }
    }

    case 'setup': {
      if (!Array.isArray(raw.snippets)) return null
      const snippets = raw.snippets
        .map(mapSnippet)
        .filter((s): s is DidacticSnippet => s !== null)
      return { kind: 'setup', markdown: raw.markdown, snippets }
    }

    default:
      return null
  }
}

