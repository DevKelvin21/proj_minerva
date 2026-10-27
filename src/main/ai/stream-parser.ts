/**
 * Parser incremental del protocolo de secciones streameable (T13, ver el
 * comentario "Forma exacta de salida" de `./prompts/analyze-pr.ts` por el
 * formato exacto que produce el modelo). Puro: sin I/O, sin `fetch`, sin
 * temporizadores — solo recibe texto y expone estado derivado. Quien hace de
 * verdad el streaming (`./providers/opencode-service.ts`,
 * `./providers/claude-code-service.ts`, `./providers/codex-service.ts`) le
 * va empujando los deltas de texto con `push()`; `./mock-service.ts` lo
 * reutiliza también, alimentándolo con el texto reconstruido de sus fixtures
 * estáticas (`stringifySections`, más abajo) para simular streaming real sin
 * ningún proveedor configurado ni costo.
 *
 * Protocolo (resumen; el ejemplo completo vive en el prompt):
 * - Cada marcador va SOLO en su línea y empieza con `@@@`.
 * - `@@@SECTION kind=<summary|setup|architecture|endpoint|schema|cloud>` abre
 *   una sección nueva (cierra la anterior, si había una abierta). Todo texto
 *   hasta el próximo marcador es markdown de esa sección.
 * - `@@@MERMAID` / `@@@END_MERMAID` delimitan el Mermaid de la sección
 *   ACTUALMENTE abierta. Mientras el bloque no cerró, su contenido no es
 *   observable desde `snapshot()` bajo ninguna forma: evita que el renderer
 *   intente montar un diagrama a medio escribir (ver `DraftDidacticSection`
 *   en `../../shared/events.ts`). En `architecture`/`schema` hay a lo sumo UN
 *   bloque; en `cloud` puede haber hasta DOS (big picture + zoom al cambio),
 *   acumulados en `mermaids[]` en orden de cierre.
 * - `@@@SNIPPET label=... language=...` / `@@@END_SNIPPET` delimitan un
 *   snippet de una sección `endpoint` o `setup`; mismo criterio que el Mermaid.
 *
 * Tolerancia (nunca lanza durante el streaming; solo `finalize()` puede
 * lanzar, y solo si NINGUNA sección sobrevive):
 * - Texto antes de la primera sección: se ignora.
 * - Un marcador desconocido (línea que empieza con `@@@` pero no matchea
 *   ningún patrón reconocido): se trata como texto normal de lo que esté
 *   abierto en ese momento (markdown / mermaid / snippet, según corresponda).
 * - `kind` que no es uno de los seis válidos: la sección se sigue
 *   parseando igual (para no desincronizar el resto del stream con el resto
 *   de marcadores) pero se descarta por completo al construir cualquier
 *   snapshot o el resultado final.
 * - Un `@@@SECTION` que llega con un mermaid/snippet todavía sin cerrar:
 *   el bloque parcial se descarta (nunca se cuela a medio cerrar).
 */
import type { DidacticSection, DidacticSnippet, WalkthroughFileRef } from '../../shared/types'
import type { DraftDidacticSection } from '../../shared/events'
import {
  buildCohorts,
  mapLayer,
  mapRawSection,
  mapSnippet,
  parseFileRefs,
  type RawWalkthroughLayer,
} from './section-mapper'
import { mt } from '../i18n'

const KNOWN_KINDS = [
  'summary',
  'walkthrough',
  'setup',
  'architecture',
  'endpoint',
  'schema',
  'cloud',
] as const
type KnownKind = (typeof KNOWN_KINDS)[number]

function isKnownKind(kind: string): kind is KnownKind {
  return (KNOWN_KINDS as readonly string[]).includes(kind)
}

interface SectionAcc {
  kind: string
  markdown: string
  /** Presente solo si ya cerró un bloque `@@@MERMAID`/`@@@END_MERMAID` para esta sección. */
  mermaid?: string
  /** Solo para `kind: 'cloud'`: cada bloque `@@@MERMAID` ya cerrado, en orden de aparición (hasta 2). */
  mermaids: string[]
  snippets: DidacticSnippet[]
  /**
   * Solo para `kind: 'walkthrough'`: una entrada por `@@@LAYER` recibido, en
   * orden. Mientras hay al menos una, el markdown y el mermaid de la sección
   * van a la ÚLTIMA capa, no a la sección (su `markdown` es solo la intro
   * previa a la primera capa).
   */
  layers: RawWalkthroughLayer[]
}

