import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  NOTIFICATION_LEVELS,
  type NotificationLevel,
  type NotificationSettings,
} from '../../../../shared/activity'
import { errorText } from '../../lib/error-text'
import { IS_MAC } from '../../lib/platform'
import { Radio } from '../ui/Checkbox'
import { Switch } from '../ui/Switch'
import { SettingsGroup, SettingsRow } from './SettingsRow'

/**
 * Settings → Notifications: which new activity raises a system notification
 * (off / only what is aimed at you / everything), whether it plays a sound,
 * the unread count on the dock or taskbar icon and (macOS) the menu bar item.
 * Saved in settings.json through main, which applies the badge and the menu
 * bar item at once. `notificationsChanged` keeps it current when the menu
 * bar flips the sound.
 */
export function NotificationsSection(): React.JSX.Element {
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

  useEffect(
    () => window.minerva.events.onNotificationsChanged(({ settings: next }) => setSettings(next)),
    [],
  )

  /**
   * Optimistic: the control moves at once, and goes back if main refuses.
   * While a save is in flight the controls stay enabled (so keyboard focus
   * stays put) but `aria-disabled`, and changes are ignored.
   */
  async function save(next: NotificationSettings): Promise<void> {
    if (saving) return
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
    <SettingsGroup
      testId="notifications-section"
      title={t('settings.notifications.title')}
      description={t('settings.notifications.description')}
    >
      {settings ? (
        <>
          <SettingsRow title={t('settings.notifications.levelLabel')}>
            <fieldset className="flex flex-col gap-1.5">
              <legend className="sr-only">{t('settings.notifications.levelLabel')}</legend>
              {NOTIFICATION_LEVELS.map((level: NotificationLevel) => (
                <Radio
                  key={level}
                  fieldSize="md"
                  name="notification-level"
                  value={level}
                  checked={settings.level === level}
                  aria-disabled={saving || undefined}
                  onChange={() => void save({ ...settings, level })}
                  label={t(`settings.notifications.level.${level}`)}
                  hint={t(`settings.notifications.levelHint.${level}`)}
                />
              ))}
            </fieldset>
          </SettingsRow>
          <SettingsRow
            title={t('settings.notifications.badgeTitle')}
            description={t('settings.notifications.badge')}
            control={
              <Switch
                fieldSize="md"
                checked={settings.badge}
                aria-disabled={saving || undefined}
                onCheckedChange={(badge) => void save({ ...settings, badge })}
                label={<span className="sr-only">{t('settings.notifications.badge')}</span>}
              />
            }
          />
          <SettingsRow
            title={t('settings.notifications.soundTitle')}
            description={t('settings.notifications.sound')}
            control={
              <Switch
                fieldSize="md"
                data-testid="notifications-sound"
                checked={settings.sound}
                // No notifications, no sound to play.
                disabled={settings.level === 'off'}
                aria-disabled={saving || undefined}
                onCheckedChange={(sound) => void save({ ...settings, sound })}
                label={<span className="sr-only">{t('settings.notifications.soundTitle')}</span>}
              />
            }
          />
          {IS_MAC && (
            <SettingsRow
              title={t('settings.notifications.menuBarTitle')}
              description={t('settings.notifications.menuBar')}
              control={
                <Switch
                  fieldSize="md"
                  data-testid="notifications-menu-bar"
                  checked={settings.menuBar}
                  aria-disabled={saving || undefined}
                  onCheckedChange={(menuBar) => void save({ ...settings, menuBar })}
                  label={
                    <span className="sr-only">{t('settings.notifications.menuBarTitle')}</span>
                  }
                />
              }
            />
          )}
        </>
      ) : error ? null : (
        <p className="px-4 py-3 text-xs text-muted">{t('common.loading')}</p>
      )}
      {error && (
        <p role="alert" className="px-4 py-3 text-xs text-danger">
          {error}
        </p>
      )}
    </SettingsGroup>
  )
}
