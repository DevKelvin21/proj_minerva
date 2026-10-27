import type { ReactNode } from 'react'
import { Maximize2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface DidacticSectionCardProps {
  icon: ReactNode
  title: string
  children: ReactNode
  /**
   * Visor de recursos (T14, `./ResourceViewer.tsx`): capturar tablas
   * Markdown individuales del render de `Markdown` es demasiado
   * invasivo (obligaría a `Markdown` a exponer refs/callbacks por
   * cada `<table>` que renderiza, acoplando un componente genérico a un caso
   * de uso puntual). Decisión pragmática: el botón "expandir" vive a nivel de
   * SECCIÓN completa — `onExpandMarkdown`, si se pasa, agrega un botón en el
   * header que abre el `ResourceViewer` con el markdown entero de la sección
   * (tablas incluidas) en una vista amplia con scroll.
   */
  onExpandMarkdown?: () => void
}

/** Envoltorio visual de una sección del panel didáctico: header con icono + cuerpo. */
export function DidacticSectionCard({
  icon,
  title,
  children,
  onExpandMarkdown,
}: DidacticSectionCardProps): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <section className="rounded-md border border-border bg-bg">
      <header className="flex items-center justify-between gap-1.5 border-b border-border bg-border/20 px-3 py-2 text-sm font-semibold text-text">
        <span className="flex items-center gap-1.5">
          <span className="text-accent" aria-hidden>
            {icon}
          </span>
          {title}
        </span>
        {onExpandMarkdown && (
          <button
            type="button"
            onClick={onExpandMarkdown}
            title={t('didactic.resources.expandSection')}
            aria-label={t('didactic.resources.expandSectionLabel')}
            className="rounded p-1 text-muted transition-colors hover:bg-border/60 hover:text-text"
          >
            <Maximize2 size={14} />
          </button>
        )}
      </header>
      <div className="flex flex-col gap-3 p-3">{children}</div>
    </section>
  )
}
