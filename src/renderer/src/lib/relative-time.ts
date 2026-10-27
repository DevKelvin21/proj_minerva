/** Relative ("3h ago") and absolute timestamps for comments. Pure (pass `now`). */

const UNITS: Array<{ unit: Intl.RelativeTimeFormatUnit; seconds: number }> = [
  { unit: 'year', seconds: 365 * 24 * 3600 },
  { unit: 'month', seconds: 30 * 24 * 3600 },
  { unit: 'week', seconds: 7 * 24 * 3600 },
  { unit: 'day', seconds: 24 * 3600 },
  { unit: 'hour', seconds: 3600 },
  { unit: 'minute', seconds: 60 },
]

const relativeFormat = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

export function formatRelativeTime(iso: string, now: number = Date.now()): string {
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return ''
  const diffSeconds = Math.round((then - now) / 1000)
  const abs = Math.abs(diffSeconds)
  if (abs < 45) return 'just now'
  for (const { unit, seconds } of UNITS) {
    if (abs >= seconds) return relativeFormat.format(Math.round(diffSeconds / seconds), unit)
  }
  return relativeFormat.format(Math.round(diffSeconds / 60), 'minute')
}

export function formatAbsoluteTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString('en', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