type Mode = 'idle' | 'section' | 'mermaid' | 'snippet'

const SECTION_RE = /^@@@SECTION\s+kind=(\S+)\s*$/
const LAYER_RE = /^@@@LAYER(?:\s+(.*))?$/
const MERMAID_START_RE = /^@@@MERMAID\s*$/
const MERMAID_END_RE = /^@@@END_MERMAID\s*$/
const SNIPPET_START_RE = /^@@@SNIPPET(?:\s+(.*))?$/
const SNIPPET_END_RE = /^@@@END_SNIPPET\s*$/
const ATTR_RE = /(\w+)=(?:"([^"]*)"|(\S+))/g

function parseAttrs(raw: string | undefined): Record<string, string> {
  const attrs: Record<string, string> = {}
  if (!raw) return attrs
  for (const match of raw.matchAll(ATTR_RE)) {
    attrs[match[1]] = match[2] ?? match[3] ?? ''
  }
  return attrs
}

/** Capas que pasan la validación de `mapLayer` (título + al menos un archivo), con su cohorte. */
function validLayers(layers: readonly RawWalkthroughLayer[]): NonNullable<ReturnType<typeof mapLayer>>[] {
  return layers
    .map(mapLayer)
    .filter((layer): layer is NonNullable<ReturnType<typeof mapLayer>> => layer !== null)
}

function toDraft(acc: SectionAcc, streaming: boolean): DraftDidacticSection | null {
  if (!isKnownKind(acc.kind)) return null
  const streamingFlag = streaming ? { streaming: true as const } : {}

  if (acc.kind === 'summary') {
    return { kind: 'summary', markdown: acc.markdown, ...streamingFlag }
  }
  if (acc.kind === 'walkthrough') {
    return {
      kind: 'walkthrough',
      markdown: acc.markdown,
      cohorts: buildCohorts(validLayers(acc.layers)),
      ...streamingFlag,
    }
  }
  if (acc.kind === 'architecture' || acc.kind === 'schema') {
    return {
      kind: acc.kind,
      markdown: acc.markdown,
      ...streamingFlag,
      ...(acc.mermaid !== undefined ? { mermaid: acc.mermaid } : {}),
    }
  }
  if (acc.kind === 'cloud') {
    return {
      kind: 'cloud',
      markdown: acc.markdown,
      mermaids: acc.mermaids,
      ...streamingFlag,
    }
  }
  // endpoint / setup
  return {
    kind: acc.kind,
    markdown: acc.markdown,
    snippets: acc.snippets,
    ...streamingFlag,
  }
}

export class StreamSectionParser {
  private buffer = ''
  private closedSections: SectionAcc[] = []
  private current: SectionAcc | null = null
  private mode: Mode = 'idle'
  private mermaidBuf = ''
  private snippetBuf = ''
  private snippetMeta: { label: string; language: string } | null = null

  /** Alimenta un delta de texto crudo del modelo. Puede cortar en cualquier punto, incluso a mitad de un marcador. */
  push(textDelta: string): void {
    this.buffer += textDelta
    const lines = this.buffer.split('\n')
    // El último elemento es la línea aún no terminada en `\n` (o '' si el
    // buffer terminaba justo en un salto de línea); se guarda para el
    // próximo `push`/`finalize`, nunca se procesa antes de tiempo.
    this.buffer = lines.pop() ?? ''
    for (const line of lines) {
      this.processLine(line)
    }
  }

  /** Snapshot navegable en cualquier momento del streaming. Nunca lanza. */
  snapshot(): DraftDidacticSection[] {
    const drafts: DraftDidacticSection[] = []
    for (const acc of this.closedSections) {
      const draft = toDraft(acc, false)
      if (draft) drafts.push(draft)
    }
    if (this.current) {
      const draft = toDraft(this.current, true)
      if (draft) drafts.push(draft)
    }
    return drafts
  }

