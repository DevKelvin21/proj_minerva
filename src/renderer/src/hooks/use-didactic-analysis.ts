import { useCallback, useEffect, useRef, useState } from 'react'
import type { DidacticAnalysis, RepoRef } from '../../../shared/types'
import type { AnalysisActivityItem, DraftDidacticSection } from '../../../shared/events'
import { repoKey, sameRepo } from '../../../shared/scm'

interface DidacticAnalysisTarget {
  repo: RepoRef
  number: number
}

interface UseDidacticAnalysisResult {
  analysis: DidacticAnalysis | null
  /**
   * Snapshot EN VIVO del análisis mientras streamea (T13): `null` hasta que
   * llega el primer chunk de progreso. Deja de importar en cuanto `analysis`
   * (el resultado final) queda seteado — quien consume este hook debe
   * preferir `analysis` sobre `streamingSections` si ambos están presentes.
   */
  streamingSections: DraftDidacticSection[] | null
  /**
   * Última fase (`AnalysisProgressEvent.phase`, T60) recibida DURANTE un
   * streaming en curso — `'exploring'`/`'writing'` para los tres proveedores
   * agénticos, `null` para el mock (nunca la manda) o mientras no llegó
   * ningún chunk todavía. Quien consume este hook la usa junto con
   * `streamingSections` para distinguir "explorando el repo, sin secciones
   * todavía" (`phase === 'exploring'` con `streamingSections` vacío) de
   * "generando contenido" (ver `DidacticAnalysisArea`).
   */
  phase: 'exploring' | 'writing' | null
  /**
   * Mini-log de actividad del harness (F13, `AnalysisProgressEvent.activity`):
   * buffer rodante con las últimas acciones internas del agente, `null`
   * cuando no hay análisis en curso (o el proveedor no lo emite). Los labels
   * vienen YA derivados y saneados desde main — se pintan tal cual. Efímero:
   * el evento terminal (`done: true`) lo limpia SIEMPRE, con éxito o error.
   */
  activity: AnalysisActivityItem[] | null
  /** `true` mientras se consulta `ai:getAnalysisState` al montar (ver el efecto de "attach" más abajo). */
  checkingCache: boolean
  loading: boolean
  error: string | null
  analyze: () => void
  /**
   * Botón "Re-analizar" (T14): descarta la entrada de cache de este PR
   * (`ai:invalidateAnalysis`) y relanza `analyze()` a continuación — útil
   * para comparar modelos tras cambiarlo en Settings sin reiniciar la app.
   * Si `ai:invalidateAnalysis` fallara (no debería: solo borra una entrada de
   * un `Map` en memoria de main), se relanza igual el análisis.
   */
  reanalyze: () => void
}

function toErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  // Un rechazo de `ipcRenderer.invoke` llega envuelto por Electron como
  // "Error invoking remote method 'ai:...': Error: <mensaje real>". Ese
  // prefijo es ruido para el usuario (el canal IPC no le dice nada) y ya
  // main garantiza un mensaje limpio y accionable (`main/ipc/register.ts`).
  return raw.replace(/^Error invoking remote method '[^']*': (?:Error: )?/, '')
}

