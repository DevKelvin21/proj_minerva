import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { Mermaid, MermaidConfig } from 'mermaid'
import { useTranslation } from 'react-i18next'
import { useResolvedAppearance } from '../../stores/appearance-store'
import { mermaidInk, mermaidThemeConfig, type MermaidInk } from '../../theme/mermaid-theme'
import { Skeleton } from '../ui/Skeleton'
import { Callout } from '../ui/Callout'

interface MermaidDiagramProps {
  code: string
  /**
   * Modo lightbox (`MermaidZoomPan`): fija el SVG a su tamaño natural (el de
   * su viewBox, en px) en vez del `width:100%` + `max-width` con el que lo
   * emite mermaid. Necesario porque el wrapper del visor es `absolute` con
   * ancho shrink-to-fit: con `width:100%` el SVG colapsaba a 0px y el visor
   * se veía vacío.
   */
  naturalSize?: boolean
  /** Se dispara cuando el SVG ya está montado en el DOM (para auto-ajustar zoom). */
  onRendered?: () => void
}

/**
 * Singleton perezoso del módulo `mermaid`: se importa dinámicamente
 * (`import('mermaid')`) la primera vez que se monta un diagrama, en vez de
 * en el boot de la app — `mermaid` pesa ~1MB y el panel didáctico es la
 * única superficie que dibuja diagramas. `initialize()` solo se llama una
 * vez pase lo que pase (llamarlo de nuevo reinicia estado interno de mermaid
 * innecesariamente).
 *
 * Theme: diagrams follow the app theme (`../../theme/mermaid-theme.ts`, the
 * `base` theme with variables taken from the active palette), drawn on the
 * theme's canvas, and re-render when the theme changes: `mermaid.initialize`
 * runs again before each render with the current palette. La config de `c4`/`er`/`flowchart`
 * de abajo abre el layout por defecto (más fila/margen/padding) para que las
 * etiquetas largas de `Rel()` que genera la IA no se encimen entre sí ni con
 * las cajas.
 *
 * Icon packs (T77): `registerIconPacks` se llama UNA sola vez junto con
 * `initialize()`, con dos packs locales para que `architecture-beta` (la
 * sección `cloud`) pinte logos en vez de cajas genéricas: `logos`
 * (`@iconify-json/logos`, ya trae AWS/GCP/etc.) y `cf` (`../../assets/
 * cf-icon-pack.ts`, servicios de Cloudflare que `logos` no cubre). Un icono
 * desconocido degrada a un placeholder '?' sin romper el render (validado en
 * el spike previo a esta tarea) — no hace falta manejo de error extra acá.
 *
 * Los dos packs se cargan con `import()` DINÁMICO dentro de esta misma
 * promesa, no con un `import` estático arriba del archivo: este módulo
 * (`MermaidDiagram.tsx`) es alcanzable de forma estática desde el entry
 * principal (`DidacticAnalysisArea` lo importa directo, sin `React.lazy`),
 * así que cualquier `import` de valor arriba del archivo cae en el bundle
 * principal sin importar que solo se use dentro de este `.then()` — un
 * `import()` dinámico es el único mecanismo que crea un chunk separado.
 * `@iconify-json/logos` en particular pesa ~7MB (todo el set de logos); con
 * import estático `npm run build` infla el entry principal de ~2.5MB a
 * ~10MB. Con `import()` queda en el mismo chunk lazy que `mermaid` — medido
 * con `npm run build` (ver reporte de la tarea).
 */
let mermaidPromise: Promise<Mermaid> | null = null

/** Margen (px de coordenadas SVG) alrededor del contenido al recortar el viewBox. */
const TRIM_PADDING = 24

