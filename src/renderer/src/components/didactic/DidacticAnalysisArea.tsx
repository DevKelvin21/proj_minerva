import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import {
  AlertTriangle,
  BookOpen,
  Building2,
  Cloud,
  Database,
  Globe,
  Languages,
  Layers,
  Loader2,
  RefreshCw,
  Rocket,
  Workflow,
} from 'lucide-react'
import { useDidacticAnalysis } from '../../hooks/use-didactic-analysis'
import { useProviderStatus } from '../../hooks/use-provider-status'
import { useScmSettings } from '../../hooks/use-scm-settings'
import { isAnalysisLanguageMismatch, isAnalysisStale } from '../../lib/staleness'
import { useLocale } from '../../i18n/use-locale'
import { DidacticSectionCard } from './DidacticSectionCard'
import { Markdown } from '../ui/Markdown'
import { MermaidDiagram } from './MermaidDiagram'
import { CodeSnippet } from './CodeSnippet'
import { DidacticPlaceholder } from './DidacticPlaceholder'
import { HarnessActivityLog } from './HarnessActivityLog'
import { NoCliProvidersCard } from './NoCliProvidersCard'
import { ActiveModelHint } from './ActiveModelHint'
import { ExpandableResource } from './ExpandableResource'
import { ResourceViewer, type ViewerResource } from './ResourceViewer'
import type { DidacticSection, RepoRef, WalkthroughCohort } from '../../../../shared/types'
import type { DraftDidacticSection } from '../../../../shared/events'
import { flattenLayers, type LayerRef } from '../../lib/walkthrough'
import {
  availableInsightTabs,
  insightTabOf,
  resolveInsightTab,
  type InsightTab,
} from '../../lib/insight-tabs'

const SECTION_ICON: Record<DidacticSection['kind'], React.JSX.Element> = {
  summary: <BookOpen size={16} />,
  walkthrough: <Layers size={16} />,
  setup: <Rocket size={16} />,
  architecture: <Building2 size={16} />,
  endpoint: <Globe size={16} />,
  schema: <Database size={16} />,
  cloud: <Cloud size={16} />,
}

/**
 * Overview / Architecture / Endpoints / Data. Hidden when the analysis only
 * fills one of them: a single tab is just noise.
 */
function InsightTabStrip({
  tabs,
  active,
  onPick,
}: {
  tabs: readonly InsightTab[]
  active: InsightTab
  onPick: (tab: InsightTab) => void
}): React.JSX.Element | null {
  const { t } = useTranslation()
  if (tabs.length < 2) return null
  return (
    <div
      role="tablist"
      aria-label={t('didactic.tabs.ariaLabel')}
      data-testid="insight-tabs"
      className="flex shrink-0 gap-1 overflow-x-auto border-b border-border"
    >
      {tabs.map((tab) => (
        <button
          key={tab}
          type="button"
          role="tab"
          aria-selected={tab === active}
          onClick={() => onPick(tab)}
          className={`-mb-px whitespace-nowrap border-b-2 px-2.5 py-1.5 text-xs font-medium transition-colors duration-150 ${
            tab === active ? 'border-accent text-text' : 'border-transparent text-muted hover:text-text'
          }`}
        >
          {t(`didactic.tabs.${tab}`)}
        </button>
      ))}
    </div>
  )
}

/** Icon + translated title of a section kind (`didactic.sections.*`). */
function sectionMeta(
  kind: DidacticSection['kind'],
  t: TFunction,
): { title: string; icon: React.JSX.Element } {
  return { title: t(`didactic.sections.${kind}`), icon: SECTION_ICON[kind] }
}

/**
 * Subtítulo fijo por posición para los `mermaids[]` de una sección `cloud`
 * (T77): el 1º diagrama es SIEMPRE el big picture del sistema cloud completo,
 * el 2º el zoom a lo que el PR modifica (contrato de `DidacticSection`/
 * `DraftDidacticSection`, ver `shared/types.ts`/`shared/events.ts`). Un 3º+
 * diagrama no debería llegar nunca (el prompt pide como máximo 2) pero un
 * genérico "Diagrama N" evita que un desvío del modelo deje un diagrama sin
 * rótulo en vez de romper el render.
 */
