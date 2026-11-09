import { Icon } from '../ui/Icon'
import { icons } from '../ui/icons'
import { useTranslation } from 'react-i18next'
import type { LayerVerdict } from '../../stores/app-store'
import { Button } from '../ui/Button'
import { Kbd } from '../ui/Kbd'

const VERDICTS: ReadonlyArray<{
  verdict: LayerVerdict
  key: string
  icon: React.JSX.Element
  on: string
}> = [
  {
    verdict: 'good',
    key: '1',
    icon: <Icon icon={icons.success} size="md" className="text-success" />,
    on: 'border-success bg-success/15 text-success',
  },
  {
    verdict: 'changes',
    key: '2',
    icon: <Icon icon={icons.error} size="md" className="text-danger" />,
    on: 'border-danger bg-danger/15 text-danger',
  },
  {
    verdict: 'question',
    key: '3',
    icon: <Icon icon={icons.unsure} size="md" className="text-warning" />,
    on: 'border-warning bg-warning/15 text-warning',
  },
]

interface WalkthroughFocusBarProps {
  /** Verdict of the layer on screen; `null` = not judged yet. */
  verdict: LayerVerdict | null
  /** `null` = no layer on screen (a file outside every layer). */
  onVerdict: ((verdict: LayerVerdict | null) => void) | null
  onPrevious: (() => void) | null
  onNext: (() => void) | null
  judged: number
  total: number
  onFinish: () => void
}

/**
 * Bottom bar of the full-screen walkthrough: previous / next layer (K / J),
 * the reviewer's verdict on the layer on screen (1 / 2 / 3; picking the same
 * one again clears it), how many layers are judged, and Done. Verdicts stay
 * in this session: Minerva never posts them anywhere.
 */
export function WalkthroughFocusBar({
  verdict,
  onVerdict,
  onPrevious,
  onNext,
  judged,
  total,
  onFinish,
}: WalkthroughFocusBarProps): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <footer
      data-testid="walkthrough-focus-bar"
      className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border bg-panel px-4 py-2.5"
    >
      <Button
        size="md"
        onClick={onPrevious ?? undefined}
        disabled={!onPrevious}
        icon={<Icon icon={icons.previous} size="md" />}
      >
        {t('prDetail.focus.previous')}
        <Kbd>K</Kbd>
      </Button>
      <Button size="md" onClick={onNext ?? undefined} disabled={!onNext}>
        {t('prDetail.focus.next')}
        <Kbd>J</Kbd>
        <Icon icon={icons.next} size="md" />
      </Button>

      <div
        role="group"
        aria-label={t('prDetail.focus.verdictsLabel')}
        className="mx-auto flex flex-wrap items-center gap-2"
      >
        <span className="text-xs text-muted">{t('prDetail.focus.thisLayer')}</span>
        {VERDICTS.map((item) => {
          const on = verdict === item.verdict
          return (
            <button
              key={item.verdict}
              type="button"
              aria-pressed={on}
              disabled={!onVerdict}
              onClick={() => onVerdict?.(on ? null : item.verdict)}
              className={`flex h-8 items-center gap-2 rounded-md border px-3 text-sm font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${
                on ? item.on : 'border-border text-text hover:border-accent'
              }`}
            >
              {item.icon}
              {t(`prDetail.layers.verdict.${item.verdict}`)}
              <Kbd>{item.key}</Kbd>
            </button>
          )
        })}
      </div>

      <span className="text-xs text-muted" data-testid="walkthrough-judged">
        {t('prDetail.focus.judged', { count: judged, total })}
      </span>
      <Button variant="primary" size="md" onClick={onFinish}>
        {t('prDetail.focus.finish')}
      </Button>
    </footer>
  )
}
