import { Cloud, GitPullRequest } from 'lucide-react'
import type { ScmProviderId } from '../../../../shared/scm'
import { SCM_PROVIDER_LABEL } from '../../lib/scm-labels'

/**
 * Small provider marker. lucide ships no brand logos, so each provider gets a
 * neutral glyph plus an accessible label; `data-provider` lets tests target it.
 */
export function ScmProviderIcon({
  provider,
  size = 12,
  className = '',
}: {
  provider: ScmProviderId
  size?: number
  className?: string
}): React.JSX.Element {
  const Icon = provider === 'azure' ? Cloud : GitPullRequest
  return (
    <span
      role="img"
      aria-label={SCM_PROVIDER_LABEL[provider]}
      title={SCM_PROVIDER_LABEL[provider]}
      data-provider={provider}
      className={'inline-flex shrink-0 ' + className}
    >
      <Icon size={size} aria-hidden />
    </span>
  )
}
