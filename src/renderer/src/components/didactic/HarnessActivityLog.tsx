import { Check, CircleAlert } from 'lucide-react'
import type { AnalysisActivityItem } from '../../../../shared/events'
import { Spinner } from '../ui/Spinner'

/**
 * Mini-log SUTIL de actividad del harness (F13): las últimas ≤5 acciones
 * internas del agente mientras un análisis está en curso ("Leyó
 * src/api/routes.ts", "Buscando \"router\"…", "Pensando…"). Puramente
 * informativo y efímero — desaparece con el evento terminal (el hook
 * `use-didactic-analysis` limpia `activity` en `done`), nunca forma parte
 * del análisis final.
 *
 * Los `label` vienen YA derivados (en español) y SANEADOS desde main
 * (`src/main/ai/activity-tracker.ts`) — acá solo se pintan tal cual, con un
 * glifo por estado (spinner=running, check=done, alerta=error) y opacidad
 * decreciente hacia las filas más viejas (la última acción es la
 * protagonista). El colapso running→done ocurre EN LA MISMA FILA (mismo
 * `id`, patrón t3code), por eso `key={item.id}`.
 */
export function HarnessActivityLog({
  items,
}: {
  items: AnalysisActivityItem[]
}): React.JSX.Element | null {
  if (items.length === 0) return null
  return (
    <ul aria-live="polite" className="flex flex-col gap-0.5 text-xs text-muted">
      {items.map((item, i) => (
        <li
          key={item.id}
          className="flex min-w-0 items-center gap-1.5 transition-opacity duration-300"
          style={{ opacity: 0.45 + 0.55 * ((i + 1) / items.length) }}
        >
          {item.status === 'running' ? (
            <Spinner size={11} />
          ) : item.status === 'error' ? (
            <CircleAlert size={11} className="shrink-0 text-danger" />
          ) : (
            <Check size={11} className="shrink-0 text-success" />
          )}
          <span className="truncate">{item.label}</span>
        </li>
      ))}
    </ul>
  )
}
