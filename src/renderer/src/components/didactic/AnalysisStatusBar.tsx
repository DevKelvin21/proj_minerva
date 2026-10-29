import { useTranslation } from 'react-i18next'
import { Languages, RefreshCw, TriangleAlert } from 'lucide-react'
import type { AnalysisGenerationInfo } from '../../../../shared/types'
import type { AnalysisNotice } from '../../lib/analysis-status'
import { Button } from '../ui/Button'
import { ActiveModelHint } from './ActiveModelHint'

/** What the one notice says; `null` = none applies. */
export type StatusBarNotice =
  | { kind: Extract<AnalysisNotice, 'commits'>; from: string; to: string }
  | { kind: Extract<AnalysisNotice, 'language'>; analysisLanguage: string; uiLanguage: string }

interface AnalysisStatusBarProps {
  /** Seal of the analysis on screen; absent while it streams (current config). */
  generatedWith?: AnalysisGenerationInfo
  notice: StatusBarNotice | null
  /** Disables the button while an analysis runs. */
  busy: boolean
  onRegenerate: () => void
}

/**
 * The one row above the analysis: the model that wrote it, at most one notice
 * (new commits beat the language, `pickAnalysisNotice`) and ONE regenerate
 * button. With a notice the button turns warning-toned and takes the
 * notice's verb (Update, Regenerate); without one it reads "Re-analyze".
 * The row carries the notice's test id so the notice and its button stay
 * one unit (`analysis-stale-banner`, `analysis-language-banner`).
 */
export function AnalysisStatusBar({
  generatedWith,
  notice,
  busy,
  onRegenerate,
}: AnalysisStatusBarProps): React.JSX.Element {
  const { t } = useTranslation()
  const label =
    notice?.kind === 'commits'
      ? t('didactic.analysis.update')
      : notice?.kind === 'language'
        ? t('didactic.analysis.regenerate')
        : t('didactic.analysis.reanalyze')
  const NoticeIcon = notice?.kind === 'language' ? Languages : TriangleAlert

  return (
    <div
      className="flex min-w-0 shrink-0 flex-col gap-1.5 border-b border-border pb-2.5"
      data-testid={
        notice?.kind === 'commits'
          ? 'analysis-stale-banner'
          : notice?.kind === 'language'
            ? 'analysis-language-banner'
            : 'analysis-status-bar'
      }
    >
      <div className="flex min-w-0 items-center gap-2">
        <ActiveModelHint generatedWith={generatedWith} />
        <Button
          size="xs"
          variant={notice ? 'warning' : 'secondary'}
          className="ml-auto"
          onClick={onRegenerate}
          disabled={busy}
          title={t('didactic.analysis.reanalyzeHint')}
          data-testid={notice?.kind === 'language' ? 'analysis-language-regenerate' : undefined}
          icon={
            <RefreshCw
              size={12}
              aria-hidden
              className={busy ? 'animate-spin motion-reduce:animate-none' : undefined}
            />
          }
        >
          {label}
        </Button>
      </div>
      {notice && (
        <p className="flex min-w-0 items-start gap-1.5 text-[11px] leading-snug text-text">
          <NoticeIcon size={12} className="mt-px shrink-0 text-warning" aria-hidden />
          <span className="min-w-0 break-words">
            {notice.kind === 'commits'
              ? t('didactic.analysis.staleNotice', { from: notice.from, to: notice.to })
              : t('didactic.analysis.languageMismatch', {
                  analysisLanguage: notice.analysisLanguage,
                  uiLanguage: notice.uiLanguage,
                })}
          </span>
        </p>
      )}
    </div>
  )
}