/**
 * Análisis didáctico de un PR vía `ai:analyzePullRequest`. A diferencia de
 * los demás hooks de datos (`use-pull-request-detail.ts`, etc.) NO se
 * dispara automáticamente al montar disparando una llamada nueva: el usuario
 * pulsa "Analizar PR" explícitamente (la versión real con IA tiene
 * costo/latencia no trivial) — lo que SÍ hace siempre al montar (T22, ver el
 * efecto de "attach" más abajo) es preguntarle a main por el ESTADO de un
 * análisis que ya exista para este PR, sin generar ninguno nuevo.
 *
 * T22 (auto-attach, reemplaza la antigua opción `autoLoadFromCache` que solo
 * usaba la ventana desacoplada): el hook mantiene una suscripción a
 * `onAnalysisProgress` VIVA DURANTE TODO EL MONTAJE (no solo si montó a
 * mitad de un streaming) y además consulta `ai:getAnalysisState` al montar:
 * - `cached`: pinta el resultado directo (`setAnalysis`).
 * - `streaming`: pinta el último snapshot conocido (`setStreamingSections`);
 *   los siguientes chunks llegan por la suscripción permanente.
 * - `idle`: se queda en el placeholder — pero si MÁS TARDE otro proceso
 *   arranca un análisis de este PR (el panel acoplado reabierto, otra
 *   ventana), los eventos de progreso llegan igual y esta superficie se
 *   engancha sola. Este caso no es teórico: la ventana desacoplada
 *   REUTILIZADA para el MISMO PR no dispara `hashchange` (el hash no cambia),
 *   así que no hay remount — sin la suscripción permanente quedaba sorda
 *   mostrando el placeholder mientras el análisis corría delante de ella
 *   (bug encontrado en la verificación visual de T22).
 * El evento terminal (`done: true`) trae `error` si el análisis falló
 * (`setError`); si no, se relee `ai:getCachedAnalysis` (el handler garantiza
 * que para ese momento el cache YA está poblado, ver
 * `src/main/ipc/handlers.ts`) y se pinta con `setAnalysis` — si diera `null`
 * (no debería pasar nunca) el hook se queda con el último snapshot streameado
 * en vez de perder contenido. Un chunk de un análisis NUEVO (otro proceso
 * re-analizó este PR) también limpia `analysis`/`error` viejos: la superficie
 * se re-sincroniza con lo que está pasando AHORA, que es el contrato del panel.
 *
 * Prioridad entre el attach pasivo y un `analyze()` LOCAL: `analyze()` gana
 * mientras está en vuelo. `localAnalysisActive` (ref) se enciende
 * síncronamente en `analyze()` y se apaga en su `finally`; mientras está
 * encendida, el listener permanente ignora todos los eventos (el flujo local
 * tiene su propio listener con su propio `requestSeq`, como siempre). Al
 * apagarse vuelve a aplicar eventos futuros — un re-análisis lanzado en OTRA
 * ventana después vuelve a sincronizar esta superficie.
 *
 * La suscripción permanente se limpia al desmontar (cleanup de su efecto); la
 * del flujo local, al terminar `analyze()` (éxito o error) y también al
 * desmontar (efecto de `stopStreaming`) — sin esto, un cambio de PR a mitad
 * de un streaming (que remonta este hook vía `key`, ver
 * `DidacticAnalysisArea`) dejaría un listener de `ipcRenderer` vivo para
 * siempre.
 *
 * Este hook asume que `target` es estable mientras el componente que lo usa
 * esté montado: NO resetea su propio estado si `target` cambia en caliente.
 * Para "volver al placeholder al cambiar de PR", quien lo consume debe
 * remontar el componente con un `key` distinto por PR (`DidacticPanel` usa
 * `key={selectedPr.id}` en `DidacticAnalysisArea`) — es el patrón que React
 * recomienda para resetear todo el estado de una entidad de una vez, y evita
 * los antipatrones que el linter de hooks marca ahora (`set-state-in-effect`
 * para resets vía efecto, `refs` para comparar "valor anterior" en el
 * cuerpo del render).
 */
