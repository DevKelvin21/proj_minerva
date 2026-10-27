import { describe, expect, it } from 'vitest'
import { messageKeys } from '../../../shared/locale'
import { en } from './locales/en'
import { es } from './locales/es'

function valueAt(table: object, key: string): string {
  return key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], table) as string
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
})
