import type { AppLocale } from '../../../shared/locale'
import type { DidacticAnalysis } from '../../../shared/types'

/**
 * T42 (Issue 2): un PR puede recibir commits nuevos DESPUÉS de generar su
 * análisis didáctico — `analysis.headSha` queda sellado (T39/T40) al SHA del
 * head en ese momento. Comparar ese sello contra el `headSha` ACTUAL del PR
 * dice si el resumen mostrado quedó desactualizado.
 *
 * Función PURA (sin acceso a red/estado) para que `DidacticAnalysisArea`
 * pueda derivarla en cada render sin efectos ni estado propio: reacciona
 * sola cuando cambian `analysis`/`currentHeadSha` (ver comentario del
 * componente sobre por qué NO se resetea nada por efecto).
 *
 * `false` (no stale) si falta cualquiera de las piezas necesarias para la
 * comparación: sin análisis, sin `currentHeadSha` (aún no llegó — panel
 * acoplado siempre lo tiene desde el summary; la ventana desacoplada lo
 * fetchea con `use-pr-head-sha`), o con cualquiera de los dos SHAs vacío
 * (fixtures/entornos donde GitHub no devolvió el dato, T39).
 */
export function isAnalysisStale(
  analysis: DidacticAnalysis | null,
  currentHeadSha: string | null | undefined,
): boolean {
  return (
    analysis != null &&
    !!currentHeadSha &&
    !!analysis.headSha &&
    analysis.headSha !== currentHeadSha
  )
}

/**
 * The analysis shown was written in another language than the current UI
 * language (`DidacticAnalysis.language`, captured when it was requested):
 * the panel offers to regenerate it in the UI language instead of silently
 * serving, say, a Spanish analysis to an English user. `false` without an
 * analysis.
 */
export function isAnalysisLanguageMismatch(
  analysis: DidacticAnalysis | null,
  locale: AppLocale,
): boolean {
  return analysis != null && analysis.language !== locale
}
