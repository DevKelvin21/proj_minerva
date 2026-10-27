/**
 * Implementación mock de `AiService`. No llama a ningún LLM: sirve fixtures
 * fijas (`./fixtures.ts`), pero SÍ simula streaming real (T13) en vez de
 * resolver todo de una vez, para poder verificar el panel didáctico en vivo
 * (texto fluyendo, diagramas apareciendo al cerrar su bloque) sin necesitar
 * ningún proveedor de IA configurado ni pagar una llamada real.
 *
 * Cómo simula el streaming: serializa el `DidacticSection[]` final de la
 * fixture de vuelta al protocolo de texto tagueado que produciría el modelo
 * (`stringifySections`, inverso de `../stream-parser.ts`), lo trocea en
 * `STREAM_CHUNKS` pedazos y los va empujando a un `StreamSectionParser` real
 * (el MISMO que usan los servicios reales — `providers/opencode-service.ts`,
 * `providers/claude-code-service.ts`, `providers/codex-service.ts`) con
 * `STREAM_CHUNK_DELAY_MS` entre cada uno, llamando a `onProgress` con cada
 * snapshot. Esto no es solo un atajo: ejercita el parser incremental de
 * punta a punta con datos reales, así que un mock funcionando es evidencia
 * de que el parser funciona.
 *
 * Reutiliza `prFixtures` de `../scm/github/fixtures` (mismo universo mock
 * "shopwave") para poder armar un resumen genérico con datos reales del PR
 * (título, contadores, labels) cuando no hay sección enriquecida para él.
 *
 * F13: antes de los chunks de texto, el mock emite un PRELUDIO GUIONADO de
 * actividad del harness (fase 'exploring' + mini-log construido con el
 * `createActivityTracker` REAL — mismo camino de código que los proveedores
 * agénticos), y los chunks de texto salen con fase 'writing'. Esto cambia el
 * contrato T60 ("el mock no emite `phase`"): desde F13 SÍ la emite, porque
 * es LA vía para que las suites e2e con `MINERVA_MOCK_AI=1` ejerciten el
 * mini-log y el skeleton "Explorando el repositorio…" de forma determinista.
 *
 * i18n: the fixtures exist in English (`./fixtures.ts`) and Spanish
 * (`./fixtures.es.ts`); the mock picks the one of the requested analysis
 * language, like a real model following the prompt's output-language rule.
 */
import type { IpcRequest } from '../../shared/ipc'
import type { AppLocale } from '../../shared/locale'
import { prKey, sameRepo } from '../../shared/scm'
import type { DidacticSection } from '../../shared/types'
import { prFixtures } from '../scm/github/fixtures'
import * as fixturesEn from './fixtures'
import * as fixturesEs from './fixtures.es'
import { getMainLocale, mt } from '../i18n'
import type { AiService, AnalyzePullRequestOptions, AnalyzeResult } from './service'
import type { PrContextSource } from './pr-context'
import { StreamSectionParser, stringifySections } from './stream-parser'
import { createActivityTracker, type ActivityTracker } from './activity-tracker'

/** Cantidad de trozos en los que se divide el texto serializado de una fixture. */
const STREAM_CHUNKS = 6
/** Delay entre trozos: alcanza para que el streaming sea visible sin sentirse lento. */
const STREAM_CHUNK_DELAY_MS = 150

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Trocea `text` en `~chunks` pedazos de tamaño parejo, cortando en cualquier punto (a propósito: ejercita la tolerancia del parser a marcadores partidos). */
function chunkText(text: string, chunks: number): string[] {
  if (text.length === 0) return ['']
  const size = Math.max(1, Math.ceil(text.length / chunks))
  const parts: string[] = []
  for (let i = 0; i < text.length; i += size) {
    parts.push(text.slice(i, i + size))
  }
  return parts
}

/**
 * Preludio guionado de actividad del harness (F13): simula la fase
 * 'exploring' de un proveedor agéntico con una secuencia fija de tool calls
 * ficticias, pasada por el `createActivityTracker` REAL — cada transición
 * emite `onProgress` vía `onEdge`, exactamente como en los proveedores. Los
 * delays entre pasos hacen visible el "running → done" de cada fila, y la
 * secuencia ejercita los tres verbos + "Pensando…" para que las suites e2e
 * puedan assertear labels concretos.
 */
async function streamActivityPrelude(
  onProgress: NonNullable<AnalyzePullRequestOptions['onProgress']>,
  parser: StreamSectionParser,
  language: AppLocale,
): Promise<ActivityTracker> {
  const activity = createActivityTracker({
    language,
    onEdge: () => {
      onProgress(parser.snapshot(), {
        done: false,
        phase: 'exploring',
        activity: activity.buffer(),
      })
    },
  })

  activity.begin('mock-list', 'list')
  await delay(STREAM_CHUNK_DELAY_MS)
  activity.complete('mock-list')
  activity.begin('mock-read', 'read', 'src/api/routes.ts')
  await delay(STREAM_CHUNK_DELAY_MS)
  activity.complete('mock-read', 'src/api/routes.ts')
  activity.begin('mock-grep', 'search', 'router')
  await delay(STREAM_CHUNK_DELAY_MS)
  activity.complete('mock-grep', 'router')
  activity.thinking('mock-thinking')
  await delay(STREAM_CHUNK_DELAY_MS)

  return activity
}

/**
 * Simula streaming real sobre una fixture ya armada: la serializa, la
 * trocea y la vuelve a parsear con delays, publicando snapshots por
 * `onProgress`. El resultado final sale de `StreamSectionParser.finalize()`
 * (no de la fixture original directamente) para que el mock ejercite
 * exactamente el mismo camino de validación que el pipeline real.
 */