function cloudDiagramSubtitle(index: number, t: TFunction): string {
  if (index === 0) return t('didactic.cloudDiagram.fullSystem')
  if (index === 1) return t('didactic.cloudDiagram.prImpact')
  return t('didactic.cloudDiagram.numbered', { number: index + 1 })
}

/** Glyph, not text: nothing to translate. */
const STREAMING_CURSOR_GLYPH = '▍'

/** Cursor sutil que marca "esta sección todavía está recibiendo texto" (T13). */
function StreamingCursor(): React.JSX.Element {
  return (
    <span aria-hidden className="inline-block animate-pulse text-sm leading-none text-accent">
      {STREAMING_CURSOR_GLYPH}
    </span>
  )
}

/** Opens a walkthrough layer in the Files tab (main window only; the detached window has no Files tab). */
export type OpenLayerHandler = (ref: LayerRef, firstPath: string | null) => void

/**
 * Body of the `walkthrough` card: cohorts as headings, layers as a numbered
 * list in reading order. With `onOpenLayer` (main window) each layer is a
 * button that jumps to the Files tab in layers mode; without it (detached
 * window) the list is plain text. Same shape for final and draft sections.
 */
function WalkthroughBody({
  cohorts,
  onOpenLayer,
}: {
  cohorts: WalkthroughCohort[]
  onOpenLayer?: OpenLayerHandler
}): React.JSX.Element {
  const { t } = useTranslation()
  const flat = flattenLayers(cohorts)
  let index = 0
  return (
    <div className="flex flex-col gap-2" data-testid="walkthrough-card">
      <p className="text-xs text-muted">{t('didactic.walkthrough.hint')}</p>
      {cohorts.map((cohort, c) => (
        <div key={c} className="flex flex-col gap-1">
          <p className="text-xs font-semibold tracking-wide text-muted uppercase">
            {cohort.title || t('prDetail.layers.defaultCohort')}
          </p>
          <ol className="flex flex-col gap-1">
            {cohort.layers.map((layer, l) => {
              const number = ++index
              const meta = (
                <span className="flex items-center gap-2 text-[11px] text-muted">
                  {t('didactic.walkthrough.fileCount', { count: layer.files.length })}
                  {layer.mermaid && (
                    <span className="flex items-center gap-0.5">
                      <Workflow size={10} aria-hidden />
                      {t('didactic.walkthrough.withDiagram')}
                    </span>
                  )}
                </span>
              )
              const badge = (
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border text-[11px] font-semibold text-muted tabular-nums">
                  {number}
                </span>
              )
              const ref = { cohort: c, layer: l }
              return (
                <li key={l}>
                  {onOpenLayer ? (
                    <button
                      type="button"
                      onClick={() => onOpenLayer(ref, layer.files[0]?.path ?? null)}
                      title={t('didactic.walkthrough.openLayer', { index: number })}
                      data-testid="walkthrough-layer"
                      className="flex w-full items-start gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-border/40"
                    >
                      {badge}
                      <span className="flex min-w-0 flex-col">
                        <span className="text-sm text-text">{layer.title}</span>
                        {meta}
                      </span>
                    </button>
                  ) : (
                    <div className="flex items-start gap-2 px-1.5 py-1" data-testid="walkthrough-layer">
                      {badge}
                      <span className="flex min-w-0 flex-col">
                        <span className="text-sm text-text">{layer.title}</span>
                        {meta}
                      </span>
                    </div>
                  )}
                </li>
              )
            })}
          </ol>
        </div>
      ))}
      {flat.length === 0 && <StreamingCursor />}
    </div>
  )
}

/**
 * Diagramas de una sección `cloud` (T77): a diferencia de `architecture`/
 * `schema` (un `mermaid` único), acá `mermaids` es un array de hasta 2
 * `architecture-beta` — cada uno con su propio subtítulo fijo por posición
 * (`cloudDiagramSubtitle`) y su propio `ExpandableResource`/`MermaidDiagram`.
 * Con el array vacío no renderiza nada (la sección se sostiene solo con el
 * markdown de arriba, sin huecos visuales).
 *
 * Key por ÍNDICE (no por contenido, a diferencia de `architecture`/`schema`):
 * durante el streaming el array crece 0→1→2 append-only — un diagrama ya
 * cerrado nunca cambia de contenido en una posición ya emitida, así que
 * indexar por posición no le causa un remount espurio, y evita uno real si
 * (por lo que sea) el DSL de un diagrama cerrado se repitiera dos veces.
 */
