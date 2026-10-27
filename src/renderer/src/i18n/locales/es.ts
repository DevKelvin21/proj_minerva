/**
 * Spanish UI text (neutral Latin American Spanish, "tú"). Same shape as
 * `en.ts`: a missing or extra key is a typecheck error.
 */
import type { MessageShape } from '../../../../shared/locale'
import type { en } from './en'
import common from './parts/common.es'
import layout from './parts/layout.es'
import prList from './parts/prList.es'
import prDetail from './parts/prDetail.es'
import comments from './parts/comments.es'
import stacks from './parts/stacks.es'
import didactic from './parts/didactic.es'
import settings from './parts/settings.es'
import updater from './parts/updater.es'
import errors from './parts/errors.es'

export const es: MessageShape<typeof en> = {
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
