import { CircleCheck, TriangleAlert, X } from 'lucide-react'
import { Trans, useTranslation } from 'react-i18next'
import { prKey } from '../../../../shared/scm'
import type { PullRequestSummary } from '../../../../shared/types'
import { useStacksStore } from '../../stores/stacks-store'
import { transText } from '../../lib/trans-text'
import { Button } from '../ui/Button'
import { IconButton } from '../ui/IconButton'

interface RetargetNoteProps {
  /** Only show the note when it is about this PR (`prKey`). */
  onlyFor?: string
  /** Hide it when it is about this PR (the open PR's header already shows it). */
  except?: string | null
  /** Makes the PR number a link (Stacks view: the PR may have left the stacks). */
  onOpenPr?: (pr: PullRequestSummary) => void
  className?: string
}

/**
 * The outcome of the last retarget, kept until dismissed: where the PR went
 * (and that its diff changed), or why it could not be retargeted because the
 * data on screen was stale (`CONFLICT`; the data was refreshed).
 */
export function RetargetNote({
  onlyFor,
  except,
  onOpenPr,
  className = '',
}: RetargetNoteProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const note = useStacksStore((s) => s.lastRetarget)
  const dismiss = useStacksStore((s) => s.dismissRetargetNote)
  if (!note) return null
  const key = note.kind === 'retargeted' ? prKey(note.pr.repo, note.pr.number) : note.prKey
  if (onlyFor !== undefined && key !== onlyFor) return null
  if (except && key === except) return null

  const dismissButton = (
    <IconButton size="xs" onClick={dismiss} label={t('stacks.retarget.dismiss')} icon={<X size={12} />} />
  )

  if (note.kind === 'conflict') {
    return (
      <div
        role="alert"
        data-error-code="CONFLICT"
        className={'flex min-w-0 items-start gap-1.5 text-xs ' + className}
      >
        <TriangleAlert size={13} className="mt-0.5 shrink-0 text-warning" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-warning">
            {t('stacks.retarget.couldNotRetarget', { number: note.number })}
          </p>
          <p className="text-text/80">
            {t(`stacks.retarget.failures.${note.failure.reason}`, { branch: note.failure.newBase })}
          </p>
          {note.failure.detail && <p className="break-words text-muted">{note.failure.detail}</p>}
        </div>
        {dismissButton}
      </div>
    )
  }

  const { pr, oldBase } = note
  return (
    <div
      role="status"
      className={'flex min-w-0 items-start gap-1.5 text-xs text-text/90 ' + className}
    >
      <CircleCheck size={13} className="mt-0.5 shrink-0 text-success" aria-hidden />
      <p className="min-w-0 flex-1">
        <Trans
          i18nKey="stacks.retarget.retargeted"
          values={{ number: pr.number }}
          components={{
            pr: onOpenPr ? (
              <Button variant="link" size="xs" onClick={() => onOpenPr(pr)} />
            ) : (
              <span className="font-medium" />
            ),
            base: transText(pr.baseRef, 'font-mono'),
            previous: transText(oldBase, 'font-mono'),
          }}
        />
      </p>
      {dismissButton}
    </div>
  )
}
