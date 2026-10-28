import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { findModelInList, type AiProviderId } from '../../../../shared/ai-providers'
import type { AiProviderStatus, AiSettingsInfo } from '../../../../shared/types'
import { useProviderModels } from '../../hooks/use-provider-models'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { ModelOptionPicker } from './ModelOptionPicker'
import { CliLoginGuide } from './CliLoginGuide'

interface ProviderModelPanelProps {
  info: AiSettingsInfo
  viewedProvider: AiProviderId
  statuses: Record<AiProviderId, AiProviderStatus> | null
  statusLoading: boolean
  error: string | null
  onRefetchStatus: () => void
  saveModel: (provider: AiProviderId, model: string) => Promise<boolean>
  selectProvider: (provider: AiProviderId) => Promise<boolean>
  setModelOption: (provider: AiProviderId, optionId: string, value: string) => Promise<boolean>
  /** Modal en dos columnas (F16/T81): las cards de modelo se pintan en grid de 2. */
  wide?: boolean
}

/**
 * Contenido del tab visto (`viewedProvider`, T62/F12): lista de modelos como
 * CARDS clickeables — sin radios ni botón "Guardar" aparte, click = activar
 * ese proveedor+modelo en un solo gesto — más "Otro (avanzado)" para
 * OpenCode, el selector de razonamiento del modelo ACTIVO (`ModelOptionPicker`,
 * intacto) y la guía de login del CLI.
 *
 * `SettingsModal` lo monta con `key={viewedProvider}`: cambiar de tab
 * remonta este componente desde cero, así `useProviderModels` re-fetchea sin
 * necesitar un efecto de sincronización (prohibido por el lint react-hooks
 * de este repo) y el estado local (`activating`, el input de "Otro") arranca
 * limpio para el proveedor nuevo — incluido el prefill del input "Otro" con
 * `info.model` cuando corresponde, vía lazy initializer de `useState` (el
 * remount garantiza que ese initializer siempre ve el `info` correcto).
 *
 * Activar (click en una card o "Usar" del campo "Otro"): `saveModel(viewedProvider,
 * modelId)` y, SOLO si el tab visto no era ya el proveedor activo,
 * `selectProvider(viewedProvider)` a continuación — dos canales IPC
 * existentes (`settings:setProviderModel`/`settings:setAiProvider`), sin IPC
 * nuevo. El proveedor "estaba activo" se captura ANTES del primer `await`
 * (`wasActive`) porque `info.provider` puede cambiar entre renders una vez
 * que `saveModel` resuelve.
 */
