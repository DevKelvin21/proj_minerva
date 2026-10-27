/**
 * Relative ("3 hours ago") and absolute timestamps, in the active UI locale
 * (`Intl`). Pure: pass `locale` and `now`.
 */
import type { AppLocale } from '../../../shared/locale'

const UNITS: Array<{ unit: Intl.RelativeTimeFormatUnit; seconds: number }> = [
  { unit: 'year', seconds: 365 * 24 * 3600 },
  { unit: 'month', seconds: 30 * 24 * 3600 },
  { unit: 'week', seconds: 7 * 24 * 3600 },
  { unit: 'day', seconds: 24 * 3600 },
  { unit: 'hour', seconds: 3600 },
  { unit: 'minute', seconds: 60 },
]

export function formatRelativeTime(iso: string, locale: AppLocale, now: number = Date.now()): string {
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return ''
  const relativeFormat = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  const diffSeconds = Math.round((then - now) / 1000)
  const abs = Math.abs(diffSeconds)
  // Under 45 s reads as "now" / "ahora" (`numeric: 'auto'` for 0 seconds).
  if (abs < 45) return relativeFormat.format(0, 'second')
  for (const { unit, seconds } of UNITS) {
    if (abs >= seconds) return relativeFormat.format(Math.round(diffSeconds / seconds), unit)
  }
  return relativeFormat.format(Math.round(diffSeconds / 60), 'minute')
}

export function formatAbsoluteTime(iso: string, locale: AppLocale): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
