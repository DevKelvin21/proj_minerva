import { Trans } from 'react-i18next'
import type { ScmListError } from '../../../../shared/types'
import { SCM_PROVIDER_LABEL } from '../../lib/scm-labels'
import { azDevopsLoginCommand, GH_LOGIN_COMMAND } from '../../lib/scm-connection'
import { ScmProviderIcon } from '../ui/ScmProviderIcon'
import { transText } from '../../lib/trans-text'

const MONO = <span className="font-mono text-text" />
/** A long command (Azure's names the org URL) on its own line, wrapping anywhere. */
const CMD = (
  <code className="my-1 block break-all rounded bg-bg px-1.5 py-1 font-mono text-xs text-text" />
)

/**
 * What to run for ONE provider that could not list because it needs a sign-in
 * (`UNAUTHENTICATED` / `CLI_UNAVAILABLE`). GitHub: `gh auth login`, or the
 * picked account by name (a bare "run gh auth login" would be wrong advice
 * when the CLI is fine and only the choice is broken). Azure: the
 * org-specific `az devops login`, or installing `az` first. Shared by the
 * Sidebar's sign-in CTA and the home dashboard's.
 */
export function SignInHint({
  error,
  githubAccount,
  azureOrganization,
}: {
  error: ScmListError
  githubAccount: string | null
  azureOrganization: string | undefined
}): React.JSX.Element {
  const body =
    error.provider === 'github' ? (
      githubAccount !== null ? (
        <Trans
          i18nKey="layout.sidebar.accountNoSession"
          values={{ command: GH_LOGIN_COMMAND }}
          components={{ mono: MONO, account: transText(githubAccount, 'font-mono text-text') }}
        />
      ) : (
        <Trans
          i18nKey="layout.sidebar.signInWithGhCli"
          values={{ command: GH_LOGIN_COMMAND }}
          components={{ mono: MONO }}
        />
      )
    ) : (
      <Trans
        i18nKey={
          error.code === 'CLI_UNAVAILABLE'
            ? 'layout.sidebar.installAz'
            : 'layout.sidebar.signInWithAz'
        }
        values={{ command: azDevopsLoginCommand(azureOrganization) }}
        components={{ mono: MONO, cmd: CMD }}
      />
    )
  return (
    <div
      data-sign-in={error.provider}
      data-error-code={error.code}
      className="flex w-full flex-col items-center gap-1 text-sm text-muted"
    >
      <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
        <ScmProviderIcon provider={error.provider} size={12} />
        {SCM_PROVIDER_LABEL[error.provider]}
      </span>
      <p className="break-words">{body}</p>
    </div>
  )
}
