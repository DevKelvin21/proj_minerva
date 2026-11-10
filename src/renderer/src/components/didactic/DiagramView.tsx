import type { DidacticDiagram } from '../../../../shared/types'
import { HtmlDiagram } from './HtmlDiagram'
import { MermaidDiagram } from './MermaidDiagram'
import type { DiagramSize } from './diagram-size'

interface DiagramViewProps {
  diagram: DidacticDiagram
  naturalSize?: boolean
  onRendered?: (size: DiagramSize) => void
  framed?: boolean
}

/**
 * One analysis diagram in its format: HTML (every new analysis) in the
 * sandboxed `HtmlDiagram`, or Mermaid for analyses persisted before the
 * switch. Callers remount it with `key={diagram.source}` when it can change.
 */
export function DiagramView({ diagram, ...props }: DiagramViewProps): React.JSX.Element {
  return diagram.format === 'html' ? (
    <HtmlDiagram source={diagram.source} {...props} />
  ) : (
    <MermaidDiagram code={diagram.source} {...props} />
  )
}