/**
 * Normaliza el markup del SVG que emite mermaid, sobre el STRING (antes de
 * `dangerouslySetInnerHTML`) y no mutando el nodo ya montado: React puede
 * re-insertar el innerHTML en cualquier re-render y una mutación post-mount
 * se perdería en silencio. Dos arreglos:
 *
 * 1. Recorta el viewBox al bounding box real del contenido (+padding): el
 *    motor C4 de mermaid emite un lienzo con bandas muertas de >100px por
 *    lado, que encogen el diagrama tanto en el auto-fit del visor como en la
 *    tarjeta inline (T16). Medir el bbox exige layout, así que el SVG se
 *    monta un instante en un host oculto (visibility:hidden, NO display:none
 *    — con display:none getBBox devuelve 0).
 * 2. En modo `naturalSize` fija width/height a los px del viewBox en vez del
 *    `width="100%"` + `max-width` de mermaid (dentro del wrapper `absolute`
 *    del visor, `width:100%` colapsa a 0px — T15).
 *
 * Parseo como text/html y NO como image/svg+xml: los C4 de mermaid traen el
 * person icon como <image xlink:href="data:..."> SIN declarar xmlns:xlink, y
 * el parser XML rechaza el documento entero ("Namespace prefix xlink...") —
 * con XML esta función devolvía el markup intacto y el visor volvía a
 * colapsar (T16, regresión silenciosa del fix de T15). El parser HTML es
 * tolerante y además es el mismo modelo con el que se consume el string
 * después (dangerouslySetInnerHTML).
 */
function normalizeSvg(svgMarkup: string, naturalSize: boolean, ink: MermaidInk): string {
  const doc = new DOMParser().parseFromString(svgMarkup, 'text/html')
  const svg = doc.body.querySelector('svg')
  if (!svg) return svgMarkup
  recolorFixedInk(svg, ink)

  const host = document.createElement('div')
  host.style.cssText = 'position:absolute; left:-99999px; top:0; visibility:hidden'
  host.appendChild(svg)
  document.body.appendChild(host)
  let content: { x: number; y: number; width: number; height: number } | null = null
  try {
    const bbox = (svg as unknown as SVGSVGElement).getBBox()
    if (bbox.width > 0 && bbox.height > 0) content = bbox
  } catch {
    // getBBox puede lanzar en SVGs degenerados; se cae al viewBox original.
  }
  host.remove()

  if (content) {
    const x = content.x - TRIM_PADDING
    const y = content.y - TRIM_PADDING
    const w = content.width + TRIM_PADDING * 2
    const h = content.height + TRIM_PADDING * 2
    svg.setAttribute('viewBox', `${x} ${y} ${w} ${h}`)
    if (!naturalSize) {
      // La tarjeta inline conserva width:100%; solo se ajusta el tope.
      svg.setAttribute('style', `max-width: ${Math.ceil(w)}px;`)
    }
  }

  const viewBox = (svg.getAttribute('viewBox') ?? '')
    .trim()
    .split(/[\s,]+/)
    .map(Number)
  const width = viewBox.length === 4 ? viewBox[2] : 0
  const height = viewBox.length === 4 ? viewBox[3] : 0
  if (!(width > 0) || !(height > 0)) return svgMarkup
  if (naturalSize) {
    svg.setAttribute('width', String(width))
    svg.setAttribute('height', String(height))
    svg.setAttribute('style', `max-width: none; width: ${width}px; height: ${height}px;`)
  }
  return new XMLSerializer().serializeToString(svg)
}

/**
 * Mermaid's C4 renderer ignores the theme for relationship labels/lines and
 * boundary titles: it hard-codes `#444444`, unreadable on a dark canvas.
 * Those exact values are swapped for the theme's text (fills) and muted
 * (strokes) colors.
 */
const FIXED_C4_INK = '#444444'

function recolorFixedInk(svg: Element, ink: MermaidInk): void {
  for (const element of svg.querySelectorAll('[fill], [stroke]')) {
    if (element.getAttribute('fill')?.toLowerCase() === FIXED_C4_INK) {
      element.setAttribute('fill', element.tagName.toLowerCase() === 'text' ? ink.text : ink.line)
    }
    if (element.getAttribute('stroke')?.toLowerCase() === FIXED_C4_INK) {
      element.setAttribute('stroke', ink.line)
    }
  }
}

function getMermaid(): Promise<Mermaid> {
  if (!mermaidPromise) {
    mermaidPromise = Promise.all([
      import('mermaid'),
      import('@iconify-json/logos'),
      import('../../assets/cf-icon-pack'),
    ]).then(([mermaidMod, logosMod, cfMod]) => {
      const mermaid = mermaidMod.default
      mermaid.registerIconPacks([
        { name: 'logos', icons: logosMod.icons },
        { name: 'cf', icons: cfMod.cfIconPack },
      ])
      return mermaid
    })
  }
  return mermaidPromise
}

