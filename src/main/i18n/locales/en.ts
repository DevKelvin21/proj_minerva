/**
 * English messages of the main process (source of truth): text main shows the
 * user directly (native dialogs, window titles) or sends to the renderer to
 * display (error messages). `es.ts` must have the same shape. `{{name}}` is
 * replaced by `mt()` (`../index.ts`). Developer log lines stay out of here.
 *
 * Plain quoted strings only (no backtick-delimited strings, gotcha 3).
 */
import ai from './parts/ai.en'

export const en = {
  ai,
  common: {
    cancel: 'Cancel',
  },
  windows: {
    didacticTitle: 'Minerva — Analysis {{repo}}#{{number}}',
  },
}
