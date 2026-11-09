import { Icon } from './components/ui/Icon'
import { icons } from './components/ui/icons'
import type { DidacticRouteTarget } from '../../shared/didactic-route'
import { DidacticAnalysisArea } from './components/didactic/DidacticAnalysisArea'
import { usePrHeadSha } from './hooks/use-pr-head-sha'
import { useLayoutTier } from './hooks/use-layout-tier'

interface DidacticWindowAppProps {
  target: DidacticRouteTarget
}

/**
 * Renderer alternativo montado en la ventana didáctica desacoplada (T14):
 * `main.tsx` decide entre esto y `<App>` mirando `location.hash` con
 * `parseDidacticHash` (`../../shared/didactic-route.ts`). Carga el MISMO
 * bundle que la ventana principal — no hay un entry point ni un
 * `electron.vite.config.ts` distinto para esta vista.
 *
 * Layout de una sola columna ancha (max-w 900px centrado), reutilizando el
 * MISMO `DidacticAnalysisArea` del panel principal: al montar, el hook
 * `useDidacticAnalysis` hace "auto-attach" siempre (T22) — pinta un análisis
 * ya cacheado, se engancha a uno en curso streameando en otra ventana, o cae
 * al mismo botón "Analizar PR" de siempre si no hay nada. El hint del modelo
 * activo y el botón "Re-analizar" vienen incluidos en `DidacticAnalysisArea`
 * (aparecen junto al contenido en cuanto hay un resultado que mostrar).
 */
export function DidacticWindowApp({ target }: DidacticWindowAppProps): React.JSX.Element {
  const prLabel = target.repo.fullName + '#' + target.number
  // T42 (Issue 2): esta ventana no recibe el `PullRequestSummary` (solo
  // `repo`+`number`+`title` en el hash), así que no tiene `headSha` gratis
  // como `DidacticPanel` — un fetch liviano y único al montar lo consigue.
  const { headSha: currentHeadSha } = usePrHeadSha(target.repo, target.number)
  // F16/T87: esta ventana admite 520px de ancho (tiling de tres columnas), donde
  // `p-6` + título de 18px desperdiciaban buena parte del renglón.
  const tier = useLayoutTier()
  const narrow = tier.w === 'sm'

  return (
    <div className="flex h-full flex-col items-center overflow-y-auto bg-bg">
      <div className={`flex w-full max-w-[900px] flex-col gap-3 ${narrow ? 'p-3' : 'p-6'}`}>
        <header className="flex flex-col gap-0.5 border-b border-border pb-3">
          <span
            className={`flex items-center gap-2 font-semibold text-text ${
              narrow ? 'text-base' : 'text-lg'
            }`}
          >
            <Icon icon={icons.didactic} size={narrow ? 'md' : 'lg'} className="shrink-0 text-muted" />
            {target.title ?? prLabel}
          </span>
          <span className="text-xs text-muted">{prLabel}</span>
        </header>

        <DidacticAnalysisArea
          repo={target.repo}
          number={target.number}
          currentHeadSha={currentHeadSha ?? undefined}
        />
      </div>
    </div>
  )
}
