import 'i18next'
import type { en } from './locales/en'

/**
 * Typed keys: `t('area.key')` only compiles when the key exists in `en.ts`
 * (and its interpolation/plural shape is known).
 */
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation'
    resources: { translation: typeof en }
  }
}
