import type { ScmProviderId } from '../../../../shared/scm'
import { SCM_PROVIDER_LABEL } from '../../lib/scm-labels'
import { ProviderMark } from './ProviderMark'
import type { IconSize } from './Icon'

/**
 * Small provider marker: the GitHub or Azure DevOps mark plus an accessible
 * label; `data-provider` lets tests target it. Monochrome (`currentColor`)
 * unless `color` asks for the brand's own (Settings).
 */
export function ScmProviderIcon({
  provider,
  size = 'xs',
  color = false,
  className = '',
}: {
  provider: ScmProviderId
  size?: IconSize
  color?: boolean
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
      <ProviderMark mark={provider === 'azure' ? 'azureDevops' : 'github'} size={size} color={color} />
    </span>
  )
}