export function ProviderModelPanel({
  info,
  viewedProvider,
  statuses,
  statusLoading,
  error,
  onRefetchStatus,
  saveModel,
  selectProvider,
  setModelOption,
  wide = false,
}: ProviderModelPanelProps): React.JSX.Element {
  const { t } = useTranslation()
  const fallbackModels = info.catalog[viewedProvider].models
  const { models, error: modelsError } = useProviderModels(viewedProvider, fallbackModels)

  const isActiveTab = viewedProvider === info.provider
  const allowCustom = viewedProvider === 'opencode'
  // Matcheo por id exacto y, si no, por `aliasFor` (F19): el catálogo dinámico
  // de Claude Code devuelve filas alias (`sonnet`, `opus[1m]`) mientras en
  // `settings.json` puede estar persistido el id canónico que el catálogo
  // curado ofrecía (`claude-sonnet-5`). Sin esto, esa selección no marcaba
  // ninguna card como "Activo" ni pintaba el selector de razonamiento.
  const matchedActiveModel = findModelInList(models, info.model)
  const customIsActive = isActiveTab && allowCustom && matchedActiveModel === undefined

  const [activating, setActivating] = useState<string | null>(null)
  const [activateError, setActivateError] = useState<string | null>(null)
  const [customValue, setCustomValue] = useState(() => (customIsActive ? info.model : ''))

  const anyActivating = activating !== null
  const activeModel = isActiveTab ? matchedActiveModel : undefined

  async function activate(rawModelId: string): Promise<void> {
    const modelId = rawModelId.trim()
    if (!modelId || anyActivating) return
    if (isActiveTab && modelId === info.model) return

    setActivating(modelId)
    setActivateError(null)
    const wasActive = isActiveTab

    let ok = await saveModel(viewedProvider, modelId)
    if (ok && !wasActive) {
      ok = await selectProvider(viewedProvider)
    }

    setActivating(null)
    if (!ok) setActivateError(t('settings.models.activateError'))
  }

  return (
    <div
      role="tabpanel"
      id={'settings-tabpanel-' + viewedProvider}
      aria-labelledby={'settings-tab-' + viewedProvider}
      className="p-4"
    >
      <p className="mb-3 text-xs text-muted">
        {t('settings.models.intro', { provider: info.catalog[viewedProvider].label })}
      </p>

      {modelsError && (
        <p className="mb-2 text-xs text-muted">
          {t('settings.models.refreshFailed', { error: modelsError })}
        </p>
      )}

      {/* Grid de 2 columnas solo en el modal ancho (F16/T81): con 6-8 modelos,
          una columna única obligaba a scrollear el doble en ventanas bajas. */}
      <div className={wide ? 'grid grid-cols-2 gap-2' : 'space-y-2'}>
        {models.map((model) => {
          const isModelActive = isActiveTab && model === matchedActiveModel
          const isThisActivating = activating === model.id

          return (
            <button
              key={model.id}
              type="button"
              disabled={anyActivating}
              onClick={() => void activate(model.id)}
              className={`flex w-full items-start justify-between gap-2.5 rounded-md border p-2.5 text-left transition-colors duration-150 ${
                isModelActive ? 'border-accent/50 bg-accent/10' : 'border-border hover:border-accent/30'
              } ${anyActivating ? 'opacity-60' : ''}`}
            >
              {/* `min-w-0` + `truncate`: los slugs de OpenCode
                  (`openrouter/z-ai/glm-…`) desbordaban la card en columnas
                  angostas y estiraban el modal entero (F16/T81). */}
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm text-text">
                  {model.label} <span className="text-muted">· {model.vendor}</span>
                </span>
                <span className="truncate font-mono text-[11px] text-muted">{model.id}</span>
              </span>
              {isThisActivating ? (
                <Loader2 size={14} className="mt-0.5 shrink-0 animate-spin text-muted" />
              ) : isModelActive ? (
                <Badge tone="success">{t('settings.models.active')}</Badge>
              ) : null}
            </button>
          )
        })}

        {allowCustom && (
          <div
            className={`rounded-md border p-2.5 transition-colors duration-150 ${
              wide ? 'col-span-2' : ''
            } ${customIsActive ? 'border-accent/50 bg-accent/10' : 'border-border'} ${
              anyActivating ? 'opacity-60' : ''
            }`}
          >
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="text-sm text-text">{t('settings.models.custom')}</span>
              {customIsActive && <Badge tone="success">{t('settings.models.active')}</Badge>}
            </div>
            <div className="flex gap-1.5">
              <Input
                fieldSize="sm"
                mono
                value={customValue}
                onChange={(event) => setCustomValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void activate(customValue)
                }}
                disabled={anyActivating}
                aria-label={t('settings.models.custom')}
                placeholder={
                  viewedProvider === 'opencode' ? t('settings.models.customPlaceholderOpencode') : ''
                }
                maxLength={100}
                className="w-full min-w-0"
              />
              <Button
                disabled={anyActivating || customValue.trim().length === 0}
                onClick={() => void activate(customValue)}
                icon={
                  activating === customValue.trim() ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : undefined
                }
              >
                {t('settings.models.use')}
              </Button>
            </div>
          </div>
        )}
      </div>

      {(activateError ?? error) && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {activateError ?? error}
        </p>
      )}

      {isActiveTab ? (
        activeModel?.options && activeModel.options.length > 0 && (
          <ModelOptionPicker
            key={info.provider + '/' + info.model}
            provider={info.provider}
            model={activeModel}
            selected={info.selectedOptions?.[info.provider] ?? {}}
            onSelect={setModelOption}
          />
        )
      ) : (
        <p className="mt-3 text-[11px] text-muted">{t('settings.models.reasoningOnActive')}</p>
      )}

      <CliLoginGuide
        provider={viewedProvider}
        status={statuses?.[viewedProvider]}
        loading={statusLoading}
        onRecheck={onRefetchStatus}
      />
    </div>
  )
}
