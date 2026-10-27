import type { MessageShape } from '../../../shared/locale'
import type { en } from './en'

/** Spanish messages of the main process; same shape as `en.ts` (a missing key is a type error). */
export const es: MessageShape<typeof en> = {
  common: {
    cancel: 'Cancelar',
  },
  windows: {
    didacticTitle: 'Minerva — Análisis {{repo}}#{{number}}',
  },
}