/** Layout config shared by every render; the theme part is added per render. */
const BASE_MERMAID_CONFIG: MermaidConfig = {
  startOnLoad: false,
  securityLevel: 'strict',
  c4: {
    c4ShapeInRow: 3,
    c4BoundaryInRow: 1,
    // 110 y no menos: el hueco horizontal entre shapes debe caber una
    // etiqueta de Rel de ~4 palabras sin pisar las cajas vecinas (el
    // motor C4 centra la etiqueta en el punto medio de la flecha).
    c4ShapeMargin: 110,
    c4ShapePadding: 24,
    diagramMarginX: 40,
    diagramMarginY: 40,
    messageFontSize: 14,
  },
  er: {
    diagramPadding: 24,
  },
  flowchart: {
    nodeSpacing: 60,
    rankSpacing: 60,
    diagramPadding: 16,
  },
}

/**
 * Renderiza un diagrama Mermaid (C4, `erDiagram`, ...) generado por la IA a
 * partir del DSL de texto — la IA nunca dibuja, solo escribe Mermaid (ver
 * `CLAUDE.md`). Si el parse falla (DSL inválido, p. ej. por un modelo real
 * que alucine sintaxis), cae a una tarjeta con el código fuente en vez de
 * romper el panel.
 *
 * Nota: si `code` puede cambiar en un componente ya montado (no es el caso
 * hoy: cada sección de un `DidacticAnalysis` trae su Mermaid fijo), quien lo
 * use debe forzar remount con `key={code}` en vez de que este componente
 * intente resetear su propio estado — comparar "código anterior" en un ref
 * durante el render es justamente el antipatrón que marca el lint
 * `react-hooks/refs`.
 */
export function MermaidDiagram({
  code,
  naturalSize = false,
  onRendered,
}: MermaidDiagramProps): React.JSX.Element {
  const { t } = useTranslation()
  const rawId = useId().replace(/:/g, '')
  const elementId = `mermaid-${rawId}`
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [svg, setSvg] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  // `colors` is the theme's own (stable) object, so the config, and with it
  // the render effect, only changes when the palette or appearance does.
  const { appearance, colors } = useResolvedAppearance()
  const themeConfig = useMemo(() => mermaidThemeConfig(appearance, colors), [appearance, colors])

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const mermaid = await getMermaid()
        mermaid.initialize({ ...BASE_MERMAID_CONFIG, ...themeConfig })
        const { svg: rendered } = await mermaid.render(elementId, code)
        if (!cancelled) setSvg(normalizeSvg(rendered, naturalSize, mermaidInk(themeConfig)))
      } catch (error) {
        // Log del motivo real: sin esto el fallback "no renderizable" es
        // indistinguible entre DSL inválido de la IA y un bug nuestro (T16).
        console.error('[MermaidDiagram] render falló:', error)
        if (!cancelled) setFailed(true)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [code, elementId, naturalSize, themeConfig])

  // Avisa cuando el SVG ya está montado en el DOM (corre tras el render que
  // insertó `svg` vía dangerouslySetInnerHTML). Puede dispararse más de una
  // vez (StrictMode): el consumidor debe ser idempotente.
  useEffect(() => {
    if (!svg) return
    if (containerRef.current?.querySelector('svg')) onRendered?.()
  }, [svg, onRendered])

  if (failed) {
    return (
      <Callout tone="warning">
        <p className="mb-2 font-medium">{t('didactic.mermaid.unrenderable')}</p>
        <pre className="overflow-x-auto text-[11px] whitespace-pre-wrap text-muted">{code}</pre>
      </Callout>
    )
  }

  if (!svg) {
    return <Skeleton className="h-24" />
  }

  // El SVG viene de `mermaid.render(...)` con `securityLevel: 'strict'`: en
  // ese modo mermaid sanitiza el markup que genera (sin <script>, sin
  // handlers `on*` inline) incluso cuando el DSL de entrada proviene de un
  // PR de terceros (entrada no confiable, ver frontera de seguridad en
  // `CLAUDE.md`). Por eso, y solo por eso, es seguro insertarlo aquí con
  // `dangerouslySetInnerHTML` en vez de con un parser SVG propio.
  return (
    <div
      ref={containerRef}
      className={
        naturalSize
          ? 'w-max'
          : 'overflow-x-auto rounded-md border border-border bg-bg p-3 [&_svg]:mx-auto'
      }
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}
