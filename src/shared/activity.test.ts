import { describe, expect, it } from 'vitest'
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  isNotificationSettings,
  normalizeNotificationSettings,
} from './activity'

describe('notification settings', () => {
  it('accepts a block saved before sound and menuBar existed', () => {
    expect(isNotificationSettings({ level: 'off', badge: false })).toBe(true)
  })

  it('fills a missing sound / menuBar with the default, keeping level and badge', () => {
    expect(normalizeNotificationSettings({ level: 'off', badge: false })).toEqual({
      level: 'off',
      badge: false,
      sound: DEFAULT_NOTIFICATION_SETTINGS.sound,
      menuBar: DEFAULT_NOTIFICATION_SETTINGS.menuBar,
    })
    expect(
      normalizeNotificationSettings({ level: 'all', badge: true, sound: false, menuBar: false }),
    ).toEqual({ level: 'all', badge: true, sound: false, menuBar: false })
  })

  it('rejects unknown keys and wrong types', () => {
    expect(isNotificationSettings({ level: 'all', badge: true, sound: null })).toBe(false)
    expect(isNotificationSettings({ level: 'all', badge: true, chime: true })).toBe(false)
    expect(isNotificationSettings({ level: 'all', sound: true })).toBe(false)
  })
})
