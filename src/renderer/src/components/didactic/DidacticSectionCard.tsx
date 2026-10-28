import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ExpandButton } from './ExpandButton'

interface DidacticSectionCardProps {
  icon: ReactNode
  title: string
  /** Endpoint cards are titled by their route: shown in mono. */
  monoTitle?: boolean
  children: ReactNode
  /**
   * Visor de recursos (T14, `./ResourceViewer.tsx`): el botón "expandir"
   * vive a nivel de SECCIÓN completa — `onExpandMarkdown`, si se pasa, agrega
   * un botón en el header que abre el `ResourceViewer` con el markdown entero
   * de la sección (tablas incluidas) en una vista amplia con scroll.
   */
  onExpandMarkdown?: () => void
}

/**
 * One flat card per section: a title row and the body on the same surface.
 * Diagrams sit directly on it; code surfaces inside use `code-bg`. The card
 * is `panel` on a `bg` canvas, so it keeps its contrast in the docked panel
 * and in the detached window alike.
 */
export function DidacticSectionCard({
  icon,
  title,
  monoTitle = false,
  children,
  onExpandMarkdown,
}: DidacticSectionCardProps): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <section className="flex min-w-0 shrink-0 flex-col rounded-lg border border-border bg-panel">
      <header className="flex min-h-9 min-w-0 items-center gap-2 border-b border-border py-1 pr-1.5 pl-3 text-sm font-semibold text-text">
        <span className="shrink-0 text-accent" aria-hidden>
          {icon}
        </span>
        <span
          className={`min-w-0 flex-1 truncate ${monoTitle ? 'font-mono text-xs' : ''}`}
          title={monoTitle ? title : undefined}
        >
          {title}
        </span>
        {onExpandMarkdown && (
          <ExpandButton
            onExpand={onExpandMarkdown}
            label={t('didactic.resources.expandSectionLabel')}
            title={t('didactic.resources.expandSection')}
          />
        )}
      </header>
      <div className="flex min-w-0 flex-col gap-3 px-3 py-2.5">{children}</div>
    </section>
  )
}