function renderCloudDiagrams(
  mermaids: string[],
  sectionTitle: string,
  onExpand: (resource: ViewerResource) => void,
  t: TFunction,
): React.JSX.Element[] {
  return mermaids.map((mermaid, i) => {
    const subtitle = cloudDiagramSubtitle(i, t)
    return (
      <div key={i} className="flex flex-col gap-1.5">
        <p className="text-xs font-medium text-muted">{subtitle}</p>
        <ExpandableResource
          label={t('didactic.resources.expandDiagram')}
          onExpand={() =>
            onExpand({
              kind: 'mermaid',
              title: t('didactic.resources.diagramTitle', { section: sectionTitle, diagram: subtitle }),
              code: mermaid,
            })
          }
        >
          <MermaidDiagram code={mermaid} />
        </ExpandableResource>
      </div>
    )
  })
}

function renderSection(
  section: DidacticSection,
  key: number,
  onExpand: (resource: ViewerResource) => void,
  t: TFunction,
  onOpenLayer?: OpenLayerHandler,
): React.JSX.Element {
  const meta = sectionMeta(section.kind, t)

  return (
    <DidacticSectionCard
      key={key}
      icon={meta.icon}
      title={meta.title}
      onExpandMarkdown={
        section.kind === 'walkthrough'
          ? undefined
          : () =>
              onExpand({
                kind: 'markdown',
                title: t('didactic.resources.wideViewTitle', { title: meta.title }),
                markdown: section.markdown,
              })
      }
    >
      {section.markdown.trim().length > 0 && <Markdown content={section.markdown} images={false} />}
      {section.kind === 'walkthrough' && (
        <WalkthroughBody cohorts={section.cohorts} onOpenLayer={onOpenLayer} />
      )}
      {(section.kind === 'architecture' || section.kind === 'schema') && (
        <ExpandableResource
          label={t('didactic.resources.expandDiagram')}
          onExpand={() => onExpand({ kind: 'mermaid', title: meta.title, code: section.mermaid })}
        >
          <MermaidDiagram key={section.mermaid} code={section.mermaid} />
        </ExpandableResource>
      )}
      {section.kind === 'cloud' && renderCloudDiagrams(section.mermaids, meta.title, onExpand, t)}
      {(section.kind === 'endpoint' || section.kind === 'setup') &&
        section.snippets.map((snippet, i) => (
          <CodeSnippet
            key={i}
            snippet={snippet}
            onExpand={() => onExpand({ kind: 'snippet', title: snippet.label, snippet })}
          />
        ))}
    </DidacticSectionCard>
  )
}

/**
 * Variante de `renderSection` para un snapshot EN VIVO de streaming (T13):
 * `section` es `DraftDidacticSection` (`../../../../shared/events.ts`), no
 * `DidacticSection` — a diferencia del tipo final, el Mermaid de una
 * `architecture`/`schema` es OPCIONAL: solo se pinta si ya cerró
 * (`section.mermaid` presente). Mientras el bloque `@@@MERMAID` sigue
 * abierto, el campo directamente no existe, así que nunca hay riesgo de
 * montar `MermaidDiagram` con un DSL a medio escribir. La sección todavía
 * abierta (`section.streaming`) muestra el cursor parpadeante. Mismo criterio
 * para `cloud.mermaids` (T77): el array solo contiene los diagramas YA
 * cerrados (ver `DraftDidacticSection` en `shared/events.ts`), así que
 * `renderCloudDiagrams` recibe siempre contenido completo, nunca un DSL a
 * medio escribir.
 */
