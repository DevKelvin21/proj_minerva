import { RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { AI_PROVIDER_IDS, AI_PROVIDER_CATALOG } from '../../../../shared/ai-providers'
import { CLI_META } from '../../lib/cli-meta'
import { useAppStore } from '../../stores/app-store'
import { Button } from '../ui/Button'
import { Callout } from '../ui/Callout'

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
  const { t } = useTranslation()
  const openSettings = useAppStore((s) => s.openSettings)
  return (
    <Callout tone="warning">
      <p className="mb-1 text-sm font-medium text-text">{t('didactic.noCli.title')}</p>
      <p className="mb-3 text-xs text-muted">
        {t('didactic.noCli.body')}
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
                {t('didactic.noCli.install')}
              </a>
              <span>·</span>
              <span className="font-mono text-text">{meta.loginCmd}</span>
            </li>
          )
        })}
      </ul>

      <Button
        size="xs"
        onClick={onRecheck}
        disabled={loading}
        icon={<RefreshCw size={12} className={loading ? 'animate-spin motion-reduce:animate-none' : ''} />}
      >
        {t('didactic.noCli.recheck')}
      </Button>
      <Button size="xs" variant="ghost" className="ml-1.5" onClick={() => openSettings('ai-providers')}>
        {t('settings.openAt.aiProviders')}
      </Button>
    </Callout>
  )
}
