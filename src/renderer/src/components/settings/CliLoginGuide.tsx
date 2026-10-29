import { Trans, useTranslation } from 'react-i18next'
import type { AiProviderStatus } from '../../../../shared/types'
import { CLI_META, type CliProvider } from '../../lib/cli-meta'

/** Enlace externo consistente con el resto del design system (`Markdown.tsx`/`TitleBar.tsx`): `target="_blank"` lo intercepta `external-link-guard` en main y lo abre en el navegador del sistema. */
function ExternalLink({
  href,
  children,
}: {
  href: string
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-accent underline underline-offset-2 hover:text-accent/80"
    >
      {children}
    </a>
  )
}

interface CliLoginGuideProps {
  provider: CliProvider
  status: AiProviderStatus | undefined
}

/**
 * Guía de login para proveedores que se autentican vía CLI externo (los
 * TRES desde T57/T60: `claude`/`codex`/`opencode`): el login sucede FUERA de
 * Minerva (el renderer no puede spawnear procesos ni el main puede leer la
 * sesión sin el handshake real de T28/T29/T56), así que acá solo se muestra
 * el comando a correr + un enlace real de instalación (`installUrl`, T60) y
 * (Settings › AI › Providers pone al lado el botón que vuelve a pedir
 * `ai:getProviderStatus`, uno para los tres proveedores).
 *
 * Copy de `installed` DISTINTO para `opencode` (T60, decisión de Edilson): a
 * diferencia de Claude Code/Codex (donde `installed` = "CLI ahí pero sin
 * sesión"), en OpenCode ese estado significa "el server local respondió pero
 * NINGÚN upstream de modelos está conectado" (ver `provider-status.ts`) — el
 * comando `opencode auth login` conecta un PROVEEDOR DE MODELOS (Anthropic,
 * OpenAI, un gateway, etc.), no "inicia sesión del CLI" en el sentido en que
 * lo hacen `claude login`/`codex login`.
 */
export function CliLoginGuide({ provider, status }: CliLoginGuideProps): React.JSX.Element {
  const { t } = useTranslation()
  const meta = CLI_META[provider]
  const value = status?.status ?? 'unavailable'
  const mono = <span className="font-mono text-text" />
  const docs = <ExternalLink href={meta.installUrl} />

  return (
    <div className="min-w-0">
      {value === 'unavailable' && status?.reason === 'probe-failed' && (
        <p className="text-xs text-muted">
          {status.resolvedPath ? (
            <Trans
              i18nKey="settings.cliGuide.probeFailedAt"
              values={{ binary: meta.binary, path: status.resolvedPath }}
              components={{ mono, path: <span className="font-mono text-text break-all" /> }}
            />
          ) : (
            <Trans
              i18nKey="settings.cliGuide.probeFailed"
              values={{ binary: meta.binary }}
              components={{ mono }}
            />
          )}
        </p>
      )}
      {value === 'unavailable' && status?.reason !== 'probe-failed' && (
        <p className="text-xs text-muted">
          <Trans
            i18nKey="settings.cliGuide.notFound"
            values={{ binary: meta.binary }}
            components={{ mono, docs }}
          />
        </p>
      )}
      {value === 'installed' && provider === 'opencode' && (
        <p className="text-xs text-muted">
          <Trans
            i18nKey="settings.cliGuide.opencodeNoProvider"
            values={{ command: meta.loginCmd }}
            components={{ mono, docs }}
          />
        </p>
      )}
      {value === 'installed' && provider !== 'opencode' && (
        <p className="text-xs text-muted">
          <Trans
            i18nKey="settings.cliGuide.noSession"
            values={{ command: meta.loginCmd }}
            components={{ mono }}
          />
        </p>
      )}
      {value === 'authenticated' && (
        <p className="text-xs text-muted">
          {t('settings.cliGuide.connected', {
            details:
              (status?.account?.plan
                ? t('settings.cliGuide.planDetail', { plan: status.account.plan })
                : '') + (status?.account?.email ? ' · ' + status.account.email : ''),
          })}
        </p>
      )}
    </div>
  )
}
