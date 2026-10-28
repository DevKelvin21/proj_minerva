/**
 * The analysis status bar shows at most ONE notice. New commits beat the
 * language: regenerating a stale analysis writes it in the current language anyway.
 */
export type AnalysisNotice = 'commits' | 'language'

export function pickAnalysisNotice(stale: boolean, languageMismatch: boolean): AnalysisNotice | null {
  if (stale) return 'commits'
  if (languageMismatch) return 'language'
  return null
}

/**
 * The one model name of every analysis surface: "Big Pickle · OpenCode", plus
 * the reasoning effort when the model has one ("Opus · Claude Code · High").
 */
export function formatModelName(
  modelLabel: string,
  providerLabel: string,
  effortLabel?: string,
): string {
  return [modelLabel, providerLabel, effortLabel].filter((part) => part).join(' · ')
}
