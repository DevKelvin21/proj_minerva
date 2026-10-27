/**
 * English UI text: the SOURCE OF TRUTH of every renderer string. `es.ts` must
 * have exactly the same keys (`MessageShape<typeof en>`), and `t()` only
 * accepts keys that exist here (`../i18next.d.ts`). Nested by area.
 *
 * i18next syntax: `{{name}}` interpolation; plurals as `key_one` / `key_other`
 * called with `t('area.key', { count })`.
 */
import common from './parts/common.en'
import layout from './parts/layout.en'
import prList from './parts/prList.en'
import prDetail from './parts/prDetail.en'
import comments from './parts/comments.en'
import stacks from './parts/stacks.en'
import didactic from './parts/didactic.en'
import settings from './parts/settings.en'
import updater from './parts/updater.en'
import errors from './parts/errors.en'

export const en = {
  common,
  layout,
  prList,
  prDetail,
  comments,
  stacks,
  didactic,
  settings,
  updater,
  errors,
}
