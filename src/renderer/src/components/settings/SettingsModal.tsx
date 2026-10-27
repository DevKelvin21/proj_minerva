import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '../../stores/app-store'
import { useSettings } from '../../hooks/use-settings'
import { useProviderStatus } from '../../hooks/use-provider-status'
import { useLayoutTier } from '../../hooks/use-layout-tier'
import type { AiProviderId } from '../../../../shared/ai-providers'
import type { AiProviderStatus, AiSettingsInfo } from '../../../../shared/types'
import { IconButton } from '../ui/IconButton'
import { ActiveConfigSummary } from './ActiveConfigSummary'
import { SourceControlSection } from './SourceControlSection'
import { ProviderTabs } from './ProviderTabs'
import { ProviderModelPanel } from './ProviderModelPanel'
import { UpdateSection } from './UpdateSection'
import { LanguageSection } from './LanguageSection'

/**
 * Modal de settings (T12; rediseñado en T62/F12: tabs por proveedor + strip
 * "En uso" en reemplazo de los radios de `ProviderPicker`/`ModelPicker`).
 * Diagnóstico que motivó el rediseño (ver `PLAN.md` § F12, pedido de
 * Edilson): con el diseño viejo nada enunciaba la config VIGENTE (el
 * proveedor se deducía de qué radio estaba marcada, el modelo ACTIVO se
 * confundía con el BORRADOR sin "Guardar" todavía) y para mirar los modelos
 * de otro proveedor había que cambiar el proveedor activo — acá "ver" y
 * "activar" son gestos distintos: las tabs solo cambian la vista, activar
 * es clickear una card de modelo (`ProviderModelPanel`).
 *
 * `App.tsx` solo monta este componente mientras `settingsOpen` es `true`
 * (`{settingsOpen && <SettingsModal />}`): al cerrar se desmonta por
 * completo, lo que resetea cualquier estado local (de este componente o de
 * sus hijos, incluido `viewedProvider` en `SettingsModalBody`) de forma
 * automática la próxima vez que se abra — el mismo patrón de "resetear vía
 * remount" que usa `DidacticPanel` con `useDidacticAnalysis`.
 *
 * Cierra con Esc o con un clic fuera de la card (el overlay tiene el
 * `onClick`; la card detiene la propagación).
 *
 * Responsive (F16/T80) — el modal era el peor caso reportado por Edilson:
 * antes SOLO `ProviderModelPanel` vivía dentro de un `overflow-y-auto`, así que
 * con la ventana tileada (p. ej. 960x540) el bloque de GitHub + "En uso" +
 * tabs excedía el `max-h-[85vh]` y las tabs y la lista de modelos quedaban
 * RECORTADAS SIN NINGÚN SCROLL QUE LAS ALCANZARA. Ahora:
 * - todo el cuerpo es scrolleable (`flex-1 min-h-0 overflow-y-auto`) y el
 *   header es `shrink-0`: nada puede volver a quedar inalcanzable;
 * - con ≥980px de ancho de ventana el contenido se reparte en DOS COLUMNAS
 *   (GitHub | IA), cada una con su scroll — en una ventana ancha y baja
 *   (1920x540, mitad horizontal) se ve todo de una sin scrollear, que es
 *   justamente lo que la pila vertical hacía imposible;
 * - con la ventana baja (`xshort`, <560px) el modal deja de ser una card
 *   centrada y pasa a ocupar la ventana entera: a esa altura, los márgenes de
 *   un modal centrado son espacio que no sobra.
 * Las secciones SIEMPRE están montadas (nunca un switcher que desmonte): los
 * specs e2e abren el modal y esperan ver "GitHub access" y sus cards sin
 * dar ningún click.
 */
export function SettingsModal(): React.JSX.Element {
  const { t } = useTranslation()
  const closeSettings = useAppStore((s) => s.closeSettings)
  const { info, error, selectProvider, saveModel, setModelOption } = useSettings()
  const providerStatus = useProviderStatus()
  const tier = useLayoutTier()
  const cardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') closeSettings()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [closeSettings])

  const isSheet = tier.h === 'xshort'
  const twoColumn = tier.width >= 980
  const sizeClass = isSheet
    ? 'h-full w-full max-w-[1000px]'
    : 'h-[min(88vh,700px)] w-full ' + (twoColumn ? 'max-w-[900px]' : 'max-w-lg')

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-2 sm:p-4"
      onClick={closeSettings}
    >
      <div
        ref={cardRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
        onClick={(e) => e.stopPropagation()}
        className={
          'flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-panel shadow-xl outline-none ' +
          sizeClass
        }
      >
        <header className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2.5">
          <h2 id="settings-modal-title" className="text-sm font-semibold text-text">
            {t('settings.modal.title')}
          </h2>
          <IconButton icon={<X size={16} />} label={t('settings.modal.close')} onClick={closeSettings} />
        </header>

        {info === null ? (
          <p className="p-4 text-xs text-muted">{t('common.loading')}</p>
        ) : (
          <SettingsModalBody
            info={info}
            error={error}
            statuses={providerStatus.statuses}
            statusLoading={providerStatus.loading}
            onRefetchStatus={providerStatus.refetch}
            selectProvider={selectProvider}
            saveModel={saveModel}
            setModelOption={setModelOption}
            twoColumn={twoColumn}
            compact={tier.h !== 'tall'}
          />
        )}
      </div>
    </div>
  )
}