  /**
   * Cierra el stream: procesa cualquier resto en buffer (la última línea,
   * que puede no haber terminado en `\n` si el stream se acabó ahí), valida
   * cada sección con la misma regla que usaba el pipeline JSON anterior
   * (`mapRawSection`, `./section-mapper.ts`) y devuelve `DidacticSection[]`.
   * Lanza si ninguna sección sobrevive (un análisis vacío no es un resultado
   * útil para el usuario).
   */
  finalize(log: (message: string) => void = (m) => console.warn(m)): DidacticSection[] {
    if (this.buffer.length > 0) {
      const rest = this.buffer
      this.buffer = ''
      this.processLine(rest)
    }
    this.closeCurrentSection()

    const sections: DidacticSection[] = []

    this.closedSections.forEach((acc, index) => {
      if (!isKnownKind(acc.kind)) {
        log('[stream-parser] sección ' + index + ' descartada (kind desconocido: ' + acc.kind + ')')
        return
      }
      const mapped = mapRawSection({
        kind: acc.kind,
        markdown: acc.markdown,
        mermaid: acc.mermaid,
        mermaids: acc.mermaids,
        snippets: acc.snippets,
        layers: acc.layers,
      })
      if (mapped) {
        sections.push(mapped)
      } else {
        log('[stream-parser] sección ' + index + ' (' + acc.kind + ') descartada por formato inválido')
      }
    })

    if (sections.length === 0) {
      throw new Error(mt('ai.errors.noValidSection'))
    }

    return sections
  }

  private processLine(line: string): void {
    const clean = line.endsWith('\r') ? line.slice(0, -1) : line

    if (clean.startsWith('@@@')) {
      if (SECTION_RE.test(clean)) {
        const kind = SECTION_RE.exec(clean)![1]
        this.discardOpenBlock()
        this.closeCurrentSection()
        this.current = { kind, markdown: '', snippets: [], mermaids: [], layers: [] }
        this.mode = 'section'
        return
      }
      if (LAYER_RE.test(clean)) {
        // Solo tiene sentido dentro de un `walkthrough`; en cualquier otra
        // sección (o sin sección) se ignora la línea entera en vez de
        // colarla como texto, porque es un marcador y no contenido.
        if (this.current && this.current.kind === 'walkthrough') {
          const attrs = parseAttrs(LAYER_RE.exec(clean)![1])
          this.discardOpenBlock()
          this.current.layers.push({
            cohort: attrs.cohort ?? '',
            title: attrs.title ?? '',
            files: parseFileRefs(attrs.files ?? ''),
            markdown: '',
          })
          this.mode = 'section'
        }
        return
      }
      if (MERMAID_START_RE.test(clean)) {
        if (this.current) {
          this.mode = 'mermaid'
          this.mermaidBuf = ''
        }
        return
      }
      if (MERMAID_END_RE.test(clean)) {
        if (this.mode === 'mermaid' && this.current) {
          // A diferencia del snippet (abajo), se conserva el `\n` final que
          // deja la última línea acumulada: los diagramas Mermaid de las
          // fixtures (y el DSL típico que produce un modelo) suelen incluir
          // ese salto de línea de cierre, y `mermaid.render()` lo tolera sin
          // problema.
          const lastLayer = this.current.layers[this.current.layers.length - 1]
          if (this.current.kind === 'cloud') {
            // Hasta DOS bloques por sección, acumulados en orden de cierre.
            this.current.mermaids.push(this.mermaidBuf)
          } else if (this.current.kind === 'walkthrough' && lastLayer) {
            // El diagrama pertenece a la capa abierta, no a la sección.
            lastLayer.mermaid = this.mermaidBuf
          } else {
            this.current.mermaid = this.mermaidBuf
          }
        }
        this.mermaidBuf = ''
        this.mode = this.current ? 'section' : 'idle'
        return
      }
      if (SNIPPET_START_RE.test(clean)) {
        if (this.current) {
          const attrs = parseAttrs(SNIPPET_START_RE.exec(clean)![1])
          this.snippetMeta = { label: attrs.label ?? '', language: attrs.language ?? '' }
          this.snippetBuf = ''
          this.mode = 'snippet'
        }
        return
      }
      if (SNIPPET_END_RE.test(clean)) {
        if (this.mode === 'snippet' && this.current && this.snippetMeta) {
          const mapped = mapSnippet({
            label: this.snippetMeta.label,
            language: this.snippetMeta.language,
            code: this.snippetBuf.replace(/\n$/, ''),
          })
          if (mapped) this.current.snippets.push(mapped)
        }
        this.snippetMeta = null
        this.snippetBuf = ''
        this.mode = this.current ? 'section' : 'idle'
        return
      }
      // Marcador desconocido (empieza con `@@@` pero no matchea ningún
      // patrón de arriba): cae al tratamiento como texto normal de abajo.
    }

    this.appendContentLine(clean)
  }

