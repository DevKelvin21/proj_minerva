import { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { themeCssVariables } from '../../../../shared/theme/appearance'
import { useAppearanceStore, useResolvedAppearance } from '../../stores/appearance-store'
import { buildDiagramDocument, sanitizeDiagramHtml } from '../../lib/diagram-document'
import { Callout } from '../ui/Callout'
import type { DiagramSize } from './diagram-size'

interface HtmlDiagramProps {
  source: string
  /**
   * Lightbox mode (`DiagramZoomPan`): a fixed layout width so the zoom has a
   * natural size to scale, and no pointer events so dragging pans the view
   * instead of landing inside the frame.
   */
  naturalSize?: boolean
  /** Fires once the document loaded and was measured (to fit the zoom). */
  onRendered?: (size: DiagramSize) => void
  /** `false` draws straight on the card; `true` (default) adds the bordered box. */
  framed?: boolean
}

/** Layout width of the lightbox render; the zoom then fits it to the dialog. */
const NATURAL_WIDTH_PX = 960
/** Before the first measure, and the floor afterwards. */
const MIN_HEIGHT_PX = 48
/** A runaway diagram never grows the panel past this. */
const MAX_HEIGHT_PX = 6000

/**
 * An AI-written HTML diagram (`@@@HTML` blocks, the analysis format since
 * Mermaid was dropped) drawn in a sandboxed, script-less, network-less
 * iframe: see `lib/diagram-document.ts` for the three layers that keep the
 * untrusted source inert. The frame takes the height of its content, which
 * the parent can measure because the frame is same-origin (and, without
 * scripts, that is safe). The document is rebuilt when the theme changes, so
 * the diagram follows it like the rest of the app.
 */
export function HtmlDiagram({
  source,
  naturalSize = false,
  onRendered,
  framed = true,
}: HtmlDiagramProps): React.JSX.Element {
  const { t } = useTranslation()
  const { appearance, colors } = useResolvedAppearance()
  const contrast = useAppearanceStore((s) => s.settings.contrast)
  const body = useMemo(() => sanitizeDiagramHtml(source), [source])
  const srcDoc = useMemo(
    () =>
      body === null
        ? null
        : buildDiagramDocument(body, themeCssVariables(colors, appearance, contrast), appearance),
    [body, colors, appearance, contrast],
  )
  const [height, setHeight] = useState<number | null>(null)
  const frameRef = useRef<HTMLIFrameElement | null>(null)

  /** Content height of the frame's document, or `null` while it has no box (hidden tab). */
  const measure = useCallback((): number | null => {
    const root = frameRef.current?.contentDocument?.documentElement
    if (!root) return null
    const measured = Math.ceil(root.getBoundingClientRect().height)
    if (measured <= 0) return null
    const next = Math.min(MAX_HEIGHT_PX, Math.max(MIN_HEIGHT_PX, measured))
    setHeight((prev) => (prev === next ? prev : next))
    return next
  }, [])

  // Callback ref (gotcha 10): re-measure when the WIDTH changes (a resized
  // panel reflows the content, a hidden tab becomes visible). Height changes
  // are ours and are ignored, so measuring never feeds back into itself.
  const attachFrame = useCallback(
    (node: HTMLIFrameElement | null) => {
      frameRef.current = node
      if (!node) return
      let lastWidth = -1
      const observer = new ResizeObserver((entries) => {
        const width = Math.round(entries[0].contentRect.width)
        if (width === lastWidth) return
        lastWidth = width
        measure()
      })
      observer.observe(node)
      return () => observer.disconnect()
    },
    [measure],
  )

  const handleLoad = useCallback(() => {
    const measured = measure()
    if (measured !== null) {
      onRendered?.({ width: naturalSize ? NATURAL_WIDTH_PX : (frameRef.current?.clientWidth ?? 0), height: measured })
    }
  }, [measure, naturalSize, onRendered])

  if (srcDoc === null) {
    // Refused by the sanitizer (too heavy, or markup that re-parses differently).
    return (
      <Callout tone="warning">
        <p className="font-medium">{t('didactic.diagram.unrenderable')}</p>
      </Callout>
    )
  }

  const frame = (
    <iframe
      ref={attachFrame}
      title={t('didactic.diagram.frameTitle')}
      sandbox="allow-same-origin"
      referrerPolicy="no-referrer"
      srcDoc={srcDoc}
      onLoad={handleLoad}
      data-testid="html-diagram"
      className={'block border-0 bg-transparent ' + (naturalSize ? 'pointer-events-none' : 'w-full')}
      style={{
        // Layout and paint inside the frame never spill into the app's.
        contain: 'strict',
        height: height ?? MIN_HEIGHT_PX,
        ...(naturalSize ? { width: NATURAL_WIDTH_PX } : {}),
      }}
    />
  )

  if (naturalSize) return frame
  return (
    <div className={framed ? 'min-w-0 rounded-md border border-border bg-bg p-2' : 'min-w-0 py-1'}>
      {frame}
    </div>
  )
}