function renderDraftSection(
  section: DraftDidacticSection,
  key: number,
  onExpand: (resource: ViewerResource) => void,
  t: TFunction,
  onOpenLayer?: OpenLayerHandler,
): React.JSX.Element {
  const meta = sectionMeta(section.kind, t)

  return (
    <DidacticSectionCard
      key={key}
      icon={meta.icon}
      title={meta.title}
      onExpandMarkdown={
        section.kind === 'walkthrough'
          ? undefined
          : () =>
              onExpand({
                kind: 'markdown',
                title: t('didactic.resources.wideViewTitle', { title: meta.title }),
                markdown: section.markdown,
              })
      }
    >
      {section.markdown.trim().length > 0 && <Markdown content={section.markdown} images={false} />}
      {section.kind === 'walkthrough' && (
        <WalkthroughBody cohorts={section.cohorts} onOpenLayer={onOpenLayer} />
      )}
      {section.streaming && <StreamingCursor />}
      {(section.kind === 'architecture' || section.kind === 'schema') && section.mermaid && (
        <ExpandableResource
          label={t('didactic.resources.expandDiagram')}
          onExpand={() => {
            if (section.mermaid)
              onExpand({ kind: 'mermaid', title: meta.title, code: section.mermaid })
          }}
        >
          <MermaidDiagram key={section.mermaid} code={section.mermaid} />
        </ExpandableResource>
      )}
      {section.kind === 'cloud' &&
        renderCloudDiagrams(section.mermaids ?? [], meta.title, onExpand, t)}
      {(section.kind === 'endpoint' || section.kind === 'setup') &&
        section.snippets.map((snippet, i) => (
          <CodeSnippet
            key={i}
            snippet={snippet}
            onExpand={() => onExpand({ kind: 'snippet', title: snippet.label, snippet })}
          />
        ))}
    </DidacticSectionCard>
  )
}

interface DidacticAnalysisAreaProps {
  repo: RepoRef
  number: number
  /**
   * SHA ACTUAL del head del PR (T42, Issue 2), para comparar contra el
   * `analysis.headSha` sellado al generar (`isAnalysisStale`, en
   * `../../lib/staleness.ts`) y avisar si el PR recibió commits nuevos.
   * `DidacticPanel` lo pasa directo desde `selectedPr.headSha` (ya lo tiene
   * del summary); la ventana desacoplada no tiene ese summary, así que lo
   * consigue con el hook `use-pr-head-sha` (fetch único al montar). `undefined`
   * mientras no se sepa aún — la barra simplemente no aparece hasta entonces.
   */
  currentHeadSha?: string
  /**
   * Jump to a walkthrough layer in the Files tab. Only the main window
   * passes it (`DidacticPanel`); the detached window has no Files tab, so its
   * walkthrough card is read-only.
   */
  onOpenLayer?: OpenLayerHandler
}

/**
 * Cuerpo del panel didáctico para un PR concreto. `DidacticPanel` monta esto
 * con `key={selectedPr.id}`: cambiar de PR remonta el componente entero, lo
 * que resetea `useDidacticAnalysis` a su estado inicial de forma natural (el
 * patrón que React recomienda para "resetear todo el estado de una entidad",
 * en vez de un efecto o un ref comparando el PR anterior).
 *
 * T13 (streaming): el orden de precedencia entre estados es, de mayor a
 * menor prioridad: `error` (incluso con contenido parcial viejo de un intento
 * fallido) > `analysis` (resultado final) > `streamingSections` CON contenido
 * (`hasStreamedContent`, al menos una sección con texto) > `checkingCache`/
 * `loading`/fase "exploring" sin secciones todavía (skeleton — mismo bloque,
 * ver T60 abajo) > card "sin CLIs" (T60) > placeholder inicial.
 *
 * T60: los proveedores agénticos (Claude Code/Codex/OpenCode) pueden emitir
 * `streamingSections` VACÍO con `phase: 'exploring'` (actividad de
 * herramientas sobre el snapshot, antes de escribir texto) — eso NO cuenta
 * como "hay contenido que mostrar" (`hasStreamedContent`/`hasResult` lo
 * excluyen a propósito), se resuelve en la misma rama de skeleton que
 * `checkingCache`/`loading`, con el texto "Explorando el repositorio…" en vez
 * de "Analizando PR con IA…". Si TODOS los proveedores reportan
 * `unavailable` (`useProviderStatus`) y la app no está en modo GitHub-mock
 * (`useScmSettings().info.mockScm`), el placeholder final se reemplaza por
 * `NoCliProvidersCard` en vez de `DidacticPlaceholder`.
 *
 * T14: el toolbar (hint del modelo activo + botón "Re-analizar") se muestra
 * junto al contenido en cuanto hay un resultado que mostrar (`analysis` o
 * streaming CON contenido, ver `hasResult`) — no en el header estático del
 * panel (`DidacticPanel`), porque ninguno de los dos tiene sentido antes de
 * que exista un análisis para ESTE PR. El visor de recursos
 * (`ResourceViewer`) es estado LOCAL de este componente (`viewerResource`):
 * cada ventana que lo monta (panel principal, ventana desacoplada) tiene el
 * suyo propio, sin compartir nada.
 *
 * T22: `useDidacticAnalysis` ya no necesita que esta superficie le diga si
 * debe mirar el cache al montar — el hook siempre hace "auto-attach" (ver su
 * comentario de cabecera), así que este componente se comporta igual en el
 * panel acoplado y en la ventana desacoplada sin ninguna prop extra.
 */