interface SettingsModalBodyProps {
  info: AiSettingsInfo
  error: string | null
  statuses: Record<AiProviderId, AiProviderStatus> | null
  statusLoading: boolean
  onRefetchStatus: () => void
  selectProvider: (provider: AiProviderId) => Promise<boolean>
  saveModel: (provider: AiProviderId, model: string) => Promise<boolean>
  setModelOption: (provider: AiProviderId, optionId: string, value: string) => Promise<boolean>
  /** Reparte GitHub | IA en dos columnas con scroll propio (ventana ≥980px). */
  twoColumn: boolean
  /** Ventana baja (`short`/`xshort`): densidad reducida en las cabeceras de sección. */
  compact: boolean
}

/**
 * Cuerpo del modal, montado SOLO cuando `info` ya cargó: acá vive
 * `viewedProvider`, qué proveedor están VIENDO las tabs (independiente del
 * proveedor ACTIVO, `info.provider`). Vive en este componente hijo — no en
 * `SettingsModal` — a propósito: `SettingsModal` recién lo monta cuando
 * `info !== null`, así el lazy initializer `useState(info.provider)` siempre
 * arranca en el proveedor activo real, sin necesitar un efecto de
 * sincronización para "corregirlo" cuando `info` termina de cargar
 * (antipatrón que el lint react-hooks de este repo prohíbe).
 */
function SettingsModalBody({
  info,
  error,
  statuses,
  statusLoading,
  onRefetchStatus,
  selectProvider,
  saveModel,
  setModelOption,
  twoColumn,
  compact,
}: SettingsModalBodyProps): React.JSX.Element {
  const [viewedProvider, setViewedProvider] = useState<AiProviderId>(info.provider)

  // Primera sección no-IA del modal (T72, F14): "Acceso a GitHub" antes que
  // nada relacionado a proveedor/modelo. En una columna va arriba con
  // `border-b`; en dos columnas pasa a ser la columna izquierda y el separador
  // es el `border-r` del contenedor (F16/T80).
  const github = <SourceControlSection compact={compact} />

  // Idioma: primera sección del modal (arriba de todo en una columna; arriba
  // de la columna izquierda en dos).
  const language = <LanguageSection compact={compact} />

  // Sección "Actualizaciones" (T93, F17): en una columna va al final de todo
  // el scroll; en dos columnas (≥980px) va debajo de GitHub, la columna más
  // corta (mismo criterio que el PLAN.md § F17). Se automonta en `disabled`
  // (dev/e2e) — `UpdateSection` decide internamente no renderizar nada.
  const updates = <UpdateSection compact={compact} />

  const ai = (
    <>
      {/*
        "En uso" + tabs quedan PEGADOS arriba del scroller (T62 exigía que la
        config activa no se pierda de vista; F16 la mete dentro del área
        scrolleable, así que `sticky` es lo que conserva esa intención sin
        volver a bloquear el scroll).
      */}
      <div className="sticky top-0 z-10 bg-panel">
        <ActiveConfigSummary info={info} statuses={statuses} compact={compact} />
        <ProviderTabs info={info} statuses={statuses} viewed={viewedProvider} onChange={setViewedProvider} />
      </div>
      <ProviderModelPanel
        key={viewedProvider}
        info={info}
        viewedProvider={viewedProvider}
        statuses={statuses}
        statusLoading={statusLoading}
        error={error}
        onRefetchStatus={onRefetchStatus}
        saveModel={saveModel}
        selectProvider={selectProvider}
        setModelOption={setModelOption}
        wide={twoColumn}
      />
    </>
  )

  if (twoColumn) {
    return (
      <div className="flex min-h-0 flex-1">
        <div className="w-[40%] min-w-0 shrink-0 overflow-y-auto border-r border-border">
          <div className="border-b border-border">{language}</div>
          {github}
          {updates}
        </div>
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">{ai}</div>
      </div>
    )
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="border-b border-border">{language}</div>
      <div className="border-b border-border">{github}</div>
      {ai}
      {updates}
    </div>
  )
}
