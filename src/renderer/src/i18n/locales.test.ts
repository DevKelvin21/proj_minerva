import { describe, expect, it } from 'vitest'
import i18next from 'i18next'
import { messageKeys } from '../../../shared/locale'
import { en } from './locales/en'
import { es } from './locales/es'

function valueAt(table: object, key: string): string {
  return key
    .split('.')
    .reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], table) as string
}

const placeholders = (text: string): string[] =>
  [...text.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]).sort()

describe('renderer locales', () => {
  const enKeys = messageKeys(en).sort()

  it('es has exactly the keys of en (none missing, none extra)', () => {
    expect(messageKeys(es).sort()).toEqual(enKeys)
  })

  it('every es string is non-empty and keeps the interpolation placeholders of en', () => {
    for (const key of enKeys) {
      const esText = valueAt(es, key)
      expect(esText.trim().length, key).toBeGreaterThan(0)
      expect(placeholders(esText), key).toEqual(placeholders(valueAt(en, key)))
    }
  })

  it('plural keys come in _one/_other pairs', () => {
    for (const key of enKeys) {
      if (key.endsWith('_one')) expect(enKeys, key).toContain(key.replace(/_one$/, '_other'))
      if (key.endsWith('_other')) expect(enKeys, key).toContain(key.replace(/_other$/, '_one'))
    }
  })

  it('the diff-stat sentence nests a plural per count (ui/DiffStat)', async () => {
    const instance = i18next.createInstance()
    await instance.init({
      lng: 'en',
      resources: { en: { translation: en }, es: { translation: es } },
      interpolation: { escapeValue: false },
    })
    const summary = (lng: 'en' | 'es', additions: number, deletions: number): string =>
      instance.getFixedT(lng)('diffStat.summary', { additions, deletions })
    expect(summary('en', 6, 2)).toBe('6 additions, 2 deletions')
    expect(summary('en', 1, 1)).toBe('1 addition, 1 deletion')
    expect(summary('es', 1, 0)).toBe('1 línea agregada, 0 líneas eliminadas')
  })
})
