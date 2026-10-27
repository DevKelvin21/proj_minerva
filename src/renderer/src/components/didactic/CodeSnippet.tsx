import { useState } from 'react'
import { Check, Copy, Maximize2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { DidacticSnippet } from '../../../../shared/types'
import { HighlightedCode } from '../ui/HighlightedCode'

interface CodeSnippetProps {
  snippet: DidacticSnippet
  /**
   * Al pasarlo, agrega un botón "expandir" en el header, junto a "Copiar"
   * (abre el `ResourceViewer`). Va DENTRO del header y no como overlay
   * flotante (`ExpandableResource`): el overlay caía justo encima de
   * "Copiar" y dejaba ambos botones incliqueables.
   */
  onExpand?: () => void
}

/** Bloque de código copiable (curl / .http) con feedback visual breve tras copiar. */
export function CodeSnippet({ snippet, onExpand }: CodeSnippetProps): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const { t } = useTranslation()

  const handleCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(snippet.code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Sin permiso de portapapeles o API no disponible en este contexto:
      // no hay un fallback razonable, se ignora silenciosamente el clic.
    }
  }

  return (
    <div className="overflow-hidden rounded-md border border-border">
      <div className="flex items-center justify-between border-b border-border bg-border/30 px-2.5 py-1.5">
        <span className="text-xs font-medium text-muted">{snippet.label}</span>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => void handleCopy()}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted transition-colors hover:bg-border/60 hover:text-text"
          >
            {copied ? <Check size={12} className="text-success" /> : <Copy size={12} />}
            {copied ? t('common.copied') : t('common.copy')}
          </button>
          {onExpand && (
            <button
              type="button"
              onClick={onExpand}
              title={t('didactic.resources.expandSnippet')}
              aria-label={t('didactic.resources.expandSnippet')}
              className="rounded p-1 text-muted transition-colors hover:bg-border/60 hover:text-text"
            >
              <Maximize2 size={12} />
            </button>
          )}
        </div>
      </div>
      <pre className="overflow-x-auto bg-bg p-2.5 text-xs text-text">
        <HighlightedCode code={snippet.code} language={snippet.language} />
      </pre>
    </div>
  )
}
