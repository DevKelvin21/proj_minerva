import type { DidacticSnippet } from '../../../../shared/types'
import { Dialog } from '../ui/Dialog'
import { Markdown } from '../ui/Markdown'
import { CodeSnippet } from './CodeSnippet'
import { MermaidZoomPan } from './MermaidZoomPan'

/**
 * Recurso que puede abrirse en el lightbox (T14). `markdown` cubre tanto el
 * caso "ver esta sección en grande" (tablas incluidas, ver el comentario de
 * `DidacticSectionCard`) como cualquier otro texto largo.
 */
export type ViewerResource =
  | { kind: 'mermaid'; title: string; code: string }
  | { kind: 'markdown'; title: string; markdown: string }
  | { kind: 'snippet'; title: string; snippet: DidacticSnippet }

interface ResourceViewerProps {
  resource: ViewerResource
  onClose: () => void
}

/**
 * Overlay a pantalla completa (dentro de la ventana que lo abre — panel
 * principal o ventana didáctica desacoplada, ambas reutilizan este mismo
 * componente) para inspeccionar un recurso del panel didáctico en grande:
 * diagramas Mermaid con zoom/pan (`MermaidZoomPan`), o tablas/snippets en una
 * vista ancha centrada con scroll. Cierra con el botón X o con Escape
 * (`ui/Dialog`, which also ignores the key while the review is hidden under home).
 */
export function ResourceViewer({ resource, onClose }: ResourceViewerProps): React.JSX.Element {
  // Altura del diálogo: para mermaid debe ser FIJA (h-[90vh]) y no
  // max-h-[90vh] — el diagrama dentro de MermaidZoomPan está posicionado
  // `absolute` (fuera de flujo, no aporta altura), así que con altura
  // basada en contenido el diálogo colapsaba a header+toolbar y el visor
  // se veía vacío (bug reportado con captura; los checks geométricos por
  // CDP no lo veían porque getBoundingClientRect ignora el clipping).
  // Para markdown/snippet (contenido en flujo con scroll) se mantiene
  // max-h para que recursos cortos no abran un diálogo gigante vacío.
  return (
    <Dialog
      onClose={onClose}
      title={resource.title}
      className={
        'w-[96vw] max-w-[1100px] ' + (resource.kind === 'mermaid' ? 'h-[92vh]' : 'max-h-[92vh]')
      }
    >
      <div className="min-h-0 flex-1">
        {resource.kind === 'mermaid' && <MermaidZoomPan code={resource.code} />}

        {resource.kind === 'markdown' && (
          <div className="h-full overflow-y-auto p-4">
            <div className="mx-auto max-w-4xl">
              <Markdown content={resource.markdown} images={false} />
            </div>
          </div>
        )}

        {resource.kind === 'snippet' && (
          <div className="h-full overflow-y-auto p-4">
            <div className="mx-auto max-w-4xl">
              <CodeSnippet snippet={resource.snippet} />
            </div>
          </div>
        )}
      </div>
    </Dialog>
  )
}
