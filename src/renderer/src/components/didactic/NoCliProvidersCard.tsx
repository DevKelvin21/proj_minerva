import { AlertTriangle, RefreshCw } from 'lucide-react'
import { AI_PROVIDER_IDS, AI_PROVIDER_CATALOG } from '../../../../shared/ai-providers'
import { CLI_META } from '../../lib/cli-meta'

interface NoCliProvidersCardProps {
  loading: boolean
  onRecheck: () => void
}

/**
 * Card que reemplaza el `DidacticPlaceholder` normal (T60) cuando
 * `useProviderStatus` reporta los TRES proveedores en `unavailable` Y la app
 * NO está en modo SCM-mock (`ScmSettingsInfo.mockScm`, ver
 * `../../hooks/use-scm-settings.ts` — con mock la demo funciona sin ningún CLI
 * vía `MockAiService`, así que esta card no aplica). Vive en
 * `DidacticAnalysisArea.tsx`, no en `DidacticPlaceholder.tsx`: el caso "sin
 * PR seleccionado" (`DidacticPanel` sin `selectedPr`) no tiene sentido acá,
 * nunca hay nada que analizar todavía.
 *
 * Reusa `CLI_META` (`../../lib/cli-meta.ts`, misma URL/comando por proveedor
 * que `CliLoginGuide` en Settings) en vez de duplicar la tabla de enlaces.
 */
export function NoCliProvidersCard({ loading, onRecheck }: NoCliProvidersCardProps): React.JSX.Element {
  return (
    <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
      <p className="mb-1 flex items-center gap-2 font-medium text-warning">
        <AlertTriangle size={16} className="shrink-0" />
        Necesitás al menos un CLI de IA
      </p>
      <p className="mb-3 text-xs text-muted">
        El análisis didáctico corre sobre un CLI agéntico que ya tengas instalado y logueado en tu
        máquina — Minerva no trae ninguno propio ni pide una API key. Instalá y logueá al menos uno
        de estos tres para empezar:
      </p>

      <ul className="mb-3 space-y-1.5">
        {AI_PROVIDER_IDS.map((provider) => {
          const meta = CLI_META[provider]
          return (
            <li key={provider} className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted">
              <span className="font-medium text-text">{AI_PROVIDER_CATALOG[provider].label}</span>
              <a
                href={meta.installUrl}
                target="_blank"
                rel="noreferrer"
                className="text-accent underline underline-offset-2 hover:text-accent/80"
              >
                instalación
              </a>
              <span>·</span>
              <span className="font-mono text-text">{meta.loginCmd}</span>
            </li>
          )
        })}
      </ul>

      <button
        type="button"
        onClick={onRecheck}
        disabled={loading}
        className="flex items-center gap-1.5 rounded-md border border-warning/40 px-2.5 py-1.5 text-xs font-medium text-warning transition-colors hover:bg-warning/15 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        Volver a comprobar
      </button>
    </div>
  )
}
