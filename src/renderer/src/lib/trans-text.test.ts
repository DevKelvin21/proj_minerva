import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Trans } from 'react-i18next'
import i18next from 'i18next'
import { describe, expect, it } from 'vitest'
import { messageKeys } from '../../../shared/locale'
import { en } from '../i18n/locales/en'
import { es } from '../i18n/locales/es'
import { transText } from './trans-text'

const HOSTILE = '<strong>x</strong><0>y</0>'

async function render(
  text: string,
  props: { values?: Record<string, unknown>; components: Record<string, React.ReactElement> },
): Promise<string> {
  const instance = i18next.createInstance()
  await instance.init({
    lng: 'en',
    resources: { en: { translation: { key: text } } },
    interpolation: { escapeValue: false },
  })
  // `i18nKey` is typed to the app's keys; this test brings its own table.
  const UntypedTrans = Trans as unknown as React.ComponentType<Record<string, unknown>>
  return renderToStaticMarkup(
    createElement(UntypedTrans, { i18n: instance, i18nKey: 'key', ...props }),
  )
}

describe('transText', () => {
  it('renders untrusted text literally in a self-closing slot', async () => {
    const html = await render('targets <branch/> directly', {
      components: { branch: transText(HOSTILE, 'font-mono') },
    })
    expect(html).toBe(
      'targets <span class="font-mono">&lt;strong&gt;x&lt;/strong&gt;&lt;0&gt;y&lt;/0&gt;</span> directly',
    )
  })

  it('is needed: Trans parses markup inside interpolated values', async () => {
    const html = await render('targets <branch>{{branch}}</branch>', {
      values: { branch: HOSTILE },
      components: { branch: createElement('span') },
    })
    expect(html).toContain('<strong>x</strong>')
  })
})

/**
 * Interpolated values inside Trans strings must be local data (numbers, CLI
 * commands, the app version, the modifier key): PR/SCM text goes through
 * `transText`. A new placeholder here means checking where its value comes from first.
 */
const TRANS_SAFE_VALUES = new Set([
  'number',
  'count',
  'parent',
  'command',
  'binary',
  'path',
  'version',
  'mod',
])

function valueAt(table: object, key: string): string {
  return key
    .split('.')
    .reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], table) as string
}

describe('Trans strings', () => {
  it('only interpolate local values (untrusted text uses transText)', () => {
    for (const table of [en, es]) {
      for (const key of messageKeys(table)) {
        const text = valueAt(table, key)
        if (!/<[A-Za-z0-9]+\s*\/?>/.test(text)) continue
        for (const [, name] of text.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)) {
          expect(TRANS_SAFE_VALUES, key + ': {{' + name + '}}').toContain(name)
        }
      }
    }
  })
})