async function streamFixture(
  sections: DidacticSection[],
  language: AppLocale,
  onProgress?: AnalyzePullRequestOptions['onProgress'],
): Promise<DidacticSection[]> {
  const parser = new StreamSectionParser()
  const text = stringifySections(sections)

  if (!onProgress) {
    parser.push(text)
    return parser.finalize()
  }

  // Fase 'exploring' guionada (F13) antes del primer chunk de texto — mismo
  // orden de fases que un proveedor agéntico real.
  const activity = await streamActivityPrelude(onProgress, parser, language)
  activity.settleThinking()

  for (const chunk of chunkText(text, STREAM_CHUNKS)) {
    parser.push(chunk)
    onProgress(parser.snapshot(), { done: false, phase: 'writing', activity: activity.buffer() })
    await delay(STREAM_CHUNK_DELAY_MS)
  }

  const final = parser.finalize()
  // Terminal SIN `phase` ni `activity` (misma convención que los proveedores
  // reales): a esta altura `sections` es la fuente de verdad y el mini-log
  // es efímero por diseño.
  onProgress(final, { done: true })
  return final
}

/**
 * Summary for a PR the shopwave fixtures don't know (e.g. an Azure DevOps
 * mock PR), built from what the SCM layer actually served: detail, files and
 * the snapshot on disk. So `MINERVA_MOCK_AI=1` still runs the real context
 * pipeline (provider -> patches -> snapshot-store) end to end.
 */
const CONTEXT_SUMMARY_TEXT: Record<
  AppLocale,
  { heading: string; intro: string; files: string; snapshotReady: string; noSnapshot: string }
> = {
  en: {
    heading: 'Summary',
    intro: 'Mock analysis built from the real SCM pipeline: ',
    files: ' changed file(s), ',
    snapshotReady: 'repository snapshot ready',
    noSnapshot: 'no repository snapshot',
  },
  es: {
    heading: 'Resumen',
    intro: 'Análisis mock armado con el pipeline real de SCM: ',
    files: ' archivo(s) cambiado(s), ',
    snapshotReady: 'snapshot del repositorio listo',
    noSnapshot: 'sin snapshot del repositorio',
  },
}

function contextSummarySection(
  detail: Awaited<ReturnType<PrContextSource['getDetail']>>,
  files: Awaited<ReturnType<PrContextSource['getFiles']>>,
  snapshotDir: string | null,
  language: AppLocale,
): DidacticSection {
  const text = CONTEXT_SUMMARY_TEXT[language]
  const fileLines = files
    .slice(0, 20)
    .map((file) => '- `' + file.path + '` (' + file.status + ', +' + file.additions + ' / -' + file.deletions + ')')
  return {
    kind: 'summary',
    markdown:
      '## ' +
      text.heading +
      '\n\n**' +
      detail.title +
      '** (' +
      detail.repo.fullName +
      '#' +
      detail.number +
      ')\n\n' +
      text.intro +
      files.length +
      text.files +
      (snapshotDir ? text.snapshotReady : text.noSnapshot) +
      '.\n\n' +
      fileLines.join('\n'),
  }
}

export class MockAiService implements AiService {
  constructor(private readonly context?: PrContextSource) {}

  async analyzePullRequest(
    req: IpcRequest<'ai:analyzePullRequest'>,
    options?: AnalyzePullRequestOptions,
  ): Promise<AnalyzeResult> {
    const language = options?.language ?? getMainLocale()
    const { genericSummarySection, lineAnswerSection, richDidacticSections } =
      language === 'es' ? fixturesEs : fixturesEn
    const prId = prKey(req.repo, req.number)
    const rich = richDidacticSections[prId]
    const fixture = prFixtures.find(
      (f) => sameRepo(f.detail.repo, req.repo) && f.detail.number === req.number,
    )
    // Same head commit the mock SCM reports, so staleness checks line up.
    const headSha = fixture?.detail.headSha ?? ''

    // A reviewer's question about some lines: one canned answer, any PR.
    if (options?.question) {
      const sections = await streamFixture(
        [lineAnswerSection(options.question)],
        language,
        options.onProgress,
      )
      return { prId, headSha, sections, generatedAt: new Date().toISOString() }
    }

    if (rich) {
      const sections = await streamFixture(rich, language, options?.onProgress)
      return { prId, headSha, sections, generatedAt: new Date().toISOString() }
    }

    if (!fixture && this.context) {
      const detail = await this.context.getDetail(req.repo, req.number)
      const files = await this.context.getFiles(req.repo, req.number)
      const snapshotDir = detail.headSha
        ? await this.context.ensureSnapshot(req.repo, detail.headSha)
        : null
      const sections = await streamFixture(
        [contextSummarySection(detail, files, snapshotDir, language)],
        language,
        options?.onProgress,
      )
      return { prId, headSha: detail.headSha, sections, generatedAt: new Date().toISOString() }
    }

    if (!fixture) {
      // Mensaje honesto: el PR existe perfectamente, es ESTE mock el que no
      // lo conoce. Decir "Pull request no encontrado" culpaba al PR cuando el
      // problema era la configuración de IA (ver `./index.ts`).
      throw new Error(mt('ai.mock.unknownPr', { pr: req.repo.fullName + '#' + req.number }))
    }

    const sections = await streamFixture(
      [genericSummarySection(fixture.detail)],
      language,
      options?.onProgress,
    )
    return { prId, headSha, sections, generatedAt: new Date().toISOString() }
  }
}
