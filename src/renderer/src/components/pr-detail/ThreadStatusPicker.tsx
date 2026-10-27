import { useTranslation } from 'react-i18next'
import type { ThreadStatus } from '../../../../shared/scm'
import { Badge } from '../ui/Badge'
import { threadStatusLabel, THREAD_STATUS_TONE, type ScmTone } from '../../lib/scm-labels'

const TONE_CLASS: Record<ScmTone, string> = {
  neutral: 'bg-border/60 text-muted',
  accent: 'bg-accent/15 text-accent',
  success: 'bg-success/15 text-success',
  danger: 'bg-danger/15 text-danger',
  warning: 'bg-warning/15 text-warning',
}

interface ThreadStatusPickerProps {
  status: ThreadStatus
  /** Statuses the provider lets the user set; empty = read-only badge. */
  allowed: readonly ThreadStatus[]
  onChange: (status: ThreadStatus) => void
  busy?: boolean
}

/**
 * The thread's status as a pill. When the provider allows changes it is a
 * native `<select>` (keyboard and screen-reader friendly) styled as the badge;
 * otherwise a plain badge (none for `active`, the default).
 */
export function ThreadStatusPicker({
  status,
  allowed,
  onChange,
  busy = false,
}: ThreadStatusPickerProps): React.JSX.Element | null {
  const { t } = useTranslation()
  if (allowed.length === 0) {
    if (status === 'active') return null
    return (
      <Badge tone={THREAD_STATUS_TONE[status]}>
        <span data-thread-status={status}>{threadStatusLabel(status, t)}</span>
      </Badge>
    )
  }
  const options = allowed.includes(status) ? allowed : [status, ...allowed]
  return (
    <select
      aria-label={t('comments.thread.statusLabel')}
      data-thread-status={status}
      value={status}
      disabled={busy}
      onChange={(event) => onChange(event.target.value as ThreadStatus)}
      onClick={(event) => event.stopPropagation()}
      className={`cursor-pointer rounded-full border-0 py-0.5 pr-1 pl-2 text-xs font-medium outline-offset-1 disabled:cursor-wait disabled:opacity-70 ${TONE_CLASS[THREAD_STATUS_TONE[status]]}`}
    >
      {options.map((option) => (
        <option
          key={option}
          value={option}
          disabled={!allowed.includes(option)}
          className="bg-panel text-text"
        >
          {threadStatusLabel(option, t)}
        </option>
      ))}
    </select>
  )
}
