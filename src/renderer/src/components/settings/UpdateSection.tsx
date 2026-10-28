import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Trans, useTranslation } from 'react-i18next'
import type { AppLocale } from '../../../../shared/locale'
import { useLocale } from '../../i18n/use-locale'
import { useUpdater } from '../../hooks/use-updater'
import { Button } from '../ui/Button'
import type { UpdaterStatus } from '../../../../shared/types'

type UnsupportedReason = Extract<UpdaterStatus, { phase: 'unsupported' }>['reason']

/** Texto honesto de por qué ESTA instalación no puede auto-actualizarse (T93): clave de `updater.unsupportedReasons`. */
const UNSUPPORTED_REASON_KEY = {
  'mac-unsigned': 'macUnsigned',
  'not-appimage': 'notAppimage',
  'not-writable': 'notWritable',
} as const satisfies Record<UnsupportedReason, string>

function formatCheckedAt(iso: string, locale: AppLocale): string {
  return new Date(iso).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })
}

interface UpdateSectionProps {
  /** Ventana baja (F16): recorta el texto explicativo, no los controles — mismo criterio que `GithubAccessSection`. */
  compact?: boolean
}

/**
 * Sección "Actualizaciones" del modal de Settings (T93, F17).
 *
 * Cubre los 8 `phase` de `UpdaterStatus` (`shared/types.ts`):
 * - `disabled` (y mientras el estado inicial no cargó): el componente
 *   devuelve `null` — no se monta NADA, es el estado real en dev y en TODA la
 *   suite e2e (el core real vive en `main/updater/`, T91).
 * - `idle`/`checking`/`error` comparten una fila: mensaje a la izquierda
 *   (según fase) + un único botón a la derecha que cambia de label
 *   ("Buscar actualizaciones" / deshabilitado mientras chequea / "Reintentar"
 *   en error) — evita duplicar tres botones casi iguales.
 * - `available`: CTA "Descargar (130 MB)" — la descarga NUNCA arranca sola,
 *   necesita este click (decisión de producto, ver `PLAN.md` § F17).
 * - `downloading`: barra de progreso con `percent`, sin botón.
 * - `downloaded`: el mensaje PRINCIPAL es que se instala sola al salir;
 *   "Reiniciar ahora" es a propósito un link-button subordinado (texto
 *   pequeño subrayado), no el CTA — invertir esa jerarquía contradice la
 *   decisión de producto ("instalar al salir" es el camino por defecto).
 * - `unsupported`: nunca un botón de descarga; si el feed ya encontró una
 *   versión más nueva (`available`), se ofrece "Ver la release"
 *   (`openReleasePage`, que construye la URL en MAIN — nunca desde el feed).
 *
 * Las release notes NO se renderizan en ningún estado (vienen de GitHub como
 * HTML crudo — ver la frontera de seguridad del `PLAN.md`/`CLAUDE.md`): el
 * único camino a esa información es `openReleasePage()`.
 */
export function UpdateSection({ compact = false }: UpdateSectionProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const { locale } = useLocale()
  const { status, version, error, check, download, quitAndInstall, openReleasePage } = useUpdater()
  const [restarting, setRestarting] = useState(false)
  const [openingRelease, setOpeningRelease] = useState(false)

  if (status === null || status.phase === 'disabled') return null

  const checking = status.phase === 'checking'
  const showCheckRow = status.phase === 'idle' || status.phase === 'checking' || status.phase === 'error'

  async function handleRestart(): Promise<void> {
    setRestarting(true)
    await quitAndInstall()
    setRestarting(false)
  }

  async function handleOpenRelease(): Promise<void> {
    setOpeningRelease(true)
    await openReleasePage()
    setOpeningRelease(false)
  }

  return (
    <div className="border-t border-border p-4">
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
        {t('updater.title')}
      </h3>
      {!compact && (
        <p className="mb-3 text-xs text-muted">
          {t('updater.intro')}
        </p>
      )}

      <p className="text-xs text-muted">
        <Trans
          i18nKey="updater.installedVersion"
          values={{ version: version ?? '…' }}
          components={{ mono: <span className="font-mono text-text" /> }}
        />
      </p>

      <div className="mt-2.5 space-y-2">
        {showCheckRow && (
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              {status.phase === 'idle' && (
                <>
                  <p className="text-sm text-text">{t('updater.upToDate')}</p>
                  {status.lastCheckedAt && (
                    <p className="text-[11px] text-muted">
                      {t('updater.lastChecked', {
                        date: formatCheckedAt(status.lastCheckedAt, locale),
                      })}
                    </p>
                  )}
                </>
              )}
              {status.phase === 'checking' && (
                <p className="flex items-center gap-1.5 text-xs text-muted">
                  <Loader2 size={13} className="animate-spin" />
                  {t('updater.checking')}
                </p>
              )}
              {status.phase === 'error' && (
                <>
                  <p role="alert" className="text-xs text-danger">
                    {status.message}
                  </p>
                  {status.lastCheckedAt && (
                    <p className="text-[11px] text-muted">
                      {t('updater.lastSuccessfulCheck', {
                        date: formatCheckedAt(status.lastCheckedAt, locale),
                      })}
                    </p>
                  )}
                </>
              )}
            </div>
            <Button disabled={checking} onClick={() => void check()}>
              {status.phase === 'error' ? t('updater.retry') : t('updater.check')}
            </Button>
          </div>
        )}

        {status.phase === 'available' && (
          <div className="flex items-center justify-between gap-2">
            <p className="min-w-0 truncate text-sm text-text">
              {t('updater.available', { version: status.info.version })}
            </p>
            <Button variant="primary" onClick={() => void download()}>
              {t('updater.download')}
            </Button>
          </div>
        )}

        {status.phase === 'downloading' && (
          <div>
            <p className="mb-1 truncate text-sm text-text">
              {t('updater.downloading', { version: status.info.version })}
            </p>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-border/60">
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-150"
                style={{ width: Math.max(0, Math.min(100, status.percent)) + '%' }}
              />
            </div>
            <p className="mt-1 text-[11px] text-muted">{Math.round(status.percent)}%</p>
          </div>
        )}

        {status.phase === 'downloaded' && (
          <div>
            <p className="text-sm text-text">{t('updater.installOnQuit')}</p>
            <Button
              variant="link"
              size="xs"
              disabled={restarting}
              onClick={() => void handleRestart()}
              className="mt-1"
            >
              {t('updater.restartNow')}
            </Button>
          </div>
        )}

        {/*
          `unsupported` va en COLUMNA, no en fila: con dos botones al lado, el
          texto explicativo se estrangula a una tira de ~35px en el modal
          angosto (visto en captura). Acá el mensaje manda y los controles van
          debajo.
        */}
        {status.phase === 'unsupported' && (
          <div className="flex flex-col gap-2">
            <p className="min-w-0 text-xs text-muted">
              {t('updater.unsupported', {
                reason: t(`updater.unsupportedReasons.${UNSUPPORTED_REASON_KEY[status.reason]}`),
              })}
            </p>
            {/*
              El chequeo manual TAMBIÉN vive acá: `unsupported` sigue
              consultando el feed (solo no descarga ni instala), así que sin
              este botón no habría forma de pedirlo a mano y habría que esperar
              al tick del scheduler para que aparezca "Ver la release".
            */}
            <div className="flex flex-wrap items-center gap-1.5">
              <Button onClick={() => void check()}>{t('updater.check')}</Button>
              {status.available && (
                <Button
                  variant="primary"
                  disabled={openingRelease}
                  onClick={() => void handleOpenRelease()}
                >
                  {t('updater.viewRelease')}
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