export function DidacticAnalysisArea({
  repo,
  number,
  currentHeadSha,
  onOpenLayer,
}: DidacticAnalysisAreaProps): React.JSX.Element {
  const {
    analysis,
    streamingSections,
    phase,
    activity,
    checkingCache,
    loading,
    error,
    analyze,
    reanalyze,
  } = useDidacticAnalysis({ repo, number })
  const { t } = useTranslation()
  const { locale } = useLocale()
  const [viewerResource, setViewerResource] = useState<ViewerResource | null>(null)
  const [pickedTab, setPickedTab] = useState<InsightTab>('overview')
  const providerStatus = useProviderStatus()
  const scmSettings = useScmSettings().info

  // T60: mientras un proveedor agéntico está en fase "exploring" (usando
  // herramientas de solo lectura sobre el snapshot ANTES de escribir texto),
  // `streamingSections` puede ser un array VACÍO (los tres servicios emiten
  // progreso de actividad sin secciones todavía, ver `../../../../main/ai/
  // providers/*-service.ts`) — eso NO es "ya tengo un resultado que mostrar",
  // así que ni `hasResult` ni la rama de render de secciones lo tratan como
  // tal; se resuelve en la rama de "cargando" de abajo con su propio texto.
  const hasStreamedContent = (streamingSections?.length ?? 0) > 0
  const isExploringEmpty = streamingSections !== null && !hasStreamedContent && phase === 'exploring'

  const hasResult = analysis !== null || hasStreamedContent
  // Derivado en render (no estado): reacciona solo cuando `analysis` o
  // `currentHeadSha` cambian, sin efectos que "resetear" (T42, ver
  // comentario de la prop `currentHeadSha` arriba).
  const isStale = isAnalysisStale(analysis, currentHeadSha)
  // Same derive-in-render rule for the language: an analysis written in
  // another language than the UI (e.g. cached before switching) offers a
  // regenerate instead of being served as is.
  const isLanguageMismatch = isAnalysisLanguageMismatch(analysis, locale)

  // T60: card "Necesitás al menos un CLI de IA" en vez del placeholder
  // normal cuando los TRES proveedores reportan `unavailable` y la app NO
  // está en modo SCM-mock (`scmSettings.mockScm` — con mock la demo
  // funciona sin ningún CLI vía `MockAiService`). `providerStatus.statuses`
  // en `null` (todavía sin cargar) o `scmSettings` en `null` deja la card
  // apagada: no hay suficiente información todavía para afirmarlo.
  const allProvidersUnavailable =
    providerStatus.statuses !== null &&
    Object.values(providerStatus.statuses).every((s) => s.status === 'unavailable')
  const showNoCliCard = allProvidersUnavailable && scmSettings !== null && !scmSettings.mockScm

  let body: React.JSX.Element
  if (error) {
    body = (
      <div className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm">
        <p className="mb-2 text-danger">{t('didactic.analysis.failed', { error })}</p>
        <button
          type="button"
          onClick={analyze}
          className="rounded-md border border-danger/40 px-3 py-1.5 text-xs font-medium text-danger transition-colors hover:bg-danger/15"
        >
          {t('common.retry')}
        </button>
      </div>
    )
  } else if (analysis) {
    const tabs = availableInsightTabs(analysis.sections.map((section) => section.kind))
    const tab = resolveInsightTab(pickedTab, tabs)
    body = (
      <>
        <InsightTabStrip tabs={tabs} active={tab} onPick={setPickedTab} />
        {analysis.sections.map((section, i) =>
          insightTabOf(section.kind) === tab
            ? renderSection(section, i, setViewerResource, t, onOpenLayer)
            : null,
        )}
      </>
    )
  } else if (hasStreamedContent && streamingSections) {
    body = (
      <>
        {/* Mini-log de actividad (F13) DURANTE la escritura: franja delgada
            encima de las secciones mientras el análisis sigue en vuelo — el
            hook limpia `activity` con el evento terminal, así que su sola
            presencia significa "todavía no terminó". Si el agente vuelve a
            usar herramientas a mitad de la redacción, se ve acá. */}
        {activity && activity.length > 0 && (
          <div className="rounded-md border border-border/60 bg-border/10 px-2.5 py-1.5">
            <HarnessActivityLog items={activity} />
          </div>
        )}
        {(() => {
          const tabs = availableInsightTabs(streamingSections.map((section) => section.kind))
          const tab = resolveInsightTab(pickedTab, tabs)
          return (
            <>
              <InsightTabStrip tabs={tabs} active={tab} onPick={setPickedTab} />
              {streamingSections.map((section, i) =>
                insightTabOf(section.kind) === tab
                  ? renderDraftSection(section, i, setViewerResource, t, onOpenLayer)
                  : null,
              )}
            </>
          )
        })()}
      </>
    )
  } else if (checkingCache || loading || isExploringEmpty) {
    body = (
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 text-sm text-muted">
          <Loader2 size={14} className="animate-spin text-accent" />
          {checkingCache
            ? t('didactic.analysis.checkingCache')
            : isExploringEmpty
              ? t('didactic.analysis.exploring')
              : t('didactic.analysis.analyzing')}
        </div>
        {/* Mini-log de actividad del harness (F13): qué está haciendo el
            agente sobre el snapshot mientras todavía no hay secciones. */}
        {activity && <HarnessActivityLog items={activity} />}
        <div className="h-20 animate-pulse rounded-md border border-border bg-border/20" />
        <div className="h-32 animate-pulse rounded-md border border-border bg-border/20" />
      </div>
    )
  } else if (showNoCliCard) {
    body = <NoCliProvidersCard loading={providerStatus.loading} onRecheck={providerStatus.refetch} />
  } else {
    body = <DidacticPlaceholder onAnalyze={analyze} />
  }

  return (
    <>
      {hasResult && !error && (
        <div className="flex items-center justify-between gap-2">
          <ActiveModelHint generatedWith={analysis?.generatedWith} />
          <button
            type="button"
            onClick={reanalyze}
            disabled={loading}
            title={t('didactic.analysis.reanalyzeHint')}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium text-muted transition-colors hover:bg-border/60 hover:text-text disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : undefined} />
            {t('didactic.analysis.reanalyze')}
          </button>
        </div>
      )}
      {isStale && analysis && currentHeadSha && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-warning/40 bg-warning/10 p-2.5 text-xs">
          <span className="flex items-center gap-2 text-warning">
            <AlertTriangle size={14} className="shrink-0" />
            {t('didactic.analysis.staleNotice', {
              from: analysis.headSha.slice(0, 7),
              to: currentHeadSha.slice(0, 7),
            })}
          </span>
          <button
            type="button"
            onClick={reanalyze}
            disabled={loading}
            className="shrink-0 rounded-md border border-warning/40 px-2 py-1 font-medium text-warning transition-colors hover:bg-warning/15 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t('didactic.analysis.update')}
          </button>
        </div>
      )}
      {isLanguageMismatch && analysis && (
        <div
          data-testid="analysis-language-banner"
          className="flex items-center justify-between gap-3 rounded-md border border-warning/40 bg-warning/10 p-2.5 text-xs"
        >
          <span className="flex items-center gap-2 text-warning">
            <Languages size={14} className="shrink-0" />
            {t('didactic.analysis.languageMismatch', {
              analysisLanguage: t(`didactic.languageNames.${analysis.language}`),
              uiLanguage: t(`didactic.languageNames.${locale}`),
            })}
          </span>
          <button
            type="button"
            data-testid="analysis-language-regenerate"
            onClick={reanalyze}
            disabled={loading}
            className="shrink-0 rounded-md border border-warning/40 px-2 py-1 font-medium text-warning transition-colors hover:bg-warning/15 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t('didactic.analysis.regenerate')}
          </button>
        </div>
      )}
      {body}
      {viewerResource && (
        <ResourceViewer resource={viewerResource} onClose={() => setViewerResource(null)} />
      )}
    </>
  )
}