  private appendContentLine(line: string): void {
    if (this.mode === 'mermaid') {
      this.mermaidBuf += line + '\n'
      return
    }
    if (this.mode === 'snippet') {
      this.snippetBuf += line + '\n'
      return
    }
    if (this.mode === 'section' && this.current) {
      const lastLayer = this.current.layers[this.current.layers.length - 1]
      if (this.current.kind === 'walkthrough' && lastLayer) {
        lastLayer.markdown += (lastLayer.markdown.length > 0 ? '\n' : '') + line
        return
      }
      this.current.markdown += (this.current.markdown.length > 0 ? '\n' : '') + line
      return
    }
    // mode === 'idle': texto huérfano antes de la primera sección, se ignora.
  }

  /** Descarta un mermaid/snippet sin cerrar antes de abrir la próxima sección: nunca se cuela a medio cerrar. */
  private discardOpenBlock(): void {
    this.mermaidBuf = ''
    this.snippetBuf = ''
    this.snippetMeta = null
  }

  private closeCurrentSection(): void {
    if (this.current) {
      this.closedSections.push(this.current)
      this.current = null
    }
    this.mode = 'idle'
  }
}

/**
 * Inverso de este protocolo: serializa un `DidacticSection[]` ya armado (p.
 * ej. una fixture estática) de vuelta al texto tagged por líneas que
 * produciría el modelo. La usa `./mock-service.ts` para simular streaming
 * real sobre datos fijos (divide este texto en trozos y los alimenta a un
 * `StreamSectionParser`), lo que además sirve de test de round-trip: el
 * resultado de parsear este texto con `finalize()` debe ser idéntico a las
 * secciones originales.
 */
export function stringifySections(sections: DidacticSection[]): string {
  return sections.map(sectionToText).join('')
}

/** Serializa los archivos de una capa al formato del atributo `files` (inverso de `parseFileRefs`). */
function fileRefsToAttr(files: readonly WalkthroughFileRef[]): string {
  return files
    .map((file) =>
      file.ranges.length === 0
        ? file.path
        : file.path + ':' + file.ranges.map((r) => (r.start === r.end ? String(r.start) : r.start + '-' + r.end)).join(','),
    )
    .join(';')
}

/** Valor seguro para un atributo entre comillas: sin comillas dobles ni saltos de línea. */
function attrValue(value: string): string {
  return value.replace(/["\r\n]/g, ' ').trim()
}

function sectionToText(section: DidacticSection): string {
  // El markdown de un walkthrough es una intro OPCIONAL: vacío ⇒ sin línea
  // en blanco, para que el round-trip devuelva '' y no '\n'.
  const intro = section.markdown.trimEnd()
  let out = '@@@SECTION kind=' + section.kind + '\n' + (intro.length > 0 ? intro + '\n' : '')

  if (section.kind === 'walkthrough') {
    for (const cohort of section.cohorts) {
      for (const layer of cohort.layers) {
        out +=
          '@@@LAYER cohort="' +
          attrValue(cohort.title) +
          '" title="' +
          attrValue(layer.title) +
          '" files="' +
          fileRefsToAttr(layer.files) +
          '"\n'
        if (layer.markdown.trimEnd().length > 0) out += layer.markdown.trimEnd() + '\n'
        if (layer.mermaid) out += '@@@MERMAID\n' + layer.mermaid.trimEnd() + '\n@@@END_MERMAID\n'
      }
    }
  }

  if (section.kind === 'architecture' || section.kind === 'schema') {
    out += '@@@MERMAID\n' + section.mermaid.trimEnd() + '\n@@@END_MERMAID\n'
  }

  if (section.kind === 'cloud') {
    for (const mermaid of section.mermaids) {
      out += '@@@MERMAID\n' + mermaid.trimEnd() + '\n@@@END_MERMAID\n'
    }
  }

  if (section.kind === 'endpoint' || section.kind === 'setup') {
    for (const snippet of section.snippets) {
      out +=
        '@@@SNIPPET label=' +
        snippet.label +
        ' language=' +
        snippet.language +
        '\n' +
        snippet.code.trimEnd() +
        '\n@@@END_SNIPPET\n'
    }
  }

  return out
}
