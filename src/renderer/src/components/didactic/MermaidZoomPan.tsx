import { useCallback, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react'
import { Maximize, Minus, Plus, RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { MermaidDiagram } from './MermaidDiagram'
import { IconButton } from '../ui/IconButton'

interface MermaidZoomPanProps {
  code: string
}

const MIN_ZOOM = 0.25
const MAX_ZOOM = 4
const ZOOM_STEP = 0.15
const FIT_PADDING_PX = 32

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * Zoom (rueda, 0.25x-4x, hacia el cursor) + pan (drag) + reset (doble click)
 * para un diagrama Mermaid ya renderizado (T14, lightbox de `ResourceViewer`).
 *
 * Clave de la implementación: NO se vuelve a renderizar el SVG en cada
 * cambio de zoom/pan. `MermaidDiagram` (en modo `naturalSize`, que fija el
 * SVG a los px de su viewBox — dentro de un wrapper `absolute` el
 * `width:100%` de mermaid colapsaba a 0 y el visor se veía vacío) renderiza
 * el SVG una sola vez; este componente solo envuelve ese resultado en un `div` al que le
 * aplica un `transform: translate(...) scale(...)` por CSS — el mismo SVG de
 * siempre, solo transformado visualmente. El "ajustar" mide el SVG ya
 * montado (`querySelector('svg')` sobre el contenedor) para calcular el
 * factor de escala que lo hace caber, dividiendo por el zoom vigente para
 * obtener su tamaño "natural" (el `getBoundingClientRect` ya refleja el
 * transform CSS activo).
 */
export function MermaidZoomPan({ code }: MermaidZoomPanProps): React.JSX.Element {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const dragOrigin = useRef<{
    startX: number
    startY: number
    originX: number
    originY: number
  } | null>(null)

  const resetView = useCallback(() => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }, [])

  const zoomBy = useCallback((factor: number, cursor?: { x: number; y: number }) => {
    setZoom((prevZoom) => {
      const nextZoom = clamp(prevZoom * factor, MIN_ZOOM, MAX_ZOOM)
      const container = containerRef.current
      if (cursor && container) {
        const rect = container.getBoundingClientRect()
        const cx = cursor.x - rect.left - rect.width / 2
        const cy = cursor.y - rect.top - rect.height / 2
        const ratio = nextZoom / prevZoom
        setPan((prevPan) => ({
          x: cx - (cx - prevPan.x) * ratio,
          y: cy - (cy - prevPan.y) * ratio,
        }))
      }
      return nextZoom
    })
  }, [])

  // El tamaño natural sale del viewBox (con `naturalSize`, `MermaidDiagram`
  // fija el SVG exactamente a esos px), NO de getBoundingClientRect/zoom:
  // medir el rect y dividir por el zoom vigente es orden-dependiente (si el
  // fit corre dos veces en el mismo frame — StrictMode dispara `onRendered`
  // doble — la segunda medición aún no refleja el zoom de la primera y el
  // factor se compone hasta clavarse en MIN_ZOOM). Con el viewBox el cálculo
  // es idempotente: mismas entradas, mismo zoom.
  const fitToContainer = useCallback(() => {
    const container = containerRef.current
    const svg = container?.querySelector('svg')
    const viewBox = svg?.viewBox.baseVal
    if (!container || !viewBox || viewBox.width === 0 || viewBox.height === 0) {
      resetView()
      return
    }

    const containerRect = container.getBoundingClientRect()
    const scaleX = (containerRect.width - FIT_PADDING_PX) / viewBox.width
    const scaleY = (containerRect.height - FIT_PADDING_PX) / viewBox.height
    setZoom(clamp(Math.min(scaleX, scaleY), MIN_ZOOM, MAX_ZOOM))
    setPan({ x: 0, y: 0 })
  }, [resetView])

  const handleWheel = useCallback(
    (e: ReactWheelEvent<HTMLDivElement>) => {
      e.preventDefault()
      const factor = e.deltaY < 0 ? 1 + ZOOM_STEP : 1 / (1 + ZOOM_STEP)
      zoomBy(factor, { x: e.clientX, y: e.clientY })
    },
    [zoomBy],
  )

  // Auto-ajuste inicial: cuando `MermaidDiagram` avisa que el SVG ya está en
  // el DOM (render asíncrono de mermaid), se ajusta al contenedor en el
  // siguiente frame (el rAF deja que el estilo de tamaño natural aplique
  // antes de medir). Sin esto el visor abría en 100% con pan (0,0), que para
  // diagramas grandes mostraba una esquina — o nada.
  const handleRendered = useCallback(() => {
    requestAnimationFrame(() => fitToContainer())
  }, [fitToContainer])

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      dragOrigin.current = { startX: e.clientX, startY: e.clientY, originX: pan.x, originY: pan.y }
      setIsDragging(true)
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    [pan.x, pan.y],
  )

  const handlePointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const origin = dragOrigin.current
    if (!origin) return
    setPan({
      x: origin.originX + (e.clientX - origin.startX),
      y: origin.originY + (e.clientY - origin.startY),
    })
  }, [])

  const endDrag = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    dragOrigin.current = null
    setIsDragging(false)
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }, [])

  return (
    <div className="flex h-full flex-col">
      <div
        ref={containerRef}
        className={
          'relative flex-1 overflow-hidden bg-white ' +
          (isDragging ? 'cursor-grabbing' : 'cursor-grab')
        }
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
        onDoubleClick={resetView}
      >
        <div
          className="absolute top-1/2 left-1/2 w-max"
          style={{
            transform:
              'translate(-50%, -50%) translate(' +
              pan.x +
              'px, ' +
              pan.y +
              'px) scale(' +
              zoom +
              ')',
            transformOrigin: 'center center',
          }}
        >
          <MermaidDiagram code={code} naturalSize onRendered={handleRendered} />
        </div>
      </div>
      <div className="flex items-center justify-center gap-2 border-t border-border bg-panel px-3 py-2">
        <IconButton
          icon={<Minus size={14} />}
          label={t('didactic.mermaid.zoomOut')}
          onClick={() => zoomBy(1 / (1 + ZOOM_STEP))}
        />
        <span className="w-12 text-center text-xs text-muted tabular-nums">
          {Math.round(zoom * 100)}%
        </span>
        <IconButton
          icon={<Plus size={14} />}
          label={t('didactic.mermaid.zoomIn')}
          onClick={() => zoomBy(1 + ZOOM_STEP)}
        />
        <IconButton
          icon={<Maximize size={14} />}
          label={t('didactic.mermaid.fit')}
          onClick={fitToContainer}
        />
        <IconButton icon={<RotateCcw size={14} />} label={t('didactic.mermaid.reset')} onClick={resetView} />
      </div>
    </div>
  )
}
