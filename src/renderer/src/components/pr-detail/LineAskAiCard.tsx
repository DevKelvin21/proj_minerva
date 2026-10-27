import { useTranslation } from 'react-i18next'
import type { LineSide } from '../../lib/line-threads'
import { AskAiCard } from './AskAiCard'
import type { AskAiBinding } from './diff-body'

interface LineAskAiCardProps {
  askAi: AskAiBinding
  line: number
  side: LineSide
  /** Opens the line's comment composer with the answer as a draft. */
  onUseAsComment: (markdown: string) => void
  onClose: () => void
}

/** "Ask AI" under one diff line (`InlineDiff`, `SplitDiff`). */
export function LineAskAiCard({
  askAi,
  line,
  side,
  onUseAsComment,
  onClose,
}: LineAskAiCardProps): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <AskAiCard
      subject={askAi.lineSubject(line, side)}
      title={
        side === 'LEFT'
          ? t('comments.askAi.titleOld', { line })
          : t('comments.askAi.title', { line })
      }
      inputLabel={t('comments.askAi.inputLabel', { line })}
      placeholder={t('comments.askAi.placeholder')}
      onRun={askAi.runLine(line, side)}
      useAs="comment"
      onUse={onUseAsComment}
      onClose={onClose}
    />
  )
}
