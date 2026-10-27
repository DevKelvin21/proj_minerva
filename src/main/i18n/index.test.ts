import { afterEach, describe, expect, it } from 'vitest'
import { messageKeys } from '../../shared/locale'
import { MAIN_MESSAGES, getMainLocale, mt, setMainLocale } from './index'

describe('main i18n', () => {
  afterEach(() => setMainLocale('en'))

  it('defaults to English', () => {
    expect(getMainLocale()).toBe('en')
    expect(mt('common.cancel')).toBe('Cancel')
  })

  it('follows the active locale and interpolates placeholders', () => {
    setMainLocale('es')
    expect(mt('common.cancel')).toBe('Cancelar')
    expect(mt('windows.didacticTitle', { repo: 'a/b', number: 7 })).toBe('Minerva — Análisis a/b#7')
    expect(mt('windows.didacticTitle', { repo: 'a/b', number: 7 }, 'en')).toBe(
      'Minerva — Analysis a/b#7',
    )
  })

  it('leaves unknown placeholders untouched', () => {
    expect(mt('windows.didacticTitle', { repo: 'a/b' })).toBe('Minerva — Analysis a/b#{{number}}')
  })

  it('es covers every en key, with the same placeholders, and nothing extra', () => {
    const enKeys = messageKeys(MAIN_MESSAGES.en).sort()
    expect(messageKeys(MAIN_MESSAGES.es).sort()).toEqual(enKeys)
    const placeholders = (text: string): string[] =>
      [...text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort()
    for (const key of enKeys) {
      const k = key as Parameters<typeof mt>[0]
      expect(placeholders(mt(k, {}, 'es')), key).toEqual(placeholders(mt(k, {}, 'en')))
      expect(mt(k, {}, 'es').trim().length, key).toBeGreaterThan(0)
    }
  })
})
