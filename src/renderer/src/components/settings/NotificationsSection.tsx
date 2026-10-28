import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  NOTIFICATION_LEVELS,
  type NotificationLevel,
  type NotificationSettings,
} from '../../../../shared/activity'
import { errorText } from '../../lib/error-text'

interface NotificationsSectionProps {
  /** Short window: drop the explanatory text, keep the controls. */
  compact?: boolean
}

/**
 * Settings → Notifications: which new activity raises a system notification
 * (off / only what is aimed at you / everything) and the unread count on the
 * dock or taskbar icon. Saved in settings.json through main, which applies the
 * badge at once.
 */
export function NotificationsSection({
  compact = false,
}: NotificationsSectionProps): React.JSX.Element {
  const { t } = useTranslation()
  const [settings, setSettings] = useState<NotificationSettings | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    window.minerva.settings
      .getNotifications()
      .then((loaded) => {
        if (alive) setSettings(loaded)
      })
      .catch((err: unknown) => {
        if (alive) setError(t('settings.notifications.loadError', { error: errorText(err) }))
      })
    return () => {
      alive = false
    }
  }, [t])

  /** Optimistic: the control moves at once, and goes back if main refuses. */
  async function save(next: NotificationSettings): Promise<void> {
    const previous = settings
    setSettings(next)
    setSaving(true)
    setError(null)
    try {
      setSettings(await window.minerva.settings.setNotifications(next))
    } catch (err: unknown) {
      setSettings(previous)
      setError(t('settings.notifications.saveError', { error: errorText(err) }))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-4" data-testid="notifications-section">
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
        {t('settings.notifications.title')}
      </h3>
      {!compact && (
        <p className="mb-2 text-xs text-muted">{t('settings.notifications.description')}</p>
      )}
      {settings && (
        <div className="flex flex-col gap-2">
          <fieldset className="flex flex-col gap-1" disabled={saving}>
            <legend className="sr-only">{t('settings.notifications.levelLabel')}</legend>
            {NOTIFICATION_LEVELS.map((level: NotificationLevel) => (
              <label key={level} className="flex items-start gap-2 text-sm text-text">
                <input
                  type="radio"
                  name="notification-level"
                  value={level}
                  checked={settings.level === level}
                  onChange={() => void save({ ...settings, level })}
                  className="mt-1 accent-[var(--theme-accent)]"
                />
                <span className="min-w-0">
                  {t(`settings.notifications.level.${level}`)}
                  {!compact && (
                    <span className="block text-xs text-muted">
                      {t(`settings.notifications.levelHint.${level}`)}
                    </span>
                  )}
                </span>
              </label>
            ))}
          </fieldset>
          <label className="flex items-center gap-2 text-sm text-text">
            <input
              type="checkbox"
              checked={settings.badge}
              disabled={saving}
              onChange={(event) => void save({ ...settings, badge: event.target.checked })}
              className="accent-[var(--theme-accent)]"
            />
            {t('settings.notifications.badge')}
          </label>
        </div>
      )}
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </div>
  )
}
