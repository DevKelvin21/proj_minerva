import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { DidacticSnippet } from '../../../../shared/types'
import { Button } from '../ui/Button'
import { HighlightedCode } from '../ui/HighlightedCode'
import { ExpandButton } from './ExpandButton'

interface CodeSnippetProps {
  snippet: DidacticSnippet
  /**
   * Al pasarlo, agrega el `ExpandButton` en el header, junto a "Copiar"
   * (abre el `ResourceViewer`). Va DENTRO del header y no como overlay
   * flotante (`ExpandableResource`): el overlay caía justo encima de
   * "Copiar" y dejaba ambos botones incliqueables.
   */
  onExpand?: () => void
}

/**
 * Bloque de código copiable (curl / .http) con feedback visual breve tras
 * copiar: one `code-bg` surface (label row and code), no box inside the card.
 */
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
    <div className="min-w-0 overflow-hidden rounded-md bg-code-bg">
      <div className="flex min-w-0 items-center justify-between gap-2 py-1 pr-1 pl-2.5">
        <span className="min-w-0 truncate text-[11px] font-medium text-muted">{snippet.label}</span>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="xs"
            onClick={() => void handleCopy()}
            icon={
              copied ? (
                <Check size={12} className="text-success" aria-hidden />
              ) : (
                <Copy size={12} aria-hidden />
              )
            }
          >
            {copied ? t('common.copied') : t('common.copy')}
          </Button>
          {onExpand && (
            <ExpandButton onExpand={onExpand} label={t('didactic.resources.expandSnippet')} />
          )}
        </div>
      </div>
      <pre className="overflow-x-auto px-2.5 pb-2.5 text-xs text-text">
        <HighlightedCode code={snippet.code} language={snippet.language} />
      </pre>
    </div>
  )
}
