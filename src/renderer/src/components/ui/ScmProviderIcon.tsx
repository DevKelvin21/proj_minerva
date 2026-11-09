import type { ScmProviderId } from '../../../../shared/scm'
import { SCM_PROVIDER_LABEL } from '../../lib/scm-labels'
import { Icon, type IconSize } from './Icon'
import { icons } from './icons'

/**
 * Small provider marker. lucide ships no brand logos, so each provider gets a
 * neutral glyph plus an accessible label; `data-provider` lets tests target it.
 */
export function ScmProviderIcon({
  provider,
  size = 'xs',
  className = '',
}: {
  provider: ScmProviderId
  size?: IconSize
  className?: string
}): React.JSX.Element {
  return (
    <span
      role="img"
      aria-label={SCM_PROVIDER_LABEL[provider]}
      title={SCM_PROVIDER_LABEL[provider]}
      data-provider={provider}
      className={'inline-flex shrink-0 ' + className}
    >
      <Icon icon={provider === 'azure' ? icons.cloud : icons.pullRequest} size={size} />
    </span>
  )
}
