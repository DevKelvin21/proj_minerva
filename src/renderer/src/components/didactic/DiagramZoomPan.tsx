import { useCallback, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react'
import { Icon } from '../ui/Icon'
import { icons } from '../ui/icons'
import { useTranslation } from 'react-i18next'
import { IconButton } from '../ui/IconButton'
import type { DidacticDiagram } from '../../../../shared/types'
import { DiagramView } from './DiagramView'
import type { DiagramSize } from './diagram-size'

interface DiagramZoomPanProps {
  diagram: DidacticDiagram
}

const MIN_ZOOM = 0.25
const MAX_ZOOM = 4
const ZOOM_STEP = 0.15
const FIT_PADDING_PX = 32

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * Zoom (wheel, 0.25x-4x, toward the cursor) + pan (drag) + reset (double
 * click) for a rendered diagram of either format (T14, `ResourceViewer`'s
 * lightbox).
 *
 * The diagram renders ONCE, in `naturalSize` mode (Mermaid: the SVG pinned
 * to its viewBox px; HTML: the frame at a fixed layout width, without pointer
 * events so the drag lands here), and reports that natural size through
 * `onRendered`. Zoom and pan are only a CSS `transform` on its wrapper, and
 * "fit" divides the container by the reported size.
 */
export function DiagramZoomPan({ diagram }: DiagramZoomPanProps): React.JSX.Element {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const naturalSizeRef = useRef<DiagramSize | null>(null)
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

  // The natural size comes from the diagram itself (`onRendered`), never
  // from getBoundingClientRect / zoom: measuring the rect and dividing by the
  // current zoom is order-dependent (StrictMode fires `onRendered` twice and
  // the factor compounded down to MIN_ZOOM). With the reported size the fit
  // is idempotent: same inputs, same zoom.
  const fitToContainer = useCallback(() => {
    const container = containerRef.current
    const size = naturalSizeRef.current
    if (!container || !size || size.width === 0 || size.height === 0) {
      resetView()
      return
    }

    const containerRect = container.getBoundingClientRect()
    const scaleX = (containerRect.width - FIT_PADDING_PX) / size.width
    const scaleY = (containerRect.height - FIT_PADDING_PX) / size.height
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

  // Initial fit: once the diagram reports its natural size, fit it on the
  // next frame (the rAF lets the natural-size style apply first). Without it
  // the viewer opened at 100% with pan (0,0), which for a large diagram
  // showed a corner, or nothing.
  const handleRendered = useCallback(
    (size: DiagramSize) => {
      naturalSizeRef.current = size
      requestAnimationFrame(() => fitToContainer())
    },
    [fitToContainer],
  )

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
          'relative flex-1 overflow-hidden bg-bg ' +
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
          <DiagramView diagram={diagram} naturalSize onRendered={handleRendered} />
        </div>
      </div>
      <div className="flex items-center justify-center gap-2 border-t border-border bg-panel px-3 py-2">
        <IconButton
          icon={<Icon icon={icons.zoomOut} size="sm" />}
          label={t('didactic.diagram.zoomOut')}
          onClick={() => zoomBy(1 / (1 + ZOOM_STEP))}
        />
        <span className="w-12 text-center text-xs text-muted tabular-nums">
          {Math.round(zoom * 100)}%
        </span>
        <IconButton
          icon={<Icon icon={icons.zoomIn} size="sm" />}
          label={t('didactic.diagram.zoomIn')}
          onClick={() => zoomBy(1 + ZOOM_STEP)}
        />
        <IconButton
          icon={<Icon icon={icons.fit} size="sm" />}
          label={t('didactic.diagram.fit')}
          onClick={fitToContainer}
        />
        <IconButton icon={<Icon icon={icons.resetView} size="sm" />} label={t('didactic.diagram.reset')} onClick={resetView} />
      </div>
    </div>
  )
}