export function useDidacticAnalysis(target: DidacticAnalysisTarget): UseDidacticAnalysisResult {
  const targetRepoKey = repoKey(target.repo)
  const [analysis, setAnalysis] = useState<DidacticAnalysis | null>(null)
  const [streamingSections, setStreamingSections] = useState<DraftDidacticSection[] | null>(null)
  const [phase, setPhase] = useState<'exploring' | 'writing' | null>(null)
  const [activity, setActivity] = useState<AnalysisActivityItem[] | null>(null)
  const [checkingCache, setCheckingCache] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestSeq = useRef(0)
  const unsubscribeRef = useRef<(() => void) | null>(null)
  /** `true` mientras un `analyze()` LOCAL está en vuelo (ver comentario de cabecera: el listener permanente cede ante el flujo local). */
  const localAnalysisActive = useRef(false)

  const stopStreaming = useCallback(() => {
    unsubscribeRef.current?.()
    unsubscribeRef.current = null
  }, [])

  // Cleanup al desmontar (no solo al terminar un flujo de streaming, ver
  // comentario de cabecera): sin esto, un remount por cambio de PR a mitad de
  // un streaming dejaría el listener de `ipcRenderer` suscrito para siempre.
  useEffect(() => stopStreaming, [stopStreaming])

  // Attach pasivo (T22, ver comentario de cabecera): un listener de progreso
  // PERMANENTE durante todo el montaje + una consulta de estado inicial.
  // `setState` ocurre solo dentro de callbacks de promesa/evento, nunca de
  // forma síncrona en el cuerpo del efecto, para no caer en el antipatrón
  // que marca `react-hooks/set-state-in-effect`.
  useEffect(() => {
    let cancelled = false

    const unsubscribe = window.minerva.events.onAnalysisProgress((event) => {
      // El flujo local de `analyze()` tiene prioridad mientras está en
      // vuelo: tiene su propio listener con su propio `requestSeq`.
      if (cancelled || localAnalysisActive.current) return
      if (!sameRepo(event.repo, target.repo) || event.number !== target.number) {
        return
      }

      if (!event.done) {
        // Chunk de un análisis en curso (arrancado por otra superficie):
        // esta se re-sincroniza con él, descartando resultado/error viejos.
        setAnalysis(null)
        setError(null)
        setStreamingSections(event.sections)
        setPhase(event.phase ?? null)
        setActivity(event.activity ?? null)
        return
      }

      // Terminal (éxito o error): el mini-log es efímero, desaparece SIEMPRE.
      setActivity(null)
      if (event.error) {
        setError(event.error)
        return
      }
      // El handler garantiza que al emitir `done: true` sin `error` el
      // cache YA está poblado (`src/main/ipc/handlers.ts`); si por lo que
      // sea diera `null`, nos quedamos con el último snapshot en vez de
      // perder el contenido ya streameado.
      void window.minerva.ai
        .getCachedAnalysis({ repo: target.repo, number: target.number })
        .then((cachedResult) => {
          if (cancelled || localAnalysisActive.current) return
          if (cachedResult) {
            setAnalysis(cachedResult)
            setStreamingSections(null)
          }
        })
        .catch(() => {
          // Best-effort: se queda con el último snapshot streameado.
        })
    })

    void window.minerva.ai
      .getAnalysisState({ repo: target.repo, number: target.number })
      .then((state) => {
        if (cancelled || localAnalysisActive.current) return

        if (state.status === 'cached') {
          // `prev ?? ...`: si un evento terminal del listener de arriba ya
          // pintó un resultado mientras esta consulta estaba en vuelo, ese
          // es más fresco — no pisarlo con la respuesta más vieja.
          setAnalysis((prev) => prev ?? state.analysis)
          return
        }

        if (state.status === 'streaming') {
          // Mismo criterio: si ya llegó un chunk por el listener permanente,
          // ese snapshot es más nuevo que el de esta respuesta.
          setStreamingSections((prev) => prev ?? state.sections)
          // Late-attach del mini-log (F13): el estado in-flight de main trae
          // el buffer actual — así esta superficie pinta "qué está pasando"
          // de inmediato en vez de esperar al próximo evento de actividad.
          setActivity((prev) => prev ?? state.activity ?? null)
        }
        // `idle`: no hay nada que mostrar todavía, se queda en el
        // placeholder; si un análisis arranca después en otra superficie,
        // el listener permanente de arriba lo captura igual.
      })
      .catch(() => {
        // Best-effort: si falla la consulta, se queda en el placeholder
        // normal (el usuario puede pulsar "Analizar PR" igual).
      })
      .finally(() => {
        if (!cancelled) setCheckingCache(false)
      })

    return () => {
      cancelled = true
      unsubscribe()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- monta una sola vez por entidad (remount por key en DidacticPanel/DidacticWindowApp, ver comentario de cabecera); `target` es estable mientras el componente sigue montado.
  }, [targetRepoKey, target.number])

  const analyze = useCallback(() => {
    const seq = ++requestSeq.current
    // Cede la prioridad al flujo local (el listener permanente del efecto de
    // attach ignora eventos mientras esté encendida, ver cabecera).
    localAnalysisActive.current = true
    setLoading(true)
    setError(null)
    setStreamingSections(null)
    setPhase(null)
    setActivity(null)
    // Limpia también el resultado viejo: la precedencia de render es
    // `analysis > streamingSections`, así que sin esto un re-análisis
    // streamearía invisible detrás del contenido anterior y el swap final
    // sería un cambio silencioso (no se distingue "actualizando" de "listo").
    setAnalysis(null)

    stopStreaming()
    unsubscribeRef.current = window.minerva.events.onAnalysisProgress((event) => {
      if (requestSeq.current !== seq) return
      if (!sameRepo(event.repo, target.repo) || event.number !== target.number) {
        return
      }
      setStreamingSections(event.sections)
      setPhase(event.phase ?? null)
      setActivity(event.done ? null : (event.activity ?? null))
    })

    void (async () => {
      try {
        const result = await window.minerva.ai.analyzePullRequest({
          repo: target.repo,
          number: target.number,
        })
        if (requestSeq.current === seq) {
          setAnalysis(result)
          setStreamingSections(null)
          setActivity(null)
        }
      } catch (err: unknown) {
        if (requestSeq.current === seq) setError(toErrorMessage(err))
      } finally {
        if (requestSeq.current === seq) {
          // Devuelve la prioridad al listener permanente: un análisis
          // futuro lanzado por OTRA superficie vuelve a sincronizar esta.
          localAnalysisActive.current = false
          setLoading(false)
          stopStreaming()
        }
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- se depende de campos primitivos de `target`, no de su identidad de objeto.
  }, [targetRepoKey, target.number, stopStreaming])

  const reanalyze = useCallback(() => {
    void (async () => {
      try {
        await window.minerva.ai.invalidateAnalysis({ repo: target.repo, number: target.number })
      } catch {
        // Invalidar no debería fallar nunca (solo borra una entrada de un
        // `Map` en memoria de main); si lo hiciera, se relanza el análisis igual.
      }
      analyze()
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- se depende de campos primitivos de `target`, no de su identidad de objeto.
  }, [targetRepoKey, target.number, analyze])

  return {
    analysis,
    streamingSections,
    phase,
    activity,
    checkingCache,
    loading,
    error,
    analyze,
    reanalyze,
  }
}
